import test from 'node:test'
import assert from 'node:assert/strict'
import {
    DEPTH,
    MIN_MATCH,
    NEAR,
    OTHER_ROOM,
    clean,
    combine,
    index,
    lookup,
    merge,
    weight
} from '../src/js/memory.js'

// The longest suffix of `context` found in `text`, and what followed each
// occurrence of the near-longest one up to the end of its line, by brute
// force.
function slow(text, context) {
    let L = 0
    for (let k = 1; k <= Math.min(DEPTH, context.length); k++) {
        if (text.includes(context.slice(-k))) L = k
        else break
    }
    const spans = new Map()
    if (L >= MIN_MATCH) {
        const needle = context.slice(-Math.max(MIN_MATCH, Math.ceil(L * NEAR)))
        for (
            let i = text.indexOf(needle);
            i >= 0;
            i = text.indexOf(needle, i + 1)
        ) {
            let span = text.slice(i + needle.length, i + needle.length + 48)
            if (span.includes('\n')) span = span.slice(0, span.indexOf('\n'))
            if (span) spans.set(span, (spans.get(span) || 0) + 1)
        }
    }
    return { L, spans }
}

test('the index finds what brute force finds', () => {
    let seed = 3
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const words = [
        'the',
        'cat',
        'sat',
        'on',
        'a',
        'mat',
        'and',
        'then',
        'ran',
        'away'
    ]
    const text = Array.from(
        { length: 400 },
        () => words[Math.floor(rand() * words.length)]
    )
        .join(' ')
        .replace(/(.{40,60}) /g, '$1\n')
    const ix = index(text)
    for (let trial = 0; trial < 200; trial++) {
        const at = Math.floor(rand() * (text.length - 30))
        const context =
            'xyz ' + text.slice(at, at + 5 + Math.floor(rand() * 25))
        const fast = lookup(ix, context)
        const truth = slow(text, context)
        assert.equal(fast.L, truth.L, JSON.stringify(context))
        if (fast.hits <= 64)
            assert.deepEqual(
                new Map(fast.spans),
                truth.spans,
                JSON.stringify(context)
            )
    }
})

test('a story remembered is a story continued', () => {
    const ix = index(
        'Once upon a time, there was a little girl named Lily.\nShe liked to play outside.\n'
    )
    const answer = lookup(ix, 'Hello there\nOnce upon a time, there was a lit')
    assert.equal(answer.L, 'Once upon a time, there was a lit'.length)
    assert.deepEqual(answer.spans, [['tle girl named Lily.', 1]])
    assert.deepEqual(lookup(ix, 'nothing like it').spans, [])
})

test('matching ignores case; the answer keeps it', () => {
    const ix = index('Once upon a time, there was a little girl named Lily.\n')
    const answer = lookup(ix, 'ONCE UPON A TIME, THERE WAS A LIT')
    assert.equal(answer.L, 33)
    assert.deepEqual(answer.spans, [['tle girl named Lily.', 1]])
})

test('answers merge one vote per peer, among the longest', () => {
    const merged = merge([
        {
            L: 30,
            spans: [
                ['a', 3],
                ['b', 1]
            ]
        },
        { L: 28, spans: [['b', 1]] },
        { L: 10, spans: [['c', 100]] }, // too short to vote against the others
        { L: 4, spans: [['d', 1]] } // below MIN_MATCH
    ])
    assert.equal(merged.L, 30)
    assert.equal(merged.peers, 2)
    assert.equal(merged.w, 1)
    assert.deepEqual(merged.spans, [
        ['b', 0.625],
        ['a', 0.375]
    ])
    assert.deepEqual(merge([]), { L: 0, peers: 0, w: 0, spans: [] })
})

test('a peer that only knows other rooms votes for less, and sways the guess less', () => {
    const merged = merge([
        { L: 30, w: 1, spans: [['cherry', 1]] },
        { L: 30, w: OTHER_ROOM, spans: [['banana', 1]] }
    ])
    assert.deepEqual(
        merged.spans.map(([text]) => text),
        ['cherry', 'banana']
    )
    assert.ok(Math.abs(merged.spans[0][1] - 1 / (1 + OTHER_ROOM)) < 1e-9)
    assert.equal(
        merge([{ L: 30, w: OTHER_ROOM, spans: [['banana', 1]] }]).w,
        OTHER_ROOM
    )
})

test('one peer weighs its rooms: the room asked through counts most', () => {
    const apples = { L: 20, w: 1, spans: [[' cherry', 1]] }
    const orange = { L: 20, w: OTHER_ROOM, spans: [[' banana', 2]] }
    const answer = combine([apples, orange])
    assert.equal(answer.w, 1)
    assert.deepEqual(answer.spans, [
        [' cherry', 1],
        [' banana', 2 * OTHER_ROOM]
    ])
    assert.equal(combine([orange]).w, OTHER_ROOM)
    assert.equal(combine([{ L: 3, w: 1, spans: [['x', 1]] }]), null) // too short
    assert.deepEqual(
        combine([{ L: 40, w: OTHER_ROOM, spans: [['far', 1]] }, apples]).spans,
        [['far', OTHER_ROOM]]
    ) // the longer match still decides
})

test('one peer answers from all its slices as one, and a line two slices hold counts once', () => {
    // As containers/node/peers.js does: each slice indexed on its own, every
    // slice's lookup combined.
    const slices = [
        'the cat sat on the mat.\nthe owl said hoot.\n',
        'the dog ran far.\nthe cat sat on the mat.\n',
        'nothing to see here.\n'
    ]
    const memories = slices.map((text) => index(text))
    const recollect = (context) =>
        combine(
            memories.map((memory) => ({ ...lookup(memory, context), w: 1 }))
        )
    const answer = recollect('and then the cat sat on')
    assert.equal(answer.L, 'the cat sat on'.length)
    assert.deepEqual(answer.spans, [[' the mat.', 2]]) // both slices that hold it, one answer
    assert.deepEqual(recollect('so the dog ran').spans, [[' far.', 1]]) // a line only one slice holds
    assert.equal(recollect('zzzz qqqq xxxx'), null)
})

test('received answers are checked, and weight grows with the match', () => {
    assert.equal(clean({ L: 'x' }), null)
    assert.deepEqual(
        clean({
            L: 999,
            s: [
                ['ok', 2],
                ['x'.repeat(99), 1],
                [5, 1],
                ['no', -1]
            ]
        }),
        { L: DEPTH, spans: [['ok', 2]], w: 1 }
    )
    assert.equal(clean({ L: 9, s: [], w: 7 }).w, 1)
    assert.equal(clean({ L: 9, s: [], w: 0.3 }).w, 0.3)
    assert.equal(weight(MIN_MATCH - 1), 0)
    assert.ok(
        weight(MIN_MATCH) > 0 &&
            weight(30) > weight(MIN_MATCH) &&
            weight(500) <= 0.85
    )
})
