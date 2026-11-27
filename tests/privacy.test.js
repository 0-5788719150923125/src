// What a peer answering the browser extension's private questions can
// learn about what was typed, checked from the answerer's side. Written
// for reviewers too (PRIVACY.md): run it alone with
// `node --test tests/privacy.test.js` (Node 22 or newer, nothing to install).
//
// The claim (src/js/pir.js): a query is an LWE sample, A s + e, with a
// marker on one column, under a secret s drawn for that query alone.
// Finding the column is the learning-with-errors problem, the one ML-KEM
// and FrodoKEM rest on. No test can prove a problem hard; these check
//   1. that the parameters resist the known lattice attacks at 128 bits,
//   2. that a query looks like random numbers, and that looking for the
//      marker does no better than chance, while the same attacks find it
//      at once when a safeguard is taken away (the secret, its single
//      use, the noise),
//   3. that over the wire an answerer gets the same messages whatever was
//      typed, and whether or not it holds an answer, but for the query's
//      random-looking body.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
    SHAPE,
    mask,
    matrixRows,
    noise,
    select,
    toBytes
} from '../src/js/pir.js'
import { createAnswerer, createAsker } from '../src/js/private.js'
import { ask, connect, ready, spansOf } from './wires.js'

// The real dimension, noise and modulus, on fewer columns, to run fast: a
// column's part of a query does not depend on how many there are.
const W = { ...SHAPE, cols: 1024 }
const MARKER = 2 ** 32 / SHAPE.p // what select adds to the asked column

// ------------------------------------------------------------ parameters

// The cost of the two standard lattice attacks by the "core-SVP" method
// lattice schemes report (FrodoKEM specification, 2021, section 5.2): the
// BKZ block size b an attack needs, costed at 2^(c b), c = 0.292 classical
// or 0.265 quantum (sieving). It counts one call to the SVP oracle and
// nothing else, and takes the secret as small as the noise (normal form):
// both in the attacker's favor. Up to `samples` samples: a query gives one
// a column.
function attackCosts({ n, logq, sigma, samples }, c) {
    let primal = Infinity
    let dual = Infinity
    for (let b = 60; b < 1500 && !(primal < Infinity && c * b >= dual); b++) {
        const lg =
            Math.log2(((Math.PI * b) ** (1 / b) * b) / (2 * Math.PI * Math.E)) /
            (2 * b - 2) // log2 of BKZ-b's root Hermite factor
        for (let m = 8; m <= samples; m += 8) {
            // Primal: (s, e, 1) is the shortest vector of a lattice of
            // dimension d and volume q^m, found once
            // sigma sqrt(b) <= delta^(2b - d - 1) q^(m / d).
            const d = m + n + 1
            if (
                Math.log2(sigma) + Math.log2(b) / 2 <=
                (2 * b - d - 1) * lg + (m / d) * logq
            )
                primal = Math.min(primal, c * b)
            // Dual: a vector of length delta^(d - 2) q^(n / (d - 1)) tells
            // LWE from uniform with advantage 2 exp(-2 pi^2 tau^2), tau =
            // length * sigma / q, and about 1 / advantage^2 of them are
            // needed; a sieve gives 2^(0.2075 b) at once.
            const tau = 2 ** ((d - 2) * lg + (n / (d - 1) - 1) * logq) * sigma
            const advantage = 1 - (2 * Math.PI ** 2 * tau ** 2) / Math.LN2
            dual = Math.min(
                dual,
                c * b + Math.max(0, -2 * advantage - 0.2075 * b)
            )
        }
    }
    return { primal, dual }
}

test('the parameters resist the known lattice attacks at 128 bits or more', (t) => {
    const ours = {
        n: SHAPE.n,
        logq: 32,
        sigma: SHAPE.sigma,
        samples: SHAPE.cols
    }
    for (const [name, c] of [
        ['classical', 0.292],
        ['quantum', 0.265]
    ]) {
        const { primal, dual } = attackCosts(ours, c)
        t.diagnostic(
            `${name}: primal 2^${primal.toFixed(1)}, dual 2^${dual.toFixed(1)}`
        )
        assert.ok(primal >= 128 && dual >= 128, name)
    }
    // The method against FrodoKEM-640's published costs (n 640, q 2^15,
    // sigma 2.8, n + 8 samples; Table 10: 150.8 primal, 149.6 dual,
    // classical). That table adds costs core-SVP leaves out, so this comes
    // out a little lower, never higher.
    const frodo = attackCosts(
        { n: 640, logq: 15, sigma: 2.8, samples: 648 },
        0.292
    )
    for (const [got, published] of [
        [frodo.primal, 150.8],
        [frodo.dual, 149.6]
    ])
        assert.ok(got <= published && got > published - 10, `${got}`)
})

// ------------------------------------------------------------ queries

// Where the asked column ranks among all columns by an attack's scores, as
// a share: 0 is found at once; chance averages 0.5.
function rankOf(scores, column) {
    let above = 0
    for (const score of scores) if (score > scores[column]) above++
    return above / (scores.length - 1)
}
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length

// The attack: the column holding the value nearest the marker.
const nearMarker = (query) =>
    Array.from(query, (x) => -Math.abs((x - MARKER) | 0))

test('a query looks like uniform random numbers, whichever column it asks', async () => {
    const queries = []
    for (let i = 0; i < 8; i++) queries.push(select(await mask(W), i * 100))
    // Every byte value about as often as the others: chi-squared, with 255
    // degrees of freedom, passes 380 less than once in a million.
    const counts = new Array(256).fill(0)
    for (const query of queries)
        for (const byte of toBytes(query)) counts[byte]++
    const expected = (queries.length * W.cols * 4) / 256
    const chi = counts.reduce(
        (sum, n) => sum + (n - expected) ** 2 / expected,
        0
    )
    assert.ok(chi < 380, `chi-squared ${chi.toFixed(0)}`)
    // Every bit of a number set half the time.
    for (let bit = 0; bit < 32; bit++) {
        let set = 0
        for (const query of queries)
            for (const x of query) set += (x >>> bit) & 1
        const share = set / (queries.length * W.cols)
        assert.ok(Math.abs(share - 0.5) < 0.03, `bit ${bit}: ${share}`)
    }
})

test('looking for the marker finds it only in a query made without the secret', async () => {
    const asked = Array.from({ length: 32 }, (_, i) => (i * 389) % W.cols)
    const ranks = []
    for (const column of asked)
        ranks.push(rankOf(nearMarker(select(await mask(W), column)), column))
    assert.ok(Math.abs(mean(ranks) - 0.5) < 0.25, `mean rank ${mean(ranks)}`)
    // The same attack on the noise and the marker alone, with no A s.
    for (const column of asked) {
        const bare = noise(W.cols, W.sigma)
        bare[column] += MARKER
        assert.equal(rankOf(nearMarker(bare), column), 0)
    }
})

test('a mask used twice would give both columns away, so it serves once', async () => {
    const used = await mask(W)
    const twin = { ...used, used: false } // what a bug reusing masks would send
    const first = select(used, 100)
    assert.throws(() => select(used, 900), /one query only/)
    const second = select(twin, 900)
    // The difference of the two is the markers alone: both columns, read off.
    const minus = (a, b) => Int32Array.from(a, (x, i) => (x - b[i]) | 0)
    const reused = minus(first, second)
    assert.deepEqual(
        [...reused.keys()].filter((i) => reused[i] !== 0),
        [100, 900]
    )
    // Under two masks, the difference is as random as the queries: no
    // element near 0 but by chance (one in 500 thousand each).
    const fresh = minus(select(await mask(W), 100), select(await mask(W), 900))
    assert.ok(fresh.filter((x) => Math.abs(x) < 4096).length <= 1)
})

// Solve A s = q (mod 2^32) for s from some rows of A (row c is column c's),
// by Gauss-Jordan elimination on odd pivots, the units mod 2^32.
function solve(a, q, rows, n) {
    const m = rows.map((r) => {
        const row = new Int32Array(n + 1)
        row.set(a.subarray(r * n, r * n + n))
        row[n] = q[r]
        return row
    })
    for (let j = 0; j < n; j++) {
        const p = m.findIndex((row, i) => i >= j && row[j] & 1)
        if (p < 0) return null
        const pivot = m[p]
        m[p] = m[j]
        m[j] = pivot
        let inverse = pivot[j] // Newton's iteration: 3 right bits, then 6...
        for (let i = 0; i < 4; i++)
            inverse = Math.imul(inverse, 2 - Math.imul(pivot[j], inverse))
        for (let k = j; k <= n; k++) pivot[k] = Math.imul(pivot[k], inverse)
        for (const row of m) {
            const f = row[j]
            if (row === pivot || !f) continue
            for (let k = j; k <= n; k++)
                row[k] = (row[k] - Math.imul(f, pivot[k])) | 0
        }
    }
    return Int32Array.from(m.slice(0, n), (row) => row[n])
}

// The algebra an attacker would try: solve for the secret from half the
// columns, and see whether the other half is left with a lone marker; if
// not (the marker was in the half solved from), swap halves.
function readByAlgebra(a, query, n) {
    const half = query.length / 2
    const low = Array.from({ length: half }, (_, i) => i)
    const high = low.map((i) => i + half)
    for (const [from, check] of [
        [low, high],
        [high, low]
    ]) {
        const s = solve(a, query, from, n)
        if (!s) continue
        const rest = check.map((c) => {
            let acc = query[c]
            for (let j = 0; j < n; j++)
                acc = (acc - Math.imul(a[c * n + j], s[j])) | 0
            return [c, acc]
        })
        const left = rest.filter(([, r]) => r !== 0)
        if (left.length === 1 && left[0][1] === MARKER) return left[0][0]
    }
    return null
}

test('the noise is what hides the column: without it, plain algebra reads it', async () => {
    // A smaller secret, so the algebra runs fast: its cost grows as n^3,
    // which a larger n slows but does not stop.
    const D = { ...W, n: 256 }
    const a = await matrixRows(D, 0, D.cols)
    for (const column of [3, 700]) {
        const query = select(await mask(D), column)
        assert.equal(readByAlgebra(a, query, D.n), null)
        // The same, but without the noise: A s plus the marker.
        const secret = crypto.getRandomValues(new Int32Array(D.n))
        const bare = Int32Array.from({ length: D.cols }, (_, c) => {
            let acc = c === column ? MARKER : 0
            for (let j = 0; j < D.n; j++)
                acc = (acc + Math.imul(a[c * D.n + j], secret[j])) | 0
            return acc
        })
        assert.equal(readByAlgebra(a, bare, D.n), column)
    }
})

// ------------------------------------------------------------ the wire

const S = { ...SHAPE, cols: 64 }
const HELD =
    '\nthe results came back and the doctor says it is nothing to worry about\n'
const TYPED = [
    'so the doctor says it is n', // the answerer holds what comes next
    'please wire the money to my sister in Lisbon by f' // it holds nothing
]

test('an answering peer gets the same messages whatever is typed, hit or miss', async () => {
    const seen = []
    for (const typed of TYPED) {
        const answerer = createAnswerer({ shape: S })
        await answerer.load(HELD)
        const asker = createAsker({ shape: S })
        const { a } = connect(asker, answerer)
        await ready(asker)
        const before = a.sent.length
        const memory = await ask(asker, typed)
        assert.equal(answerer.stats.questions, 1)
        seen.push({ memory, got: a.sent.slice(before) })
    }
    // One found what came next, one found nothing...
    assert.deepEqual(spansOf(seen[0].memory), ['othing to worry about'])
    assert.equal(seen[1].memory, null)
    // ...and the answerer could not tell: the same messages, the same
    // sizes, the same bytes but for the query's body (type, id, the table's
    // version, the part and the parts are the first 17).
    const [hit, miss] = seen.map((s) => s.got)
    assert.equal(hit.length, miss.length)
    hit.forEach((bytes, i) => {
        assert.equal(bytes.length, miss[i].length)
        assert.deepEqual(bytes.subarray(0, 17), miss[i].subarray(0, 17))
        assert.notDeepEqual(bytes.subarray(17), miss[i].subarray(17))
    })
    // Nor do they spell out a word of what was typed, in any common way.
    for (const [i, typed] of TYPED.entries()) {
        const got = Buffer.concat(seen[i].got)
        for (const word of typed.split(' ').filter((w) => w.length >= 4))
            for (const spelled of [
                Buffer.from(word),
                Buffer.from(word.toLowerCase()),
                Buffer.from(word, 'utf16le'),
                Buffer.from(Buffer.from(word).toString('hex'))
            ])
                assert.equal(got.indexOf(spelled), -1, word)
    }
})
