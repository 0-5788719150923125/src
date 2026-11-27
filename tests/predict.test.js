import test from 'node:test'
import assert from 'node:assert/strict'
import {
    ahead,
    goOn,
    LEAD,
    boostFrom,
    common,
    consume,
    pick,
    split,
    start
} from '../src/js/predict.js'

// A seeded generator, so a test's draws are the same every run.
const seeded = (seed) => () =>
    (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31

test('a line splits before its unfinished word', () => {
    assert.deepEqual(split('The quick bro'), {
        stable: 'The quick',
        tail: ' bro'
    })
    assert.deepEqual(split('The quick '), { stable: 'The quick', tail: ' ' })
    assert.deepEqual(split('hello,'), { stable: 'hello,', tail: '' })
    assert.deepEqual(split('bro'), { stable: '', tail: 'bro' })
    assert.deepEqual(split("it's"), { stable: '', tail: "it's" })
})

test('common counts the shared start', () => {
    assert.equal(common([1, 2, 3], [1, 2, 4]), 2)
    assert.equal(common([1, 2], [1, 2, 3]), 2)
    assert.equal(common([], [1]), 0)
})

test('a guess shows what the line has not reached', () => {
    const guess = { base: 'The quick bro', written: 'wn fox' }
    assert.equal(ahead(guess, 'The quick bro'), 'wn fox')
    assert.equal(ahead(guess, 'The quick brow'), 'n fox') // typed what it showed
    assert.equal(ahead(guess, 'The quick brown fox'), '') // took all of it
    assert.equal(ahead(guess, 'The quick brx'), null) // went its own way
    assert.equal(ahead(guess, 'The quick br'), null) // took a letter back
})

test('a token first agrees with the unfinished word, then shows', () => {
    assert.deepEqual(consume(' bro', ' brown'), { pending: '', shown: 'wn' })
    assert.deepEqual(consume(' bro', ' b'), { pending: 'ro', shown: '' })
    assert.deepEqual(consume('', ' fox'), { pending: '', shown: ' fox' })
})

test('pick takes the likeliest token that fits', () => {
    const vocab = ['<s>', '\n', ' brown', ' bread', ' b', ' fox', 'é']
    const allowed = [0, 0, 1, 1, 1, 1, 0]
    const stops = [1, 1, 0, 0, 0, 0, 0]
    const logits = [0, 9, 1, 2, 0.5, 3, 10]
    const options = { vocab, allowed, stops }
    assert.equal(pick(logits, options), 1) // the line break stops it
    assert.equal(pick(logits, { ...options, pending: ' bro' }), 2) // agrees with " bro"
    assert.equal(pick(logits, { ...options, pending: ' br' }), 3) // " bread" beats " brown"
    assert.equal(
        pick(logits, {
            ...options,
            pending: ' br',
            recent: new Set([3]),
            penalty: 4
        }),
        2
    )
    assert.equal(pick(logits, { ...options, pending: ' q' }), -1)
})

test('the conversation start stays put until it must jump', () => {
    const sizes = [100, 100, 100, 100]
    const count = (from) => sizes.slice(from).reduce((a, b) => a + b, 0)
    assert.equal(start(0, 4, count, { most: 400, least: 200 }), 0)
    assert.equal(start(0, 4, count, { most: 300, least: 200 }), 2)
    assert.equal(start(1, 4, count, { most: 300, least: 200 }), 1)
    assert.equal(
        start(0, 4, () => 1000, { most: 300, least: 200 }),
        3
    ) // one long line
})

test('memory lends its share to the token each remembered span starts with', () => {
    // A stand-in tokenizer: the longest known piece at the start, none for spaces alone.
    const pieces = new Map([
        [' l', 1],
        [' little', 2],
        [' big', 3],
        ['tle', 4],
        [' ', 7],
        [' moon', 8]
    ])
    const first = (rest) => {
        for (let k = rest.length; k > 0; k--)
            if (pieces.has(rest.slice(0, k)))
                return /\S/.test(rest.slice(0, k))
                    ? pieces.get(rest.slice(0, k))
                    : undefined
    }
    const spans = [
        [' little girl', 0.75],
        [' big dog', 0.25]
    ]
    assert.deepEqual(
        [...boostFrom(spans, '', first)],
        [
            [2, 0.75],
            [3, 0.25]
        ]
    ) // " little", never " l"
    assert.deepEqual([...boostFrom(spans, ' lit', first)], [[4, 1]]) // " big dog" no longer agrees
    assert.deepEqual([...boostFrom(spans, ' little girl', first)], []) // nothing left to say
    assert.deepEqual([...boostFrom([['  moon', 1]], '', first)], []) // no bare spaces
    assert.deepEqual(
        [
            ...boostFrom(
                [
                    [' little one', 0.5],
                    [' little two', 0.5]
                ],
                '',
                first
            )
        ],
        [[2, 1]]
    ) // shares add up
})

test('pick blends memory in, and without it picks as before', () => {
    const vocab = ['<s>', '\n', ' small', ' little', ' big']
    const allowed = [0, 0, 1, 1, 1]
    const stops = [1, 1, 0, 0, 0]
    const logits = [-9, -9, 3, 2, 0]
    const options = { vocab, allowed, stops }
    assert.equal(pick(logits, options), 2)
    assert.equal(pick(logits, { ...options, boost: new Map(), lambda: 0.8 }), 2)
    assert.equal(
        pick(logits, { ...options, boost: new Map([[3, 1]]), lambda: 0.1 }),
        2
    ) // too little to turn it
    assert.equal(
        pick(logits, { ...options, boost: new Map([[3, 1]]), lambda: 0.5 }),
        3
    ) // enough
    assert.equal(
        pick(logits, {
            ...options,
            boost: new Map([[4, 1]]),
            lambda: 0.5,
            pending: ' s'
        }),
        2
    ) // the unfinished word still rules
})

test('with a temperature, pick draws among the likeliest, by their odds', () => {
    const vocab = ['<s>', '\n', ' small', ' little', ' big', ' tiny']
    const allowed = [0, 0, 1, 1, 1, 1]
    const stops = [1, 1, 0, 0, 0, 0]
    const logits = [-9, -9, 3, 2.5, 2, -6]
    const options = { vocab, allowed, stops, temperature: 0.7, topP: 0.9 }
    const random = seeded(7)
    const counts = new Map()
    for (let i = 0; i < 3000; i++) {
        const id = pick(logits, { ...options, random })
        counts.set(id, (counts.get(id) || 0) + 1)
    }
    assert.deepEqual([...counts.keys()].sort(), [2, 3, 4]) // never " tiny", far in the tail, nor the line's start
    assert.ok(
        counts.get(2) > counts.get(3) && counts.get(3) > counts.get(4),
        'likelier tokens come up more often'
    )
    assert.ok(counts.get(4) > 150, 'the third still comes up')
    // A draw is still bound by the unfinished word, and greedy without one.
    for (let i = 0; i < 50; i++)
        assert.equal(pick(logits, { ...options, random, pending: ' l' }), 3)
    assert.equal(pick(logits, { ...options, temperature: 0 }), 2)
    // A tight nucleus keeps only the likeliest.
    for (let i = 0; i < 50; i++)
        assert.equal(pick(logits, { ...options, random, topP: 0.01 }), 2)
})

test('a draw takes the memory into account', () => {
    const vocab = ['<s>', '\n', ' small', ' little', ' big']
    const allowed = [0, 0, 1, 1, 1]
    const stops = [1, 1, 0, 0, 0]
    const logits = [-9, -9, 3, 2, -9]
    const random = seeded(11)
    let big = 0
    for (let i = 0; i < 1000; i++)
        if (
            pick(logits, {
                vocab,
                allowed,
                stops,
                temperature: 0.7,
                topP: 0.9,
                random,
                boost: new Map([[4, 1]]),
                lambda: 0.6
            }) === 4
        )
            big++
    assert.ok(
        big > 450,
        `the memory's token, unlikely to the model, is drawn most (${big}/1000)`
    )
})

test('a guess running short is gone on from', () => {
    const guess = { base: 'See you on', written: ' the way home.', from: 0 }
    assert.equal(goOn({ ...guess, done: false }, ' the way home.'), false) // still writing
    assert.equal(goOn({ ...guess, done: true }, ' the way home.'), true)
    assert.equal(goOn({ ...guess, done: true }, ''), true) // taken whole
    assert.equal(goOn({ ...guess, done: true }, null), false) // gone its own way
    assert.equal(goOn({ ...guess, done: true }, 'x'.repeat(LEAD)), false) // lead enough
    assert.equal(goOn({ ...guess, done: true, from: 14 }, ''), false) // added nothing
})
