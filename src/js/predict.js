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
    return line.length >= base.length && whole.startsWith(line)
        ? whole.slice(line.length)
        : null
}

// A guess keeps a lead: once it is done and shows less than LEAD
// characters, the next is asked from its end and shown after it, so it is
// there before the visitor gets to the end. The model still ends each
// guess where it likes (a line's or the text's end, often right after a
// sentence, or past about 120 characters); the next used to be asked only
// once the last was taken whole, and nothing showed meanwhile (the user,
// 2026-11-26). `from` is how much of `written` came from earlier guesses:
// one that added nothing ends the chain.
export const LEAD = 40
export const goOn = (guess, rest) =>
    Boolean(
        guess?.done &&
        guess.written.length > guess.from &&
        rest !== null &&
        rest.length < LEAD
    )

// Whether a token agrees with the unfinished text it must begin with.
const agrees = (pending, piece) =>
    piece !== '' && (piece.startsWith(pending) || pending.startsWith(piece))

// What a token adds to the ghost, and what of the unfinished text is left
// for the next token to agree with.
export function consume(pending, piece) {
    if (piece.startsWith(pending))
        return { pending: '', shown: piece.slice(pending.length) }
    return { pending: pending.slice(piece.length), shown: '' }
}

// The next token, among those the chat would accept or that end the line
// (a stop), agreeing with any unfinished text, with the tokens already in
// the line made less likely so the guess does not repeat itself. With a
// `boost` from the swarm's memory (token -> share, see boostFrom), the
// model's probabilities are blended with it, `lambda` to the memory.
//
// With no `temperature` it takes the likeliest (greedy: the same line
// always gets the same guess). With one, it draws: the model's scores are
// divided by the temperature before the blend, and the draw is among the
// likeliest tokens that together hold `topP` of the probability (nucleus
// sampling), so it varies without wandering into the unlikely tail.
// `random` returns [0, 1). -1 when nothing fits.
export function pick(
    logits,
    {
        vocab,
        allowed,
        stops,
        pending = '',
        recent = new Set(),
        penalty = 1,
        boost = null,
        lambda = 0,
        temperature = 0,
        topP = 1,
        random = Math.random
    }
) {
    const scores = new Float32Array(logits.length)
    let best = -1
    let top = -Infinity
    for (let id = 0; id < logits.length; id++) {
        if (
            pending
                ? !allowed[id] || !agrees(pending, vocab[id])
                : !allowed[id] && !stops[id]
        ) {
            scores[id] = -Infinity
            continue
        }
        let score = logits[id]
        if (recent.has(id))
            score = score > 0 ? score / penalty : score * penalty
        scores[id] = score
        if (score > top) {
            top = score
            best = id
        }
    }
    const blend = boost?.size && lambda
    if (best < 0 || (!blend && !(temperature > 0))) return best
    const t = temperature > 0 ? temperature : 1
    let sum = 0
    for (let id = 0; id < scores.length; id++)
        if (scores[id] > -Infinity) sum += Math.exp((scores[id] - top) / t)
    // Each candidate's probability: the model's share, blended with the
    // memory's. Tokens below e^-20 of the likeliest cannot matter and are
    // skipped, unless the memory lends them a share.
    const floor = top - 20 * t
    const own = blend ? 1 - lambda : 1
    const candidates = []
    for (let id = 0; id < scores.length; id++) {
        const score = scores[id]
        if (score === -Infinity) continue
        const lent = (blend && boost.get(id)) || 0
        if (score < floor && !lent) continue
        candidates.push([
            id,
            (own * Math.exp((score - top) / t)) / sum + lambda * lent
        ])
    }
    candidates.sort((a, b) => b[1] - a[1])
    if (!(temperature > 0)) return candidates[0][0]
    // The nucleus: the fewest likeliest tokens holding topP of the total.
    let total = 0
    for (const [, p] of candidates) total += p
    let kept = 0
    let held = 0
    while (kept < candidates.length && (kept === 0 || held < topP * total))
        held += candidates[kept++][1]
    let at = random() * held
    for (let i = 0; i < kept; i++) {
        at -= candidates[i][1]
        if (at < 0) return candidates[i][0]
    }
    return candidates[kept - 1][0]
}

// What the swarm's memory says about the next token. `spans` are [text,
// share] pairs, each a way the line went on elsewhere; `written` is what the
// writer has written so far. Spans that no longer agree with it drop out;
// each one left lends its share to the token its rest starts with, as the
// tokenizer would write it: `first(rest)`, a token id, or undefined for none
// (the writer gives none for a token of spaces alone: a bare " " before
// "moon" would leave it a word without its space, which it rarely goes on
// from). It used to lend to every token that merely started the rest, " l"
// as much as " little", and the writer drew those spellings it never
// writes: words split oddly, which it went on from badly ("a secret t
// wit"), and more steps before each word showed (2026-11-25).
export function boostFrom(spans, written, first) {
    const boost = new Map()
    const agreeing = spans.filter(
        ([text]) => text.length > written.length && text.startsWith(written)
    )
    const total = agreeing.reduce((sum, [, share]) => sum + share, 0)
    if (!total) return boost
    for (const [text, share] of agreeing) {
        const id = first(text.slice(written.length))
        if (id !== undefined)
            boost.set(id, (boost.get(id) || 0) + share / total)
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
