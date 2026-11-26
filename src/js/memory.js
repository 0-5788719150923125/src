// Swarm memory: what a room's peers remember, asked for while you type.
//
// A peer that remembers holds some text and an index over it. A question
// carries the end of the conversation and the line being typed; the answer
// is the longest stretch of remembered text that ends the same way, and
// what followed it there (a few short spans, with how often each came).
// The writer mixes those spans into its own guess (writer.worker.js): the
// longer the match, the more they count, and with no match the ghost text
// is the model's alone.
//
// Everything is in characters, not tokens, so a peer needs no tokenizer
// and any language works. The index is a suffix array of the text read
// backward: a context, read backward from its newest character, is then a
// prefix to look up, and each older character only narrows the range found
// so far.
//
// Shared verbatim by the browser and the stack's peers
// (containers/node/peers.js).

import { extension, json, readJson, send, speaks } from './wire.js'

export const EXTENSION = 'src_memory'
export const MAX_BYTES = 16384
export const CONTEXT = 160 // characters of context a question carries
export const DEPTH = 64 // longest match considered, in characters
export const SPAN = 48 // characters of continuation an answer carries
export const SPANS = 12 // continuations an answer carries, at most
export const MIN_MATCH = 8 // shorter matches say nothing
// Matches within a quarter of the longest count too: in one lookup, between
// rooms, and between peers. What came just before a line should not decide
// alone which memory of it wins.
export const NEAR = 0.75
// What text from other rooms counts for, against the room a question came
// through (1): a weighted vote.
export const OTHER_ROOM = 0.3

// ------------------------------------------------------------ the index

// Matching ignores case, so "the" remembers "The"; what comes back is the
// text as written. Lowercasing keeps every position where it was for plain
// text (all the chat allows); where it would not, matching keeps case.
export const folded = (text) => {
    const lower = text.toLowerCase()
    return lower.length === text.length ? lower : text
}

// The text, and a suffix array of it read backward (case folded), ordered
// on their first DEPTH characters. Built by prefix doubling: each round
// sorts on twice as many characters as the last. The previous round's order
// already sorts on the second half, so a round is one counting sort on the
// first; repetitive text costs no more than any other.
export function index(text) {
    const n = text.length
    const R = new Uint16Array(n)
    const match = folded(text)
    for (let i = 0; i < n; i++) R[i] = match.charCodeAt(n - 1 - i)
    let rank = new Int32Array(n)
    let next = new Int32Array(n)
    const sa = new Int32Array(n)
    const order = new Int32Array(n)
    // Round zero: order on the first character.
    let count = new Int32Array(65537)
    for (let i = 0; i < n; i++) count[R[i] + 1]++
    for (let c = 1; c <= 65536; c++) count[c] += count[c - 1]
    for (let i = 0; i < n; i++) sa[count[R[i]]++] = i
    let classes = 0
    for (let j = 0; j < n; j++) {
        if (j === 0 || R[sa[j]] !== R[sa[j - 1]]) classes++
        rank[sa[j]] = classes
    }
    count = new Int32Array(n + 2)
    for (let k = 1; k < DEPTH && classes < n; k <<= 1) {
        // Ordered on the second half: suffixes too short to have one, then
        // the rest in the order their second halves already have.
        let at = 0
        for (let i = n - k; i < n; i++) order[at++] = i
        for (let j = 0; j < n; j++) if (sa[j] >= k) order[at++] = sa[j] - k
        // A stable counting sort on the first half.
        count.fill(0, 0, classes + 2)
        for (let j = 0; j < n; j++) count[rank[order[j]] + 1]++
        for (let c = 1; c <= classes + 1; c++) count[c] += count[c - 1]
        for (let j = 0; j < n; j++) {
            const i = order[j]
            sa[count[rank[i]]++] = i
        }
        classes = 0
        for (let j = 0; j < n; j++) {
            const b = sa[j]
            if (j === 0) classes = 1
            else {
                const a = sa[j - 1]
                if (
                    rank[a] !== rank[b] ||
                    (a + k < n ? rank[a + k] : 0) !==
                        (b + k < n ? rank[b + k] : 0)
                )
                    classes++
            }
            next[b] = classes
        }
        ;[rank, next] = [next, rank]
    }
    return { text, R, sa }
}

const add = (counts, key, amount) =>
    counts.set(key, (counts.get(key) || 0) + amount)

// [text, count] pairs, most counted first.
const ranked = (counts) => [...counts].sort((x, y) => y[1] - x[1])

// The longest stretch of the text that ends the way `context` ends (L), and
// the spans that followed it and every match within NEAR of it, up to the
// end of their line: { L, hits, spans }, where spans are [text, count]
// pairs, most frequent first. With `weigh`, each occurrence counts for
// weigh(position) instead of 1 (the library weighs by how well the line
// there was written).
export function lookup({ text, R, sa }, context, weigh = null) {
    const n = sa.length
    const c = folded(context.slice(-CONTEXT))
    // The first suffix in [a, b) whose character at depth d is above `limit`
    // (past the end of the text reads as -1).
    const above = (a, b, d, limit) => {
        while (a < b) {
            const m = (a + b) >> 1
            const p = sa[m] + d
            if ((p < n ? R[p] : -1) <= limit) a = m + 1
            else b = m
        }
        return a
    }
    const ranges = [] // the matches of each length, as a range of the suffix array
    for (let d = 0, lo = 0, hi = n; d < Math.min(DEPTH, c.length); d++) {
        const ch = c.charCodeAt(c.length - 1 - d)
        lo = above(lo, hi, d, ch - 1)
        hi = above(lo, hi, d, ch)
        if (lo === hi) break
        ranges.push([lo, hi])
    }
    const L = ranges.length
    if (L < MIN_MATCH) return { L, hits: 0, spans: [] }
    const [lo, hi] = ranges[Math.max(MIN_MATCH, Math.ceil(L * NEAR)) - 1]
    const tally = new Map()
    const step = Math.max(1, Math.floor((hi - lo) / 64))
    for (let i = lo; i < hi; i += step) {
        const end = n - sa[i] // just after the match, in the text read forward
        const span = text.slice(end, end + SPAN).split('\n')[0]
        if (span) add(tally, span, weigh ? weigh(end) : 1)
    }
    return {
        L,
        hits: hi - lo,
        spans: ranked(tally)
            .filter(([, count]) => count > 0)
            .slice(0, SPANS)
    }
}

// ------------------------------------------------------------ answers

// The answers worth hearing, whose match comes within a quarter of the
// longest, and that longest match.
function nearest(answers) {
    const useful = answers.filter(
        (a) => a && a.L >= MIN_MATCH && a.spans.length
    )
    const L = Math.max(0, ...useful.map((a) => a.L))
    return { L, near: useful.filter((a) => a.L >= L * NEAR) }
}

// One peer's answer from many rooms' lookups: `found` holds each room's
// { L, spans, w }, w being what that room's text counts for. The nearest
// rooms contribute, their counts scaled by w; the answer counts for the best
// w among them.
export function combine(found) {
    const { L, near } = nearest(found)
    if (!near.length) return null
    const spans = new Map()
    for (const a of near)
        for (const [text, count] of a.spans) add(spans, text, count * a.w)
    return {
        L,
        w: Math.max(...near.map((a) => a.w)),
        spans: ranked(spans).slice(0, SPANS)
    }
}

// An answer as received: { L, spans, w } with sane types and sizes, or
// null. Answers without a w (the stack's test peers) count fully.
export function clean(answer) {
    if (!answer || typeof answer.L !== 'number' || !Array.isArray(answer.s))
        return null
    const spans = answer.s
        .filter(
            (s) =>
                Array.isArray(s) &&
                typeof s[0] === 'string' &&
                s[0].length <= SPAN &&
                s[1] > 0
        )
        .slice(0, SPANS)
        .map(([text, count]) => [text, Number(count)])
    const w =
        typeof answer.w === 'number' && answer.w > 0 ? Math.min(answer.w, 1) : 1
    return { L: Math.min(Math.max(0, answer.L | 0), DEPTH), spans, w }
}

// Many peers' answers as one: the nearest peers vote, each with its weight,
// shared among its spans. The result's w (their mean weight) scales how much
// the memory counts at all, so a match only other rooms hold sways the guess
// less.
export function merge(answers) {
    const { L, near: voters } = nearest(answers)
    if (!voters.length) return { L: 0, peers: 0, w: 0, spans: [] }
    const weights = voters.map((a) => a.w ?? 1)
    const total = weights.reduce((sum, w) => sum + w, 0)
    const merged = new Map()
    voters.forEach((a, i) => {
        const counted = a.spans.reduce((sum, [, count]) => sum + count, 0)
        for (const [text, count] of a.spans)
            add(merged, text, (count / counted) * (weights[i] / total))
    })
    return {
        L,
        peers: voters.length,
        w: total / voters.length,
        spans: ranked(merged)
    }
}

// How much the memory counts against the model, by match length: nothing
// below MIN_MATCH, then more the longer the match (fitted, in tokens, on
// held-out chat: about a third at a word or two, most of it past a dozen).
export const weight = (L) =>
    L < MIN_MATCH ? 0 : Math.min(0.85, 0.15 + (L - MIN_MATCH) / 60)

// ------------------------------------------------------------ the wire

// A wire extension (BEP 10) that hands every message, as an object, to
// onMessage. Questions are { q: id, c: context }; answers are
// { a: id, L, s: spans }.
export const memoryExtension = (onMessage) =>
    extension(EXTENSION, readJson(MAX_BYTES), onMessage)

export const remembers = (wire) => speaks(wire, EXTENSION)

export function sendMemory(wire, message) {
    const body = json(message)
    return body.length <= MAX_BYTES && send(wire, EXTENSION, body)
}
