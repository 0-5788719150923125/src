// Crawl probe: one shared table of integer counters, moved only by steps that
// are the trigram difference between a peer's signature passage and a passage
// it chose to read, while a periodic target says when to push and when to pull.
//
//   node next/crawl.mjs <corpus.bin>
//   RULE=sharpen PHASE=own PEERS=256 node next/crawl.mjs <corpus.bin>
//
// See next/crawl.md. corpus.bin is plain documents, each exactly 4096 bytes,
// concatenated; next/cut_corpus.py cuts one from a parquet file. The first
// 800 are held out and never read by any peer, the next PEERS are signatures
// (one per peer), and the rest are the library.
//
// The model is linear: a passage is the set of trigrams it contains, and its
// embedding is the sum of their rows in the table. So the distance between
// two passages depends only on the trigrams one has and the other lacks, and
// a step along that difference is an exact integer delta: +1 or -1 per row.
//
// A peer's loss is the mean distance from its signature passages to its
// ruler: a few library passages it drew once and keeps. The wave is a target
// for that loss. Each tick a peer that is off the wave is offered K fresh
// library passages and steps along one of them, or along none.
//
// RULE picks which of the K passages on offer a peer steps along:
//   random    any of them
//   fit       the one whose predicted effect lands nearest the wave
//   sharpen   push the farthest away, pull the nearest in
//   soften    push the nearest away, pull the farthest in
//   lean      sharpen's choice, but only among passages that are predicted
//             to bring the peer nearer the wave
//   contrast  no wave, no signature: pull two passages of one library
//             document together, push two documents apart (a reference for
//             what this table can learn when told what goes with what)
// CODE is how a step is spread over the table's columns. Every column gets
// the same passage difference, times a small integer per column:
//   sign      +1 or -1, by the sign of that column's current projection
//   scaled    -4..4, in proportion to that column's current projection
// PHASE is `shared` (one wave for the swarm) or `own` (each peer's wave is
// offset, spread evenly around the cycle). STALE=1 makes every peer in a tick
// decide against the same table before any step lands.

//
// Each line of output covers one cycle:
//   auc      held-out documents: how often a passage sits closer to the other
//            half of its own document than to a stranger's (0.5 is chance)
//   dims     how many directions the embeddings use, out of 16
//   miss     mean gap between a peer's loss and its wave (wave height: DEPTH)
//   stepped  share of peer ticks that took a step
//   swing    how far held-out distances moved within the cycle
//   drift    net table movement over total movement, squared: 1 is a random
//            walk, below 1 the steps cancel, above 1 they add up
//   overlap  mean cosine between two peers' net contributions

import fs from 'node:fs'
import crypto from 'node:crypto'

// ---------------------------------------------------------------- config
const DOC = 4096 // bytes per document
const WINDOW = 512 // bytes per passage
const BUCKETS = 8192 // hashed trigram buckets
const DIM = 16 // embedding width
const P = BUCKETS * DIM
const HELDOUT = 800 // documents no peer ever reads
const SIG = 4 // passages in a signature
const RULER = 4 // library passages a peer measures itself against
const TRACKED = SIG * RULER
const SPAN = Number(process.env.SPAN || 384) // genesis counters lie in [-SPAN, SPAN]
const PEERS = Number(process.env.PEERS || 128)
const K = Number(process.env.K || 8) // passages on offer per tick
const PERIOD = Number(process.env.PERIOD || 128) // ticks per cycle
const CYCLES = Number(process.env.CYCLES || 6)
const DEPTH = Number(process.env.DEPTH || 0.25) // wave height, as a fraction of the midline
const TOL = Number(process.env.TOL || 0.02) // inside this, a peer does nothing
const RULE = process.env.RULE || 'fit'
const PHASE = process.env.PHASE || 'shared'
const STALE = process.env.STALE === '1'
const CODE = process.env.CODE || 'scaled'
const LEVELS = 4

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

function genesis(seed) {
    const next = mulberry32(seed)
    const c = new Int32Array(P)
    for (let i = 0; i < P; i++) c[i] = (next() % (2 * SPAN + 1)) - SPAN
    return c
}

// ---------------------------------------------------------------- data
const corpus = fs.readFileSync(process.argv[2])
const DOCS = Math.floor(corpus.length / DOC)
const LIBRARY = HELDOUT + PEERS // first library document
if (DOCS - LIBRARY < 100) {
    console.error('corpus too small for', PEERS, 'peers')
    process.exit(1)
}

const dense = new Int8Array(BUCKETS)
const mark = new Uint8Array(BUCKETS)

function accumulate(start, sign, list) {
    const bit = sign > 0 ? 2 : 4
    for (let i = 0; i < WINDOW - 2; i++) {
        const h =
            Math.imul(corpus[start + i], 0x9e3779b1) ^
            Math.imul(corpus[start + i + 1], 0x85ebca6b) ^
            Math.imul(corpus[start + i + 2], 0xc2b2ae35)
        const b = ((h ^ (h >>> 15)) >>> 0) % BUCKETS
        if (!mark[b]) list.push(b)
        if (mark[b] & bit) continue
        mark[b] |= bit
        dense[b] += sign
    }
}

// Trigrams passage `a` contains (+1), less those passage `x` contains (-1).
function difference(a, x) {
    const list = []
    accumulate(a, 1, list)
    if (x >= 0) accumulate(x, -1, list)
    const ids = []
    const vals = []
    for (const b of list) {
        if (dense[b] !== 0) {
            ids.push(b)
            vals.push(dense[b])
        }
        dense[b] = 0
        mark[b] = 0
    }
    return { ids, vals, sq: ids.length }
}

// z = table^T * d. Returns the squared length of z.
function project(table, d, z) {
    z.fill(0)
    const { ids, vals } = d
    for (let i = 0; i < ids.length; i++) {
        const row = ids[i] * DIM
        const v = vals[i]
        for (let k = 0; k < DIM; k++) z[k] += table[row + k] * v
    }
    let s = 0
    for (let k = 0; k < DIM; k++) s += z[k] * z[k]
    return s
}

// Add sign * d (x) q into `into`. This is the whole of a step.
function step(into, d, sign, q) {
    const { ids, vals } = d
    for (let i = 0; i < ids.length; i++) {
        const row = ids[i] * DIM
        const v = vals[i] * sign
        for (let k = 0; k < DIM; k++) into[row + k] += v * q[k]
    }
}

const scratch = new Int8Array(BUCKETS)

// ---------------------------------------------------------------- measures
// Held-out documents: passage A from the start, passage B from the middle.
// Can the table match each A to the B of the same document?
const heldA = []
const heldB = []
for (let i = 0; i < HELDOUT; i++) {
    heldA.push(difference(i * DOC, -1))
    heldB.push(difference(i * DOC + 2048, -1))
}
const za = new Float64Array(HELDOUT * DIM)
const zb = new Float64Array(HELDOUT * DIM)
const zt = new Float64Array(DIM)

function heldout(table) {
    for (let i = 0; i < HELDOUT; i++) {
        project(table, heldA[i], zt)
        za.set(zt, i * DIM)
        project(table, heldB[i], zt)
        zb.set(zt, i * DIM)
    }
    let auc = 0
    let other = 0
    for (let i = 0; i < HELDOUT; i++) {
        let mine = 0
        for (let k = 0; k < DIM; k++) {
            const d = za[i * DIM + k] - zb[i * DIM + k]
            mine += d * d
        }
        let rank = 1
        for (let j = 0; j < HELDOUT; j++) {
            if (j === i) continue
            let s = 0
            for (let k = 0; k < DIM; k++) {
                const d = za[i * DIM + k] - zb[j * DIM + k]
                s += d * d
            }
            if (s < mine) rank++
            if (j === (i + 1) % HELDOUT) other += s
        }
        auc += (HELDOUT - rank) / (HELDOUT - 1)
    }
    // How many directions the embeddings really use: the participation ratio
    // of their covariance. DIM if they fill the space, 1 if they sit on a line.
    const mean = new Float64Array(DIM)
    for (let i = 0; i < HELDOUT; i++)
        for (let k = 0; k < DIM; k++) mean[k] += za[i * DIM + k] / HELDOUT
    const cov = new Float64Array(DIM * DIM)
    for (let i = 0; i < HELDOUT; i++)
        for (let k = 0; k < DIM; k++) {
            const u = za[i * DIM + k] - mean[k]
            for (let l = 0; l < DIM; l++) cov[k * DIM + l] += u * (za[i * DIM + l] - mean[l])
        }
    let trace = 0
    let square = 0
    for (let k = 0; k < DIM; k++) trace += cov[k * DIM + k]
    for (let i = 0; i < DIM * DIM; i++) square += cov[i] * cov[i]
    return { auc: auc / HELDOUT, other: other / HELDOUT, dims: (trace * trace) / square }
}

const digest = (table) =>
    crypto.createHash('sha256').update(Buffer.from(table.buffer)).digest('hex').slice(0, 16)

// ---------------------------------------------------------------- swarm
const table = genesis(1)
const origin = Int32Array.from(table)
const KEEP_NET = PEERS <= 512
const offer = (rand) =>
    (LIBRARY + (rand() % (DOCS - LIBRARY))) * DOC + (rand() % (DOC - WINDOW + 1))
const Z = Array.from({ length: K }, () => new Float64Array(DIM))
const ZT = Array.from({ length: TRACKED }, () => new Float64Array(DIM))

// A peer's loss: mean distance over its tracked pairs, in units of its own
// value at genesis. Leaves each pair's projection in ZT.
function loss(peer) {
    let s = 0
    for (let t = 0; t < TRACKED; t++) s += project(table, peer.tracked[t], ZT[t])
    return s / TRACKED / peer.mid
}

const peers = []
for (let i = 0; i < PEERS; i++) {
    const doc = (HELDOUT + i) * DOC
    const rand = mulberry32(1000 + i)
    const sig = Array.from({ length: SIG }, (_, n) => doc + n * WINDOW)
    const ruler = Array.from({ length: RULER }, () => offer(rand))
    const peer = {
        rand,
        sig,
        tracked: sig.flatMap((a) => ruler.map((r) => difference(a, r))),
        mid: 1,
        phase: PHASE === 'own' ? i / PEERS : 0,
        net: KEEP_NET ? new Int32Array(P) : null,
    }
    peer.mid = loss(peer)
    peers.push(peer)
}
const wave = (tick, peer) => 1 + DEPTH * Math.sin(2 * Math.PI * (tick / PERIOD + peer.phase))

console.log(
    `rule ${RULE}  phase ${PHASE}  peers ${PEERS}  library ${DOCS - LIBRARY} documents  ` +
        `counters ${P}  period ${PERIOD}  depth ${DEPTH}  code ${CODE}`
)

const pending = new Int32Array(P)
const q = new Int8Array(DIM)
const D = new Array(K)
const dist = new Float64Array(K)
const log = []
let gross = 0
let missSum = 0
let stepped = 0
let lo = Infinity
let hi = -Infinity

// The per-column integers for a step along `d`, given its projection `z`.
// A pull never carries a coordinate through zero. Returns the sum of squares.
function code(z, d, sign, out) {
    let top = 0
    for (let k = 0; k < DIM; k++) top = Math.max(top, Math.abs(z[k]))
    let sq = 0
    for (let k = 0; k < DIM; k++) {
        let c = z[k] > 0 ? 1 : z[k] < 0 ? -1 : 0
        if (CODE === 'scaled') c = top ? Math.round((LEVELS * z[k]) / top) : 0
        if (sign < 0 && Math.abs(z[k]) <= d.sq * Math.abs(c)) c = 0
        out[k] = c
        sq += c * c
    }
    return sq
}

function take(peer, d, sign, z) {
    const sq = code(z, d, sign, q)
    if (!sq) return
    step(STALE ? pending : table, d, sign, q)
    if (peer.net) step(peer.net, d, sign, q)
    gross += d.sq * sq
    log.push({ d, sign, q: Int8Array.from(q) })
    stepped++
}

function act(peer, tick) {
    const rand = peer.rand
    if (RULE === 'contrast') {
        const doc = (LIBRARY + (rand() % (DOCS - LIBRARY))) * DOC
        const a = doc + (rand() % (DOC / 2 - WINDOW))
        const pull = tick % 2 === 0
        const d = difference(a, pull ? a + DOC / 2 : offer(rand))
        project(table, d, Z[0])
        take(peer, d, pull ? -1 : 1, Z[0])
        return
    }
    const goal = wave(tick, peer)
    const now = loss(peer)
    const need = goal - now
    missSum += Math.abs(need)
    if (Math.abs(need) <= TOL) return
    const sign = need > 0 ? 1 : -1
    const a = peer.sig[rand() % SIG]
    for (let j = 0; j < K; j++) {
        D[j] = difference(a, offer(rand))
        dist[j] = project(table, D[j], Z[j])
    }
    let pick = 0
    if (RULE === 'random') pick = rand() % K
    else if (RULE === 'sharpen' || RULE === 'soften') {
        // sharpen: push the farthest, pull the nearest. soften: the reverse.
        const far = (RULE === 'sharpen') === sign > 0
        for (let j = 1; j < K; j++)
            if (far ? dist[j] > dist[pick] : dist[j] < dist[pick]) pick = j
    } else {
        // fit: predict my loss after stepping along each passage on offer,
        // and take the one that lands nearest the wave. lean: of those that
        // land nearer at all, take the farthest to push or the nearest to pull.
        let best = Math.abs(need)
        pick = -1
        for (let j = 0; j < K; j++) {
            const d = D[j]
            code(Z[j], d, sign, q)
            for (let i = 0; i < d.ids.length; i++) scratch[d.ids[i]] = d.vals[i]
            let after = 0
            for (let t = 0; t < TRACKED; t++) {
                const o = peer.tracked[t]
                let c = 0
                for (let i = 0; i < o.ids.length; i++) c += scratch[o.ids[i]] * o.vals[i]
                c *= sign
                for (let k = 0; k < DIM; k++) {
                    const v = ZT[t][k] + c * q[k]
                    after += v * v
                }
            }
            for (let i = 0; i < d.ids.length; i++) scratch[d.ids[i]] = 0
            after = after / TRACKED / peer.mid
            const left = Math.abs(goal - after)
            if (left >= Math.abs(need)) continue
            if (RULE === 'lean') {
                if (pick < 0 || (sign > 0 ? dist[j] > dist[pick] : dist[j] < dist[pick])) pick = j
            } else if (left < best) {
                best = left
                pick = j
            }
        }
        if (pick < 0) return
    }
    take(peer, D[pick], sign, Z[pick])
}

function overlap() {
    let whole = 0
    let parts = 0
    for (let i = 0; i < P; i++) {
        const d = table[i] - origin[i]
        whole += d * d
    }
    if (!KEEP_NET) return { whole, cos: NaN }
    for (const p of peers) for (let i = 0; i < P; i++) parts += p.net[i] * p.net[i]
    return { whole, cos: parts ? (whole - parts) / ((PEERS - 1) * parts) : 0 }
}

const fmt = (x, n = 3) => (Number.isFinite(x) ? x.toFixed(n) : '-')
const line = (cycle, auc, dims, extra) =>
    console.log(`cycle ${String(cycle).padStart(2)}  auc ${fmt(auc)}  dims ${fmt(dims, 1)}` + extra)
const first = heldout(table)
line(0, first.auc, first.dims, '')
let aucSum = 0
let dimsSum = 0
const order = peers.map((_, i) => i)
const shuffle = mulberry32(77)

const t0 = performance.now()
for (let tick = 1; tick <= PERIOD * CYCLES; tick++) {
    for (let i = PEERS - 1; i > 0; i--) {
        const j = shuffle() % (i + 1)
        ;[order[i], order[j]] = [order[j], order[i]]
    }
    for (const i of order) act(peers[i], tick)
    if (STALE) {
        for (let i = 0; i < P; i++) table[i] += pending[i]
        pending.fill(0)
    }
    if (tick % (PERIOD / 8) === 0) {
        // auc and dims are averaged over eight looks per cycle.
        const h = heldout(table)
        aucSum += h.auc / 8
        dimsSum += h.dims / 8
        lo = Math.min(lo, h.other / first.other)
        hi = Math.max(hi, h.other / first.other)
        if (tick % PERIOD === 0) {
            const o = overlap()
            const n = PERIOD * PEERS
            line(
                tick / PERIOD,
                aucSum,
                dimsSum,
                `  miss ${fmt(RULE === 'contrast' ? NaN : missSum / n)}  stepped ${fmt(stepped / n, 2)}` +
                    `  swing ${fmt(hi - lo, 2)}  drift ${fmt(o.whole / gross, 2)}  overlap ${fmt(o.cos, 4)}`
            )
            aucSum = dimsSum = missSum = stepped = 0
            lo = Infinity
            hi = -Infinity
        }
    }
}
const secs = (performance.now() - t0) / 1000

// Replay every step backward onto a fresh genesis table.
const late = genesis(1)
for (let i = log.length - 1; i >= 0; i--) step(late, log[i].d, log[i].sign, log[i].q)
console.log('')
console.log(`steps ${log.length}   ${(PEERS * PERIOD * CYCLES / secs).toFixed(0)} peer ticks/sec on one core`)
console.log(`replayed backward: ${digest(late) === digest(table) ? 'same table' : 'DIFFERENT TABLE'}  (${digest(table)})`)
