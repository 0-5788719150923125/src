// Ghost text, the parts that need neither the model nor the page: where a
// line's unfinished word starts, what a guess still has to show, which
// token comes next, and where the conversation the model reads begins.
// Used by writer.worker.js and ghost.js; tested under Node.

// A line splits before its unfinished last word. The model reads the
// finished part, then may only write tokens that agree with the rest, so
// "The quick bro" can still become "The quick brown" (token healing). A
// trailing space counts as unfinished: a word's token carries the space in
// front of it.
export function split(line) {
    const tail = / ?[A-Za-z0-9']*$/.exec(line)[0]
    return { stable: line.slice(0, line.length - tail.length), tail }
}

// How many leading items two lists share.
export function common(a, b) {
    let n = 0
    while (n < a.length && n < b.length && a[n] === b[n]) n++
    return n
}

// What a guess still shows after the line: the part of base + written the
// line has not reached, or null once the line has gone its own way.
export function ahead({ base, written }, line) {
    const whole = base + written
    return line.length >= base.length && whole.startsWith(line) ? whole.slice(line.length) : null
}

// Whether a token agrees with the unfinished text it must begin with.
const agrees = (pending, piece) => piece !== '' && (piece.startsWith(pending) || pending.startsWith(piece))

// What a token adds to the ghost, and what of the unfinished text is left
// for the next token to agree with.
export function consume(pending, piece) {
    if (piece.startsWith(pending)) return { pending: '', shown: piece.slice(pending.length) }
    return { pending: pending.slice(piece.length), shown: '' }
}

// The next token: the likeliest one that the chat would accept or that ends
// the line (a stop), agreeing with any unfinished text, with the tokens
// already in the line made less likely so the guess does not repeat itself.
// With a `boost` from the swarm's memory (token -> share, see boostFrom),
// the model's probabilities are blended with it, `lambda` to the memory.
// -1 when nothing fits.
export function pick(logits, { vocab, allowed, stops, pending = '', recent = new Set(), penalty = 1, boost = null, lambda = 0 }) {
    const scores = new Float32Array(logits.length)
    let best = -1
    let top = -Infinity
    for (let id = 0; id < logits.length; id++) {
        if (pending ? !allowed[id] || !agrees(pending, vocab[id]) : !allowed[id] && !stops[id]) {
            scores[id] = -Infinity
            continue
        }
        let score = logits[id]
        if (recent.has(id)) score = score > 0 ? score / penalty : score * penalty
        scores[id] = score
        if (score > top) {
            top = score
            best = id
        }
    }
    if (!boost?.size || !lambda || best < 0) return best
    let sum = 0
    for (let id = 0; id < scores.length; id++) if (scores[id] > -Infinity) sum += Math.exp(scores[id] - top)
    let mixed = -1
    for (let id = 0; id < scores.length; id++) {
        if (scores[id] === -Infinity) continue
        const p = ((1 - lambda) * Math.exp(scores[id] - top)) / sum + lambda * (boost.get(id) || 0)
        if (p > mixed) {
            mixed = p
            best = id
        }
    }
    return best
}

// What the swarm's memory says about the next token. `spans` are [text,
// share] pairs, each a way the line went on elsewhere; `written` is what the
// writer has written so far. Spans that no longer agree with it drop out;
// each one left lends its share to every token that would start its rest,
// except tokens of spaces alone (a bare " " before "moon" would leave the
// writer a word without its space, which it rarely goes on from).
// `byString` maps a token's text to its id.
export function boostFrom(spans, written, byString, longest = 16) {
    const boost = new Map()
    let total = 0
    for (const [text, share] of spans) if (text.startsWith(written) && text.length > written.length) total += share
    if (!total) return boost
    for (const [text, share] of spans) {
        if (!text.startsWith(written)) continue
        const rest = text.slice(written.length)
        for (let k = 1; k <= Math.min(longest, rest.length); k++) {
            const piece = rest.slice(0, k)
            if (!/\S/.test(piece)) continue
            const id = byString.get(piece)
            if (id !== undefined) boost.set(id, (boost.get(id) || 0) + share / total)
        }
    }
    return boost
}

// The first line of the conversation the model reads, given `count(from)`,
// the tokens from line `from` on. It stays put while they fit in `most`, so
// what the model has read stays cached; past that, it jumps ahead until
// `least` remain (or one line, however long).
export function start(from, lines, count, { most, least }) {
    if (count(from) <= most) return from
    while (from < lines - 1 && count(from) > least) from++
    return from
}
