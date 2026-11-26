import test from 'node:test'
import assert from 'node:assert/strict'
import {
    SHAPE,
    answer,
    createTable,
    elements,
    fromElements,
    hint,
    locate,
    mask,
    matrixRows,
    noise,
    readRecord,
    rewind,
    select,
    setRecord,
    toElements,
    updateHint
} from '../src/js/pir.js'

// The real dimension and noise, on a narrow table, so the tests run fast.
const S = { ...SHAPE, cols: 64 }

let seed = 7
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
const randomRecord = (shape = S) =>
    Uint8Array.from({ length: shape.record }, () => Math.floor(rand() * 256))
const randomRecords = (count, shape = S) =>
    Array.from({ length: count }, () => randomRecord(shape))

// Ask `table` for record `index`, as an asker holding `hinted` would.
async function ask(table, hinted, index) {
    const { column, group } = locate(index, table.shape)
    const m = await mask(table.shape)
    return readRecord(answer(table, select(m, column)), hinted, m, group)
}

test('A is the same everywhere, and any of its rows can be made alone', async () => {
    const whole = await matrixRows(S, 0, 8)
    assert.deepEqual(
        await matrixRows(S, 5, 3),
        whole.subarray(5 * S.n, 8 * S.n)
    )
    // Pinned: browsers and Node must make the same A from the seed.
    assert.deepEqual(
        [...whole.subarray(0, 4)],
        [69103714, 1425579371, 817191357, 3390252203]
    )
    assert.notDeepEqual(
        await matrixRows({ ...S, seed: 'another' }, 0, 1),
        whole.subarray(0, S.n)
    )
})

test('records become elements of log2(p) bits and back', () => {
    assert.equal(elements(SHAPE), 228) // 2048 bits at 9 a element
    const record = randomRecord()
    const values = toElements(record, S)
    assert.ok(values.every((v) => v < S.p))
    assert.deepEqual(fromElements(values, S), record)
})

test('noise is Gaussian, with the standard deviation asked for', () => {
    const sample = noise(40000, 6.4)
    const mean = sample.reduce((a, b) => a + b, 0) / sample.length
    const sd = Math.sqrt(
        sample.reduce((a, b) => a + (b - mean) ** 2, 0) / sample.length
    )
    assert.ok(Math.abs(mean) < 0.15, `mean ${mean}`)
    assert.ok(Math.abs(sd - 6.4) < 0.15, `standard deviation ${sd}`)
})

test('decryption keeps its margin even for a table of all-maximum values', () => {
    // Worst case: every element p - 1, so the noise's standard deviation is
    // sigma * sqrt(cols) * (p - 1); 7.4 of them is a 2^-40 tail.
    const { cols, sigma, p } = SHAPE
    const worst = sigma * Math.sqrt(cols) * (p - 1)
    assert.ok(
        7.4 * worst < 2 ** 32 / p / 2,
        `${(2 ** 32 / p / 2 / worst).toFixed(1)} standard deviations`
    )
})

test('an asker gets back the record it asked for, from any group', async () => {
    const records = randomRecords(S.cols * 2)
    const table = createTable(records, S)
    const hinted = await hint(table)
    for (const index of [0, 5, 63, 64, 100, 127])
        assert.deepEqual(
            await ask(table, hinted, index),
            records[index],
            `record ${index}`
        )
})

test('one query serves peers of every size', async () => {
    const small = randomRecords(S.cols)
    const large = randomRecords(S.cols * 3)
    const peers = [createTable(small, S), createTable(large, S)]
    const hints = await Promise.all(peers.map(hint))
    const index = 77 // a hash: each peer's record is index % its size, in the same column
    const m = await mask(S)
    const query = select(m, index % S.cols)
    const got = peers.map((table, i) => {
        const record = index % (table.groups * S.cols)
        return readRecord(
            answer(table, query),
            hints[i],
            m,
            locate(record, S).group
        )
    })
    assert.deepEqual(got[0], small[index % S.cols])
    assert.deepEqual(got[1], large[index % (3 * S.cols)])
})

test('a mask serves one query; masks differ', async () => {
    const a = await mask(S)
    select(a, 3)
    assert.throws(() => select(a, 4), /one query only/)
    const b = await mask(S)
    assert.notDeepEqual(b.vector, a.vector)
    assert.throws(() => select(b, S.cols), /no such column/)
})

test('changes keep hints current, and a peer can answer an older hint', async () => {
    const records = randomRecords(S.cols)
    const table = createTable(records, S)
    const old = await hint(table)
    const kept = Int32Array.from(old)
    const fresh = randomRecord()
    const changes = setRecord(table, 9, fresh)
    assert.equal(table.version, 1)
    assert.ok(changes.length > 0)
    // The asker updates its copy from the changes alone.
    await updateHint(kept, changes, S)
    assert.deepEqual(kept, await hint(table))
    assert.deepEqual(await ask(table, kept, 9), fresh)
    // An asker still on the old hint, answered as the table stood.
    const m = await mask(S)
    const query = select(m, 9)
    assert.deepEqual(
        readRecord(rewind(answer(table, query), query, changes), old, m, 0),
        records[9]
    )
})

test('a table holds a whole number of columns of records', () => {
    assert.throws(
        () => createTable(randomRecords(S.cols - 1), S),
        /multiple of 64/
    )
    assert.throws(() => createTable([], S), /multiple/)
    assert.throws(
        () => createTable(randomRecords(S.cols), { ...S, p: 500 }),
        /power of two/
    )
})
