// Private questions to the swarm memory (next/private-memory.md): the wire
// protocol between an asker and the peers that answer it, over pir.js (the
// retrieval) and contexts.js (the table). The asker learns what a peer's
// table holds for its context; the peer learns nothing of the context,
// only that a question came, and when.
//
// Peers meet on a torrent of their own (swarmFile), not a chat's: a peer
// that answers seeds it, and an asker joins it. On each wire a BEP 10
// extension (src_pir) carries binary messages, a type byte first:
//
//   asker -> peer   HELLO    { nonce }                  on the handshake
//   peer -> asker   OFFER    { v, groups, shape, key, sig }
//                            its table's version and size, and, if it has a
//                            key, its public key and a signature of the nonce
//   asker -> peer   HINT     { v }                      the hint for v...
//   peer -> asker   PART     v, index, total, bytes     ...in parts
//   peer -> asker   CHANGES  from, to, index, total, changes
//                                                        to askers holding a hint,
//                                                        in parts
//   asker -> peer   QUERY    id, v, index, total, bytes one query per question,
//                                                        the same to every peer,
//                                                        in parts
//   peer -> asker   ANSWER   id, v, answer              for the asker's version,
//                                                        rewound if it is older
//   peer -> asker   STALE    id, v                      too old: fetch the hint again
//
// No message is over PART_BYTES and a header: a WebRTC data channel takes
// messages up to the size the other side announces, 64 KiB for Node's
// (node-datachannel), and a larger one ends the connection.
//
// Any peer can answer: the library servers, and browsers, from the chat
// they have kept (answering.js), so asking never hangs on a server. An
// asker given pinned keys (the project's own library servers) counts the
// peers that prove one fully and the rest for half in the vote, and makes
// room for a pinned peer's hint first; with `pinnedOnly`, it hears no one
// else. A
// cautious asker (the browser extension's page fields) keeps continuations
// with digits, links or addresses only when two peers agree on them, so one
// peer cannot plant an account number in a form.
//
// Imports only modules that import nothing, so the stack's peers share it.

import { keysFor, randomHex, sign, verify } from './crypto.js'
import { build, createShelves, match, question, recordOf } from './contexts.js'
import { merge } from './memory.js'
import { extension, send as sendOn, speaks as speaksOn } from './wire.js'
import {
    SHAPE,
    answer,
    createTable,
    elements,
    hint,
    locate,
    mask,
    readRecord,
    rewind,
    select,
    setRecords,
    toBytes,
    toWords,
    updateHint
} from './pir.js'

export const EXTENSION = 'src_pir'
const TYPE = {
    HELLO: 1,
    OFFER: 2,
    HINT: 3,
    PART: 4,
    CHANGES: 5,
    QUERY: 6,
    ANSWER: 7,
    STALE: 8
}
const JSON_TYPES = new Set([TYPE.HELLO, TYPE.OFFER, TYPE.HINT])
// What a peer that answers takes; the rest is an asker's.
export const ANSWERED = new Set([TYPE.HELLO, TYPE.HINT, TYPE.QUERY])
const PART_BYTES = 1 << 15 // hints and queries go in parts of 32 KiB
const MAX_JSON = 4096
const WAIT = 1500 // ms a query's answers are waited for (guesses take them as they come)
const KEEP = 64 // records an asker keeps, by key
const FRESH = 120000 // ms a kept record answers for
const PER_SECOND = 4 // queries a peer answers per wire, at most
const HINT_EVERY = 10000 // ms between hints a peer sends one wire, at least
const HISTORY = 200000 // element changes a peer keeps, to answer older hints
const PUSH = 25000 // element changes pushed to askers (in parts); past that, a new hint
const CHANGE_PART = 2500 // element changes a message carries (12 bytes each)
const MAX_GROUPS = 32 // an answer (912 bytes a group) stays one message
const MAX_HINT = 64 << 20 // bytes an asker takes for one hint, at most
const PEERS = 4 // peers an asker holds hints from, at most
const UNPINNED = 0.5 // what an unpinned peer's answer counts for, when there are pinned keys
const RISKY = /\d|https?:|www\.|@|\.(com|org|net|io)\b/i

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// The torrent askers and answering peers meet on.
export const swarmFile = () =>
    new File(
        [encoder.encode('The Source / private memory / 1')],
        'src-private-memory'
    )

// What must agree between an asker and a peer for a query to make sense.
const shapeOf = ({ cols, n, sigma, p, record, seed }) => ({
    cols,
    n,
    sigma,
    p,
    record,
    seed
})
const sameShape = (a, b) =>
    Object.keys(shapeOf(SHAPE)).every((k) => a?.[k] === b[k])
const proof = (nonce) => `src_pir ${nonce}`

// ------------------------------------------------------------ messages

// A message: its type, then a header of 32-bit numbers, then a body.
function frame(type, header = [], body = new Uint8Array(0)) {
    const out = new Uint8Array(1 + 4 * header.length + body.length)
    const view = new DataView(out.buffer)
    out[0] = type
    header.forEach((value, i) => view.setInt32(1 + 4 * i, value, true))
    out.set(body, 1 + 4 * header.length)
    return out
}

const json = (type, value) =>
    frame(type, [], encoder.encode(JSON.stringify(value)))

function parse(buf) {
    const type = buf[0]
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    const at = (i) => view.getInt32(1 + 4 * i, true)
    if (JSON_TYPES.has(type)) {
        if (buf.length > MAX_JSON) return null
        const value = JSON.parse(decoder.decode(buf.subarray(1)))
        return value && typeof value === 'object' ? { ...value, type } : null
    }
    if (type === TYPE.PART && buf.length >= 13)
        return {
            type,
            v: at(0),
            index: at(1),
            total: at(2),
            bytes: buf.slice(13)
        }
    if (
        type === TYPE.CHANGES &&
        buf.length >= 17 &&
        (buf.length - 17) % 12 === 0
    )
        return {
            type,
            from: at(0),
            to: at(1),
            index: at(2),
            total: at(3),
            bytes: buf.slice(17)
        }
    if (type === TYPE.QUERY && buf.length >= 17)
        return {
            type,
            id: at(0),
            v: at(1),
            index: at(2),
            total: at(3),
            bytes: buf.slice(17)
        }
    if (type === TYPE.ANSWER && buf.length >= 9)
        return { type, id: at(0), v: at(1), words: toWords(buf.subarray(9)) }
    if (type === TYPE.STALE && buf.length === 9)
        return { type, id: at(0), v: at(1) }
    return null
}

const speaks = (wire) => speaksOn(wire, EXTENSION)

// A message to a wire, if it speaks the extension; false if it went nowhere.
export const send = (wire, bytes) => sendOn(wire, EXTENSION, bytes)

// Hints, queries and changes go in parts of `size` bytes (at least one
// part), each framed with its index and their total: false if one went
// nowhere.
function sendParts(wire, type, header, bytes, size = PART_BYTES) {
    const total = Math.max(1, Math.ceil(bytes.length / size))
    for (let index = 0; index < total; index++) {
        if (
            !send(
                wire,
                frame(
                    type,
                    [...header, index, total],
                    bytes.subarray(index * size, (index + 1) * size)
                )
            )
        )
            return false
    }
    return true
}

const inPlace = ({ index, total }) => total >= 1 && index >= 0 && index < total

// A message that came in parts, put back together: `parts` ({ got: [],
// count: 0 }) keeps each part once, and once all `total` have come, their
// bytes are returned in order (null until then).
function collect(parts, { index, total, bytes }) {
    if (parts.got[index]) return null
    parts.got[index] = bytes
    if (++parts.count < total) return null
    const out = new Uint8Array(
        parts.got.reduce((n, part) => n + part.length, 0)
    )
    parts.got.reduce((at, part) => (out.set(part, at), at + part.length), 0)
    return out
}

// A wire extension (BEP 10) handing each message to onMessage(message,
// wire), and { type: 'open' } once the other side is known to speak it.
export const privateExtension = (onMessage) =>
    extension(EXTENSION, parse, onMessage, { opened: true })

// ------------------------------------------------------------ the peer

// A peer that answers privately: its table, built from `text` (load), with
// `groups` groups of columns (how much it can hold), and, with `secret`,
// a key it proves to askers. `handle` takes each message of its wires.
// `hintsPerMinute` and `questionsPerSecond` cap what it gives everyone
// together (a browser gives less than a server). `history` and `push`
// (element changes kept, and pushed) are for tests.
export function createAnswerer({
    groups = 1,
    secret = null,
    shape = SHAPE,
    hintsPerMinute = 120,
    questionsPerSecond = 200,
    history: keep = HISTORY,
    push = PUSH
} = {}) {
    const keys = secret ? keysFor(secret) : null
    const count = groups * shape.cols
    let table = null
    let hinted = null
    let history = [] // { v, changes }: what each version changed
    const nonces = new WeakMap() // wire -> its asker's nonce
    const greeted = new Set() // wires whose asker said hello
    const holders = new Set() // wires holding a hint
    const asked = new WeakMap() // wire -> { at, count }
    const hinting = new WeakMap() // wire -> { v, at }: the last hint it was sent
    const arriving = new WeakMap() // wire -> Map(id -> { v, got, count }): queries in parts
    const given = { hints: [], questions: [] } // when each was given, over the last minute and second
    const allowed = (list, ms, most) => {
        const now = Date.now()
        while (list.length && now - list[0] > ms) list.shift()
        if (list.length >= most) return false
        list.push(now)
        return true
    }
    const stats = { questions: 0, hints: 0 }

    async function offer(wire) {
        if (!table || !nonces.has(wire)) return
        const body = { v: table.version, groups, shape: shapeOf(shape) }
        if (keys) {
            const k = await keys
            Object.assign(body, {
                key: k.pub,
                sig: await sign(k, proof(nonces.get(wire)))
            })
        }
        send(wire, json(TYPE.OFFER, body))
    }

    // The first table: offered once its hint is made.
    async function first(records) {
        const fresh = createTable(records, shape)
        fresh.version = 1
        hinted = await hint(fresh)
        table = fresh
        for (const wire of greeted) offer(wire)
        return { version: table.version, changes: 0 }
    }

    // Records that changed: the table's elements, its hint (a pass over
    // the whole table, if much changed), the history older hints are
    // answered from, and askers holding a hint, sent the changes in parts
    // (or, if there are many, a new offer).
    async function commit(updates) {
        const from = table.version
        const changes = setRecords(table, updates)
        if (changes.length > (table.rows * shape.cols) / 8)
            hinted = await hint(table)
        else if (changes.length) {
            const next = Int32Array.from(hinted)
            await updateHint(next, changes, shape)
            hinted = next
        }
        history.push({ v: table.version, changes })
        let kept = 0
        history = history
            .reverse()
            .filter((entry) => (kept += entry.changes.length) <= keep)
            .reverse()
        if (changes.length > push) for (const wire of holders) offer(wire)
        else {
            const body = toBytes(
                Int32Array.from(
                    changes.flatMap(({ row, column, change }) => [
                        row,
                        column,
                        change
                    ])
                )
            )
            for (const wire of holders)
                sendParts(
                    wire,
                    TYPE.CHANGES,
                    [from, table.version],
                    body,
                    CHANGE_PART * 12
                )
        }
        return { version: table.version, changes: changes.length }
    }

    // The table from `text`, built anew (a library server's sources); after
    // the first, only the records that differ change.
    async function load(text, options = {}) {
        const records = build(text, count, options)
        return table
            ? commit(records.map((bytes, index) => [index, bytes]))
            : first(records)
    }

    // The table kept a line at a time (a browser's library, contexts.js
    // createShelves): `library` as it now stands, room by room; only the
    // records its new and dropped lines touch change.
    let shelves = null
    async function sync(library, { weigh } = {}) {
        shelves ??= createShelves(count)
        const touched = shelves.sync(library, weigh)
        return table
            ? commit(
                  [...touched].map((index) => [index, shelves.record(index)])
              )
            : first(shelves.records())
    }

    // A query whose parts have all come, as words; null until then. A wire
    // has a few queries arriving at most, and each the right size.
    function assemble(message, wire) {
        if (
            message.total !== Math.ceil((shape.cols * 4) / PART_BYTES) ||
            !inPlace(message)
        )
            return null
        if (!arriving.has(wire)) arriving.set(wire, new Map())
        const pending = arriving.get(wire)
        if (!pending.has(message.id)) {
            if (pending.size >= 4) pending.delete(pending.keys().next().value)
            pending.set(message.id, { v: message.v, got: [], count: 0 })
        }
        const query = pending.get(message.id)
        const bytes = query.v === message.v && collect(query, message)
        if (!bytes) return null
        pending.delete(message.id)
        return bytes.length === shape.cols * 4 ? toWords(bytes) : null
    }

    // The changes since version v, or null when they are no longer kept.
    function since(v) {
        const after = history.filter((entry) => entry.v > v)
        if (after.length !== table.version - v) return null
        return after.flatMap((entry) => entry.changes)
    }

    function handle(message, wire) {
        if (
            message.type === TYPE.HELLO &&
            typeof message.nonce === 'string' &&
            message.nonce.length <= 128
        ) {
            nonces.set(wire, message.nonce)
            if (!greeted.has(wire)) {
                greeted.add(wire)
                wire.once?.('close', () => {
                    greeted.delete(wire)
                    holders.delete(wire)
                })
            }
            return offer(wire)
        }
        if (!table) return
        if (message.type === TYPE.HINT) {
            if (message.v !== table.version) return offer(wire)
            // One hint of a version per wire every HINT_EVERY: each is megabytes.
            const now = Date.now()
            const last = hinting.get(wire)
            if (last?.v === table.version && now - last.at < HINT_EVERY) return
            if (!allowed(given.hints, 60000, hintsPerMinute)) return
            hinting.set(wire, { v: table.version, at: now })
            sendParts(wire, TYPE.PART, [table.version], toBytes(hinted))
            holders.add(wire)
            stats.hints++
            return
        }
        if (message.type === TYPE.QUERY) {
            const query = assemble(message, wire)
            if (!query) return
            const now = Date.now()
            const seen = asked.get(wire) ?? { at: now, count: 0 }
            if (now - seen.at > 1000) Object.assign(seen, { at: now, count: 0 })
            asked.set(wire, seen)
            if (++seen.count > PER_SECOND) return
            if (!allowed(given.questions, 1000, questionsPerSecond)) return
            stats.questions++
            let out = answer(table, query)
            if (message.v !== table.version) {
                const changes = since(message.v)
                if (!changes) {
                    send(wire, frame(TYPE.STALE, [message.id, table.version]))
                    return offer(wire)
                }
                out = rewind(out, query, changes)
            }
            send(
                wire,
                frame(TYPE.ANSWER, [message.id, message.v], toBytes(out))
            )
        }
    }

    // Loads and syncs run one after another: two at once could each make a
    // first table, or interleave their changes.
    let queue = Promise.resolve()
    const inTurn =
        (fn) =>
        (...args) =>
            (queue = queue.then(
                () => fn(...args),
                () => fn(...args)
            ))

    return {
        handle,
        load: inTurn(load),
        sync: inTurn(sync),
        stats,
        get version() {
            return table?.version ?? 0
        }
    }
}

// ------------------------------------------------------------ the asker

// An asker: `handle` takes each message of its wires. A question is about
// the record its context's key picks (contexts.js): the 12 characters
// before the word being typed. So the record can be fetched as the word
// starts (`prefetch`), and every guess within the word is answered from it
// at once, the letters typed so far filtering it here (`ask`), which also
// hides the transport's delay (a query is 64 KiB, which a data channel
// takes 150 ms or more to carry after a pause). `ask(context, update)` calls
// update(memory, done) as recall.js's does: memory.js's merge of the
// peers' answers, or null. With `pinned` (public keys), only peers that
// prove one are heard; `cautious` keeps risky continuations only where two
// peers agree.
export function createAsker({
    pinned = [],
    pinnedOnly = false,
    cautious = false,
    shape = SHAPE,
    pool = 6
} = {}) {
    const peers = new Map() // wire -> { nonce, offer, trusted, hint, version, parts, changing }
    const masks = []
    let filling = null
    let next = 0
    const waiting = new Map() // query id -> { entry, mask, sent, from, timer }
    const fetched = new Map() // key hash -> entry: { asked, versions, records, done, at, waiters }
    let queued = null // the latest entry, waiting for a mask
    const counts = { asked: 0, answered: 0, dropped: 0 }

    // Masks are most of an asker's work (about 130 ms each): a few are kept
    // made, and the latest fetch waits for the next if none is left.
    function fill() {
        // Cleared once settled (a finally inside would run before the
        // assignment when there is nothing to make, and never clear it).
        filling ??= make()
            .catch((err) => console.warn('private:', err.message || err))
            .finally(() => (filling = null))
        return filling
    }

    async function make() {
        while (masks.length < pool) {
            masks.push(await mask(shape))
            const entry = queued
            queued = null
            if (entry) put(entry)
        }
    }

    const holding = () =>
        [...peers.values()].filter((peer) => peer.hint || peer.parts).length

    async function onOffer(message, wire, peer) {
        if (
            !sameShape(message.shape, shape) ||
            !(message.groups >= 1 && message.groups <= MAX_GROUPS) ||
            !(message.v >= 1)
        )
            return
        const trusted =
            typeof message.key === 'string' &&
            pinned.includes(message.key) &&
            (await verify(message.key, message.sig, proof(peer.nonce)))
        if (pinnedOnly && !trusted) return
        peer.offer = message
        peer.trusted = trusted
        if (peer.version === message.v) return
        if (!peer.hint && !peer.parts && holding() >= PEERS) {
            // A pinned peer takes an unpinned one's place.
            const other =
                trusted &&
                [...peers.values()].find(
                    (p) => !p.trusted && (p.hint || p.parts)
                )
            if (!other) return
            Object.assign(other, { hint: null, parts: null, version: 0 })
        }
        peer.parts = { v: message.v, got: [], count: 0 }
        send(wire, json(TYPE.HINT, { v: message.v }))
    }

    function onPart(message, peer) {
        const parts = peer.parts
        if (
            !parts ||
            message.v !== parts.v ||
            !inPlace(message) ||
            message.total * PART_BYTES > MAX_HINT
        )
            return
        const bytes = collect(parts, message)
        if (!bytes) return
        peer.parts = null
        if (bytes.length !== peer.offer.groups * elements(shape) * shape.n * 4)
            return
        peer.hint = toWords(bytes)
        peer.version = parts.v
        fill()
    }

    // Changes come in parts; applied once all have come, to a copy (answers
    // being read meanwhile use the hint they were asked under).
    async function onChanges(message, peer) {
        if (!peer.hint || peer.version !== message.from || !inPlace(message))
            return
        if (peer.changing?.to !== message.to)
            peer.changing = { to: message.to, got: [], count: 0 }
        const bytes = collect(peer.changing, message)
        if (!bytes) return
        peer.changing = null
        const words = toWords(bytes)
        const changes = []
        for (let i = 0; i < words.length; i += 3)
            changes.push({
                row: words[i],
                column: words[i + 1],
                change: words[i + 2]
            })
        const next = Int32Array.from(peer.hint)
        await updateHint(next, changes, shape)
        if (peer.version !== message.from) return
        peer.hint = next
        peer.version = message.to
    }

    function onAnswer(message, wire) {
        const q = waiting.get(message.id)
        const sent = q?.sent.get(wire)
        if (!sent || q.from.has(wire) || sent.v !== message.v) return
        q.from.add(wire)
        // An answer of the wrong size is a peer's mistake, and says nothing.
        if (message.words.length === sent.groups * elements(shape)) {
            const group = locate(
                recordOf(q.entry.asked, sent.groups * shape.cols),
                shape
            ).group
            q.entry.records.set(
                wire,
                readRecord(message.words, sent.hint, q.mask, group)
            )
        }
        counts.answered++
        if (q.from.size < q.sent.size) report(q.entry, false)
        else finish(message.id)
    }

    function handle(message, wire) {
        if (message.type === 'open') {
            const peer = {
                nonce: randomHex(32),
                offer: null,
                trusted: false,
                hint: null,
                version: 0,
                parts: null,
                changing: null
            }
            peers.set(wire, peer)
            wire.once?.('close', () => peers.delete(wire))
            return send(wire, json(TYPE.HELLO, { nonce: peer.nonce }))
        }
        const peer = peers.get(wire)
        if (!peer) return
        if (message.type === TYPE.OFFER) return onOffer(message, wire, peer)
        if (message.type === TYPE.PART) return onPart(message, peer)
        if (message.type === TYPE.CHANGES) return onChanges(message, peer)
        if (message.type === TYPE.ANSWER) return onAnswer(message, wire)
        // Too old to answer: a new offer follows, and with it a new hint.
        if (message.type === TYPE.STALE) {
            peer.hint = null
            peer.version = 0
        }
    }

    // The peers a question can go to now.
    const ready = () =>
        [...peers].filter(([wire, peer]) => peer.hint && speaks(wire))

    // Continuations with digits, links or addresses, kept only where two
    // peers agree.
    function careful(answers) {
        if (!cautious) return answers
        const agree = new Map()
        for (const a of answers)
            for (const [text] of a.spans)
                agree.set(text, (agree.get(text) || 0) + 1)
        return answers.map((a) => ({
            ...a,
            spans: a.spans.filter(
                ([text]) => !RISKY.test(text) || agree.get(text) >= 2
            )
        }))
    }

    // What an entry's records say about a question (its partial word may be
    // longer than the one the entry was fetched for). Unpinned peers count
    // for less in the vote, but the memory as a whole counts as fully as the
    // chat's own (w 1), pinned peers there or not.
    function memoryOf(entry, asked) {
        const answers = [...entry.records].map(([wire, record]) => ({
            ...match(record, asked),
            w: pinned.length && !peers.get(wire)?.trusted ? UNPINNED : 1
        }))
        const memory = merge(careful(answers))
        return memory.L ? { ...memory, w: 1 } : null
    }

    const report = (entry, done) =>
        entry.waiters.forEach((w) => w.tell(memoryOf(entry, w.asked), done))

    function settle(entry) {
        if (entry.done) return
        entry.done = true
        entry.at = Date.now()
        report(entry, true)
        entry.waiters.clear()
    }

    // A query done with, all its peers answered or not.
    function finish(id) {
        const q = waiting.get(id)
        clearTimeout(q.timer)
        waiting.delete(id)
        settle(q.entry)
    }

    // An entry still good: answered by every peer ready now, at its
    // version, not long ago (one that timed out is fetched again).
    const fresh = (entry) =>
        Date.now() - entry.at < FRESH &&
        ready().every(
            ([wire, peer]) =>
                entry.versions.get(wire) === peer.version &&
                entry.records.has(wire)
        )

    // The entry for a question's key: kept if in flight or fresh, else
    // fetched anew, or always (`anew`), a fresh kept one's records answering
    // until the new ones come. Only the latest waits for a mask; an older one
    // waiting is let go (its guesses get nothing).
    function fetch(asked, anew = false) {
        const kept = fetched.get(asked.hash)
        const good = kept && (!kept.done || fresh(kept))
        if (good && !anew) return kept
        const entry = {
            asked,
            versions: new Map(),
            records: new Map(good ? kept.records : []),
            done: false,
            at: Date.now(),
            waiters: new Set()
        }
        fetched.delete(asked.hash)
        fetched.set(asked.hash, entry)
        while (fetched.size > KEEP) fetched.delete(fetched.keys().next().value)
        if (queued) {
            counts.dropped++
            if (fetched.get(queued.asked.hash) === queued)
                fetched.delete(queued.asked.hash)
            settle(queued)
            queued = null
        }
        put(entry)
        return entry
    }

    // A query for an entry's record to every ready peer, under the next
    // mask, or once one is made.
    function put(entry) {
        const to = ready()
        if (!to.length) return settle(entry)
        const masked = masks.shift()
        fill()
        if (!masked) return void (queued = entry)
        counts.asked++
        const id = ++next
        const q = {
            entry,
            mask: masked,
            sent: new Map(),
            from: new Set(),
            timer: null
        }
        waiting.set(id, q)
        const body = toBytes(select(masked, entry.asked.hash % shape.cols))
        for (const [wire, peer] of to) {
            if (!sendParts(wire, TYPE.QUERY, [id, peer.version], body)) continue
            q.sent.set(wire, {
                v: peer.version,
                hint: peer.hint,
                groups: peer.offer.groups
            })
            entry.versions.set(wire, peer.version)
        }
        if (!q.sent.size) return finish(id)
        q.timer = setTimeout(() => finish(id), WAIT)
    }

    function ask(context, update) {
        const tell = (memory, done) => {
            try {
                update(memory, done)
            } catch (err) {
                console.warn('private:', err.message || err)
            }
        }
        const asked = question(context)
        if (!asked || !ready().length) return tell(null, true)
        const entry = fetch(asked)
        if (entry.done) return tell(memoryOf(entry, asked), true)
        if (entry.records.size) tell(memoryOf(entry, asked), false)
        entry.waiters.add({ asked, tell })
    }

    // Fetch the record a context's key picks as its word starts, for the
    // guesses to come: always a query, so a peer cannot tell a context it
    // was asked about before (a kept record would have sent none).
    function prefetch(context) {
        const asked = question(context)
        if (asked && ready().length) fetch(asked, true)
    }

    const status = () => ({
        peers: peers.size,
        ready: ready().length,
        trusted: ready().filter(([, p]) => p.trusted).length,
        masks: masks.length,
        ...counts
    })

    return {
        handle,
        ask,
        prefetch,
        fill,
        status,
        ready: () => ready().length > 0
    }
}
