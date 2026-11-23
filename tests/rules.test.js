import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { evaluate, explain, fit, measure, part, tuned } from '../src/js/rules.js'
import { quality } from '../src/js/quality.js'
import { index, lookup } from '../src/js/memory.js'

const toy = {
    name: 'toy',
    bias: 0,
    rules: [
        { name: 'loud', kind: 'noise', weight: 2, test: (t) => (t.includes('!') ? -1 : 0) },
        { name: 'polite', kind: 'care', weight: 1, test: (t) => (t.includes('please') ? 1 : -1) },
        { name: 'wild', weight: 1, test: () => 7 } // clamped to 1
    ]
}

test('a score is the weighted sum of its rules, explained', () => {
    const result = evaluate(toy, 'please!')
    assert.equal(result.total, -2 + 1 + 1)
    assert.ok(Math.abs(result.score - 0.5) < 1e-9)
    assert.equal(part(result, 'noise'), -2)
    assert.equal(part(result, 'care'), 1)
    assert.equal(explain(result), '-2.0 loud, +1.0 polite, +1.0 wild')
    assert.equal(evaluate(tuned(toy, { weights: { loud: 0 } }), 'please!').total, 2)
})

test('fitting finds weights that separate the examples, and keeps the rules', () => {
    const examples = [['please help', 1], ['please, thanks', 1], ['now!', 0], ['give it!', 0], ['hey', 0]]
    const start = tuned(toy, { weights: { loud: 0, polite: 0, wild: 0 } })
    assert.ok(measure(start, examples).accuracy < 1)
    const fitted = fit(start, examples)
    assert.equal(measure(fitted, examples).accuracy, 1)
    assert.deepEqual(fitted.rules.map((r) => r.name), toy.rules.map((r) => r.name))
})

const data = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'quality.examples.json'), 'utf8'))
const examples = [...data.good.map((l) => [l, 1]), ...data.bad.map((l) => [l, 0])]

test('the quality rules rank written lines above noise', () => {
    const { accuracy, auc } = measure(quality, examples)
    assert.ok(auc >= 0.98, `AUC ${auc}`)
    assert.ok(accuracy >= 0.95, `accuracy ${accuracy}`)
})

test('casual lines carry no noise; spam does', () => {
    for (const line of ['the radio is great tonight, anyone listening', 'ok sounds good', 'what room are you in']) {
        assert.equal(part(evaluate(quality, line), 'noise'), 0, line)
    }
    for (const line of ['BUY CHEAP PILLS NOW!!! CLICK HERE', 'lol lol lol lol lol lol', 'visit https://spam.example.xyz now', 'sdkfjh sdkjfh sdkfjhsdf']) {
        assert.ok(part(evaluate(quality, line), 'noise') <= -1.5, line)
    }
})

test('a lookup can weigh each occurrence', () => {
    const ix = index('the word is cherry\nthe word is banana\nthe word is banana\n')
    assert.deepEqual(lookup(ix, 'the word is').spans, [[' banana', 2], [' cherry', 1]])
    // The first line was written with care; the others count for a tenth.
    const weighed = lookup(ix, 'the word is', (position) => (position < 19 ? 1 : 0.1))
    assert.deepEqual(weighed.spans.map(([text]) => text), [' cherry', ' banana'])
})
