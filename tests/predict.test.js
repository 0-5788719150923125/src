import test from 'node:test'
import assert from 'node:assert/strict'
import { ahead, boostFrom, common, consume, pick, split, start } from '../src/js/predict.js'

test('a line splits before its unfinished word', () => {
    assert.deepEqual(split('The quick bro'), { stable: 'The quick', tail: ' bro' })
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
    assert.equal(pick(logits, { ...options, pending: ' br', recent: new Set([3]), penalty: 4 }), 2)
    assert.equal(pick(logits, { ...options, pending: ' q' }), -1)
})

test('the conversation start stays put until it must jump', () => {
    const sizes = [100, 100, 100, 100]
    const count = (from) => sizes.slice(from).reduce((a, b) => a + b, 0)
    assert.equal(start(0, 4, count, { most: 400, least: 200 }), 0)
    assert.equal(start(0, 4, count, { most: 300, least: 200 }), 2)
    assert.equal(start(1, 4, count, { most: 300, least: 200 }), 1)
    assert.equal(start(0, 4, () => 1000, { most: 300, least: 200 }), 3) // one long line
})

test('memory lends its share to the tokens that start each remembered span', () => {
    const byString = new Map([[' l', 1], [' little', 2], [' big', 3], ['tle', 4]])
    const spans = [[' little girl', 0.75], [' big dog', 0.25]]
    assert.deepEqual([...boostFrom(spans, '', byString)], [[1, 0.75], [2, 0.75], [3, 0.25]])
    assert.deepEqual([...boostFrom(spans, ' lit', byString)], [[4, 1]]) // " big dog" no longer agrees
    assert.deepEqual([...boostFrom(spans, ' little girl', byString)], []) // nothing left to say
    assert.deepEqual([...boostFrom([[' moon', 1]], '', new Map([[' ', 7], [' moon', 8]]))], [[8, 1]]) // no bare spaces
})

test('pick blends memory in, and without it picks as before', () => {
    const vocab = ['<s>', '\n', ' small', ' little', ' big']
    const allowed = [0, 0, 1, 1, 1]
    const stops = [1, 1, 0, 0, 0]
    const logits = [-9, -9, 3, 2, 0]
    const options = { vocab, allowed, stops }
    assert.equal(pick(logits, options), 2)
    assert.equal(pick(logits, { ...options, boost: new Map(), lambda: 0.8 }), 2)
    assert.equal(pick(logits, { ...options, boost: new Map([[3, 1]]), lambda: 0.1 }), 2) // too little to turn it
    assert.equal(pick(logits, { ...options, boost: new Map([[3, 1]]), lambda: 0.5 }), 3) // enough
    assert.equal(pick(logits, { ...options, boost: new Map([[4, 1]]), lambda: 0.5, pending: ' s' }), 2) // the unfinished word still rules
})
