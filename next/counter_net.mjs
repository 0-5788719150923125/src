// Feasibility probe: a neural network stored as a vector of integer counters,
// trained by simulated peers that exchange only (seed, vote) records.
//
//   node next/counter_net.mjs <dir-or-files...>
//   ROUNDS=1500 LIARS=2 node next/counter_net.mjs <dir-or-files...>
//   WAVE=global PERIOD=300 node next/counter_net.mjs <dir-or-files...>
//   WAVE=phased PERIOD=300 node next/counter_net.mjs <dir-or-files...>
//
// WAVE replaces the contrast score with a target: the distance between a
// passage of mine and a passage of someone else's should follow a sine wave.
// `global` puts every pair on one wave. `phased` gives each held document its
// own phase, so one knob cannot ride them all.
//
// See next/witness.md. Each input file is one "member" and needs at least
// 6 KiB of text. Nothing here is the implementation - it
// answers three questions with numbers:
//   1. Do peers that receive the same records in different orders end up with
//      bit-identical weights?
//   2. Does a sign-vote evolution strategy learn anything on a contrastive
//      authorship task, in plain JavaScript?
//   3. How many probes per second does one core manage?

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

// ---------------------------------------------------------------- config
const WINDOW = 256 // bytes per text window
const BUCKETS = 2048 // hashed trigram buckets
const DIM = 16 // embedding width
const HIDDEN = 32
const OUT = 16
const UNIT = 1 / 512 // weight value of one counter tick (the learning rate)
const SIGMA_TICKS = 16 // probe radius, in ticks
const BATCH = 24 // triplets per probe
const HELD = 4 // other members each peer holds
const ABSTAIN = Number(process.env.ABSTAIN || 0) // |f+ - f-| below this casts no vote
const ROUNDS = Number(process.env.ROUNDS || 400)
const PROBES_PER_ROUND = Number(process.env.PPR || 4)
const WAVE = process.env.WAVE || ''
const PERIOD = Number(process.env.PERIOD || 300) // rounds per cycle
let MID = 1 // set from the genesis distance when WAVE is on
let AMP = 0.5
const target = (round, k) =>
    MID + AMP * Math.sin(2 * Math.PI * (round / PERIOD + (WAVE === 'phased' ? k / HELD : 0)))
const LIARS = Number(process.env.LIARS || 0) // peers that invert every vote

const P_EMB = BUCKETS * DIM
const P_W1 = DIM * HIDDEN
const P_B1 = HIDDEN
const P_W2 = HIDDEN * OUT
const P = P_EMB + P_W1 + P_B1 + P_W2

// ---------------------------------------------------------------- prng
// Integer-only, so every JavaScript engine produces the same stream.
function mulberry32(seed) {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return (t ^ (t >>> 14)) >>> 0
    }
}

// Expand a seed into a +1/-1 direction over every parameter.
function direction(seed, out) {
    const next = mulberry32(seed)
    for (let i = 0; i < P; i += 32) {
        let bits = next()
        const end = Math.min(i + 32, P)
        for (let j = i; j < end; j++) {
            out[j] = bits & 1 ? 1 : -1
            bits >>>= 1
        }
    }
    return out
}

// ---------------------------------------------------------------- model
// The state is `counters`. Weights are a view of it: w = counter * UNIT.
function genesis(seed) {
    const next = mulberry32(seed)
    const c = new Int32Array(P)
    const span = (n) => Math.round(1 / Math.sqrt(n) / UNIT)
    const fill = (from, len, s) => {
        for (let i = from; i < from + len; i++)
            c[i] = (next() % (2 * s + 1)) - s
    }
    fill(0, P_EMB, span(DIM) * 2)
    fill(P_EMB, P_W1, span(DIM))
    fill(P_EMB + P_W1 + P_B1, P_W2, span(HIDDEN))
    return c
}

function trigramBuckets(bytes, start) {
    const ids = new Uint16Array(WINDOW - 2)
    for (let i = 0; i < WINDOW - 2; i++) {
        const h =
            Math.imul(bytes[start + i], 0x9e3779b1) ^
            Math.imul(bytes[start + i + 1], 0x85ebca6b) ^
            Math.imul(bytes[start + i + 2], 0xc2b2ae35)
        ids[i] = ((h ^ (h >>> 15)) >>> 0) % BUCKETS
    }
    return ids
}

const pooled = new Float32Array(DIM)
const hidden = new Float32Array(HIDDEN)

// Embed one window. `w` is a Float32Array of weights.
function embed(w, ids, out, off) {
    pooled.fill(0)
    for (let i = 0; i < ids.length; i++) {
        const row = ids[i] * DIM
        for (let d = 0; d < DIM; d++) pooled[d] += w[row + d]
    }
    const inv = 1 / ids.length
    let o = P_EMB
    for (let h = 0; h < HIDDEN; h++) {
        let s = w[P_EMB + P_W1 + h]
        for (let d = 0; d < DIM; d++) s += w[o++] * pooled[d] * inv * 8
        hidden[h] = Math.tanh(s)
    }
    o = P_EMB + P_W1 + P_B1
    let norm = 1e-9
    for (let k = 0; k < OUT; k++) {
        let s = 0
        for (let h = 0; h < HIDDEN; h++) s += w[o++] * hidden[h]
        out[off + k] = s
        norm += s * s
    }
    norm = 1 / Math.sqrt(norm)
    for (let k = 0; k < OUT; k++) out[off + k] *= norm
}

function dist(a, ao, b, bo) {
    let s = 0
    for (let k = 0; k < OUT; k++) {
        const d = a[ao + k] - b[bo + k]
        s += d * d
    }
    return s
}

// ---------------------------------------------------------------- data
function loadMembers(args) {
    const files = []
    for (const a of args) {
        const st = fs.statSync(a)
        if (st.isDirectory())
            for (const f of fs.readdirSync(a).sort())
                files.push(path.join(a, f))
        else files.push(a)
    }
    const members = []
    for (const f of files) {
        if (!fs.statSync(f).isFile()) continue
        const bytes = fs.readFileSync(f)
        if (bytes.length < WINDOW * 24) continue
        // The last quarter of every document is the witness: never voted on.
        const split = Math.floor(bytes.length * 0.75)
        members.push({ name: path.basename(f), bytes, split })
    }
    return members
}

// ---------------------------------------------------------------- peer
class Peer {
    constructor(id, members, counters, seed) {
        this.id = id
        this.me = members[id]
        this.rand = mulberry32(seed)
        const others = members.filter((_, i) => i !== id)
        // Hold a few other members, not all of them.
        this.held = []
        const pool = others.slice()
        while (this.held.length < Math.min(HELD, pool.length)) {
            const k = this.rand() % pool.length
            this.held.push(pool.splice(k, 1)[0])
        }
        this.counters = Int32Array.from(counters)
        this.w = new Float32Array(P)
        for (let i = 0; i < P; i++) this.w[i] = this.counters[i] * UNIT
        this.eps = new Int8Array(P)
        this.za = new Float32Array(OUT)
        this.zp = new Float32Array(OUT)
        this.zn = new Float32Array(OUT)
        this.inbox = []
        this.seen = new Set()
        this.liar = false
    }

    window(member) {
        const start = this.rand() % (member.split - WINDOW)
        return trigramBuckets(member.bytes, start)
    }

    batch() {
        const b = []
        for (let i = 0; i < BATCH; i++) {
            const k = this.rand() % this.held.length
            b.push([this.window(this.me), this.window(this.me), this.window(this.held[k]), k])
        }
        return b
    }

    loss(batch, round) {
        let total = 0
        for (const [a, p, n, k] of batch) {
            embed(this.w, a, this.za, 0)
            if (WAVE) {
                // Only the pair matters: mine against someone else's.
                embed(this.w, n, this.zn, 0)
                const miss = dist(this.za, 0, this.zn, 0) - target(round, k)
                total += miss * miss
                continue
            }
            embed(this.w, p, this.zp, 0)
            embed(this.w, n, this.zn, 0)
            const m = dist(this.za, 0, this.zp, 0) - dist(this.za, 0, this.zn, 0)
            total += Math.log1p(Math.exp(m * 4))
        }
        return total / batch.length
    }

    shift(scale) {
        const w = this.w
        const e = this.eps
        for (let i = 0; i < P; i++) w[i] += scale * e[i]
    }

    // Try one direction against my own text. Returns a record, or null.
    probe(seed, round) {
        direction(seed, this.eps)
        const batch = this.batch()
        const r = SIGMA_TICKS * UNIT
        this.shift(r)
        const plus = this.loss(batch, round)
        this.shift(-2 * r)
        const minus = this.loss(batch, round)
        this.shift(r)
        // Restore exactly: floats drift, counters do not.
        const diff = minus - plus
        if (Math.abs(diff) <= ABSTAIN) return null
        const vote = diff > 0 ? 1 : -1
        return { seed, vote: this.liar ? -vote : vote }
    }

    // Fold a record into the counters. Order never matters: integer adds.
    apply(rec) {
        const key = rec.seed * 2 + (rec.vote > 0 ? 1 : 0)
        if (this.seen.has(key)) return
        this.seen.add(key)
        direction(rec.seed, this.eps)
        const c = this.counters
        const w = this.w
        const e = this.eps
        const v = rec.vote
        for (let i = 0; i < P; i++) {
            c[i] += v * e[i]
            w[i] = c[i] * UNIT
        }
    }

    digest() {
        return crypto
            .createHash('sha256')
            .update(Buffer.from(this.counters.buffer))
            .digest('hex')
            .slice(0, 16)
    }
}

// ---------------------------------------------------------------- witness
// Attribution accuracy on text no peer ever voted on: embed held-out windows,
// compare against each member's centroid built from training windows.
function witness(members, counters) {
    const w = new Float32Array(P)
    for (let i = 0; i < P; i++) w[i] = counters[i] * UNIT
    const rand = mulberry32(7)
    const z = new Float32Array(OUT)
    const cents = members.map((m) => {
        const c = new Float32Array(OUT)
        for (let i = 0; i < 48; i++) {
            embed(w, trigramBuckets(m.bytes, rand() % (m.split - WINDOW)), z, 0)
            for (let k = 0; k < OUT; k++) c[k] += z[k] / 48
        }
        return c
    })
    let right = 0
    let total = 0
    let margin = 0
    members.forEach((m, mi) => {
        const span = m.bytes.length - m.split - WINDOW
        for (let i = 0; i < 24; i++) {
            embed(w, trigramBuckets(m.bytes, m.split + (rand() % span)), z, 0)
            let best = -1
            let bd = Infinity
            let runner = Infinity
            cents.forEach((c, ci) => {
                const d = dist(z, 0, c, 0)
                if (d < bd) {
                    runner = bd
                    bd = d
                    best = ci
                } else if (d < runner) runner = d
            })
            const own = dist(z, 0, cents[mi], 0)
            const other = best === mi ? runner : bd
            margin += other - own
            if (best === mi) right++
            total++
        }
    })
    return { acc: right / total, margin: margin / total }
}

// Mean distance between two unseen passages of one member (own), and between
// unseen passages of two different members (other).
function spread(members, counters) {
    const w = new Float32Array(P)
    for (let i = 0; i < P; i++) w[i] = counters[i] * UNIT
    const rand = mulberry32(11)
    const za = new Float32Array(OUT)
    const zb = new Float32Array(OUT)
    const zc = new Float32Array(OUT)
    const pick = (m) =>
        trigramBuckets(m.bytes, m.split + (rand() % (m.bytes.length - m.split - WINDOW)))
    let own = 0
    let other = 0
    let n = 0
    members.forEach((m, mi) => {
        const o = members[(mi + 1) % members.length]
        for (let i = 0; i < 16; i++) {
            embed(w, pick(m), za, 0)
            embed(w, pick(m), zb, 0)
            embed(w, pick(o), zc, 0)
            own += dist(za, 0, zb, 0)
            other += dist(za, 0, zc, 0)
            n++
        }
    })
    return { own: own / n, other: other / n }
}

// ---------------------------------------------------------------- run
const members = loadMembers(process.argv.slice(2))
if (members.length < 3) {
    console.error('need at least three documents of', WINDOW * 24, 'bytes')
    process.exit(1)
}
console.log(`members: ${members.length}   parameters: ${P}   chance: ${(1 / members.length).toFixed(3)}`)

const start = genesis(1)
const peers = members.map((_, i) => new Peer(i, members, start, 1000 + i))
for (let i = 0; i < LIARS; i++) peers[peers.length - 1 - i].liar = true
const delay = mulberry32(99)
const log = []
let nextSeed = 1
let abstained = 0

if (WAVE) {
    MID = spread(members, start).other
    AMP = MID / 2
    console.log(`wave: ${WAVE}  period ${PERIOD} rounds  target ${MID.toFixed(3)} +/- ${AMP.toFixed(3)}`)
}

const report = (round) => {
    const { acc, margin } = witness(members, peers[0].counters)
    if (WAVE) {
        const s = spread(members, peers[0].counters)
        const miss = Math.sqrt(peers[0].loss(peers[0].batch(), round))
        console.log(
            `round ${String(round).padStart(5)}  target ${target(round, 0).toFixed(3)}  ` +
                `other ${s.other.toFixed(3)}  own ${s.own.toFixed(3)}  ` +
                `own/other ${(s.own / s.other).toFixed(2)}  miss ${miss.toFixed(3)}  accuracy ${acc.toFixed(3)}`
        )
        return
    }
    console.log(
        `round ${String(round).padStart(5)}  records ${String(log.length).padStart(6)}  ` +
            `witness accuracy ${acc.toFixed(3)}  margin ${margin.toFixed(4)}`
    )
}

report(0)
const t0 = performance.now()
let probes = 0
let probeMs = 0
let applyMs = 0
let applies = 0
for (let round = 1; round <= ROUNDS; round++) {
    // Every peer probes against its own, possibly stale, copy of the weights.
    for (const peer of peers) {
        for (let k = 0; k < PROBES_PER_ROUND; k++) {
            const tp = performance.now()
            const rec = peer.probe(nextSeed++, round)
            probeMs += performance.now() - tp
            probes++
            if (!rec) {
                abstained++
                continue
            }
            log.push(rec)
            peer.apply(rec)
            // Gossip: every other peer hears it after a random delay.
            for (const other of peers)
                if (other !== peer)
                    other.inbox.push({ at: round + (delay() % 4), rec })
        }
    }
    // Deliver whatever is due, in a different order for every peer.
    for (const peer of peers) {
        const due = peer.inbox.filter((m) => m.at <= round)
        peer.inbox = peer.inbox.filter((m) => m.at > round)
        for (let i = due.length - 1; i > 0; i--) {
            const j = peer.rand() % (i + 1)
            ;[due[i], due[j]] = [due[j], due[i]]
        }
        const ta = performance.now()
        for (const m of due) peer.apply(m.rec)
        applyMs += performance.now() - ta
        applies += due.length
    }
    const every = WAVE ? Math.floor(PERIOD / 8) : Math.floor(ROUNDS / 10)
    if (round % Math.max(1, every) === 0) report(round)
}
const secs = (performance.now() - t0) / 1000

// Drain the gossip that is still in flight, then compare.
for (const peer of peers) {
    for (const m of peer.inbox) peer.apply(m.rec)
    peer.inbox = []
}
// A late joiner replays the log backward from nothing but the genesis seed.
const late = new Peer(0, members, genesis(1), 5)
for (let i = log.length - 1; i >= 0; i--) late.apply(log[i])

const digests = new Set(peers.map((p) => p.digest()))
digests.add(late.digest())
console.log('')
console.log(`probes ${probes}  abstained ${abstained}  records ${log.length}`)
console.log(`liars ${LIARS} of ${peers.length}   abstain threshold ${ABSTAIN}`)
console.log(`one core: ${(probes / (probeMs / 1000)).toFixed(0)} probes/sec   ${(applies / (applyMs / 1000)).toFixed(0)} record applies/sec   (${secs.toFixed(0)}s wall)`)
console.log(`log size at 5 bytes per record: ${(log.length * 5 / 1024).toFixed(1)} KiB`)
console.log(`distinct weight digests across ${peers.length} peers + 1 late joiner: ${digests.size}  (${[...digests].join(', ')})`)
