// Private information retrieval: ask a peer for one record of its table
// without the peer learning which. This is how the swarm memory is to
// answer text typed in other sites' fields (next/private-memory.md): the
// asker's context picks a record, and the peer computes, over its whole
// table, an answer only the asker can read.
//
// The scheme is SimplePIR's (Henzinger et al., 2023) in FrodoPIR's layout:
// plain LWE modulo 2^32, so everything is 32-bit integer arithmetic
// (Math.imul), with no library. A table is `cols` columns of records,
// stacked in groups: record i sits in column i % cols, group i / cols. Every
// table in the swarm has the same number of columns, so one query, which
// selects a column, can go to every peer, whatever its size.
//
//   peer:   table = createTable(records)        records of shape.record bytes
//           h = await hint(table)               to each asker, once; then changes
//           answer(table, query)                per question, over the whole table
//   asker:  m = await mask()                    ahead of time; one per question
//           query = select(m, column)
//           readRecord(answer, h, m, group)     the record, from the peer's answer
//
// The peer sees only the query: an LWE sample, which looks random whatever
// the column, under a secret the asker draws for each question and never
// uses again. The hint (table times A) holds nothing secret; a peer's
// changes keep askers' copies current (setRecord, updateHint), and a peer
// can answer for a hint a few changes old (rewind).
//
// A is public and the same for everyone: the AES-128-CTR stream of a fixed
// seed (as FrodoKEM expands its matrix), so any row of it can be made on
// demand, by WebCrypto, and nobody holds all of it.
//
// Parameters (SHAPE): dimension 1408 and Gaussian noise of standard
// deviation 6.4 modulo 2^32, where HintlessPIR (Li et al., 2023) moved
// SimplePIR on the latest lattice estimates, for 128-bit security; to be
// checked with the lattice estimator before page text depends on them.
// With p = 512, decryption keeps over 10 standard deviations of margin even
// for a table of all-maximum values (a failure about 2^-75 per element).
//
// Imports nothing; meant to be shared by the browser and the stack's peers.

export const SHAPE = Object.freeze({
    cols: 1 << 14, // columns: every table in the swarm has this many
    n: 1408, // LWE dimension
    sigma: 6.4, // noise: standard deviation (a Gaussian width of 6.4 * sqrt(2 pi))
    p: 512, // plaintext modulus: 9 bits per element
    record: 256, // bytes per record
    seed: 'src pir 1' // A's seed
})

const CHUNK = 128 // rows of A made at a time (between them, other work runs)
const RANDOM = 16384 // words per getRandomValues call (its limit is 64 KiB)

const bits = (p) => 31 - Math.clz32(p)

function check(shape) {
    const { cols, n, p, record } = shape
    if (!(p > 1 && (p & (p - 1)) === 0 && p <= 1 << 16)) throw new Error('pir: p must be a power of two, at most 2^16')
    if (!(cols > 0 && n > 0 && record > 0)) throw new Error('pir: bad shape')
    return shape
}

// Elements a record takes: its bits, at log2(p) a element.
export const elements = (shape = SHAPE) => Math.ceil((check(shape).record * 8) / bits(shape.p))

// The scale that lifts a plaintext element into the top bits: 2^32 / p.
const delta = (shape) => 2 ** (32 - bits(shape.p))

// Where record `index` sits.
export const locate = (index, shape = SHAPE) => ({ column: index % shape.cols, group: Math.floor(index / shape.cols) })

// ------------------------------------------------------------ the matrix A

const keys = new Map() // seed -> AES key
const LITTLE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1

function aesKey(seed) {
    if (!keys.has(seed)) {
        keys.set(
            seed,
            crypto.subtle
                .digest('SHA-256', new TextEncoder().encode(seed))
                .then((digest) => crypto.subtle.importKey('raw', digest.slice(0, 16), 'AES-CTR', false, ['encrypt']))
        )
    }
    return keys.get(seed)
}

// Rows [from, from + count) of A, row-major, n words each: the stream's
// bytes from offset from * n * 4, read as little-endian 32-bit words.
export async function matrixRows(shape, from, count) {
    const { n } = shape
    const offset = from * n * 4
    const block = Math.floor(offset / 16)
    const skip = offset % 16
    const length = skip + count * n * 4
    const counter = new Uint8Array(16)
    const view = new DataView(counter.buffer)
    view.setUint32(8, Math.floor(block / 2 ** 32))
    view.setUint32(12, block >>> 0)
    const stream = await crypto.subtle.encrypt({ name: 'AES-CTR', counter, length: 64 }, await aesKey(shape.seed), new Uint8Array(length))
    const bytes = stream.slice(skip, length)
    if (LITTLE) return new Uint32Array(bytes)
    const words = new DataView(bytes)
    return Uint32Array.from({ length: count * n }, (_, i) => words.getUint32(i * 4, true))
}

// ------------------------------------------------------------ randomness

function randomWords(count) {
    const out = new Uint32Array(count)
    for (let at = 0; at < count; at += RANDOM) crypto.getRandomValues(out.subarray(at, Math.min(count, at + RANDOM)))
    return out
}

// Discrete Gaussian noise, by a table of cumulative probabilities over
// |x|, scanned whole for every sample (so its time does not depend on the
// value), from 53 random bits; one more bit is the sign.
const tables = new Map() // sigma -> cumulative probabilities of |x| = 0, 1, ...
function cumulative(sigma) {
    if (!tables.has(sigma)) {
        const tail = Math.ceil(sigma * 12)
        const weights = Array.from({ length: tail + 1 }, (_, x) => (x ? 2 : 1) * Math.exp(-(x * x) / (2 * sigma * sigma)))
        const total = weights.reduce((a, b) => a + b, 0)
        let sum = 0
        tables.set(sigma, Float64Array.from(weights.slice(0, -1), (w) => (sum += w / total)))
    }
    return tables.get(sigma)
}

export function noise(count, sigma = SHAPE.sigma) {
    const table = cumulative(sigma)
    const random = randomWords(count * 2)
    const out = new Int32Array(count)
    for (let i = 0; i < count; i++) {
        const hi = random[2 * i]
        const lo = random[2 * i + 1]
        const u = ((hi >>> 5) * 67108864 + (lo >>> 6)) / 2 ** 53
        let x = 0
        for (let k = 0; k < table.length; k++) x += u >= table[k] ? 1 : 0
        out[i] = lo & 1 ? -x : x
    }
    return out
}

// ------------------------------------------------------------ records and tables

// A record's bytes as elements of log2(p) bits, little-endian, and back.
export function toElements(bytes, shape = SHAPE) {
    const b = bits(shape.p)
    const out = new Uint16Array(elements(shape))
    for (let bit = 0; bit < shape.record * 8; bit++) {
        if ((bytes[bit >> 3] >> (bit & 7)) & 1) out[Math.floor(bit / b)] |= 1 << bit % b
    }
    return out
}

export function fromElements(values, shape = SHAPE) {
    const b = bits(shape.p)
    const out = new Uint8Array(shape.record)
    for (let bit = 0; bit < shape.record * 8; bit++) {
        if ((values[Math.floor(bit / b)] >> bit % b) & 1) out[bit >> 3] |= 1 << (bit & 7)
    }
    return out
}

// A table of records (a multiple of shape.cols of them): rows x cols
// elements, row-major. Record i's elements run down its column, in its
// group's rows.
export function createTable(records, shape = SHAPE) {
    const { cols } = check(shape)
    if (!records.length || records.length % cols) throw new Error(`pir: a table holds a multiple of ${cols} records`)
    const per = elements(shape)
    const groups = records.length / cols
    const table = { shape, groups, rows: groups * per, data: new Uint16Array(groups * per * cols), version: 0 }
    records.forEach((bytes, index) => write(table, index, toElements(bytes, shape)))
    return table
}

function write(table, index, values) {
    const { cols } = table.shape
    const { column, group } = locate(index, table.shape)
    const changes = []
    for (let k = 0; k < values.length; k++) {
        const row = group * values.length + k
        const at = row * cols + column
        if (table.data[at] === values[k]) continue
        changes.push({ row, column, change: values[k] - table.data[at] })
        table.data[at] = values[k]
    }
    return changes
}

// Replace records, as [index, bytes] pairs. Returns what changed, element
// by element, for askers' hints (updateHint) and for answering older ones
// (rewind); the table's version goes up by one.
export function setRecords(table, updates) {
    const changes = []
    for (const [index, bytes] of updates) for (const change of write(table, index, toElements(bytes, table.shape))) changes.push(change)
    table.version++
    return changes
}

export const setRecord = (table, index, bytes) => setRecords(table, [[index, bytes]])

// ------------------------------------------------------------ the peer

// The hint: the table times A, rows x n. Costly (rows * cols * n
// multiply-adds, less for empty records); made once per table, then kept
// current with changes.
export async function hint(table) {
    const { shape, rows, data } = table
    const { cols, n } = shape
    const out = new Int32Array(rows * n)
    for (let from = 0; from < cols; from += CHUNK) {
        const count = Math.min(CHUNK, cols - from)
        const a = await matrixRows(shape, from, count)
        for (let i = 0; i < count; i++) {
            const column = from + i
            const at = i * n
            for (let r = 0; r < rows; r++) {
                const d = data[r * cols + column]
                if (!d) continue
                const h = r * n
                for (let j = 0; j < n; j++) out[h + j] = (out[h + j] + Math.imul(d, a[at + j])) | 0
            }
        }
    }
    return out
}

// The answer to a query: the table times the query, one word per row.
export function answer(table, query) {
    const { rows, data, shape } = table
    const { cols } = shape
    if (query.length !== cols) throw new Error('pir: the query does not fit this table')
    const out = new Int32Array(rows)
    for (let r = 0; r < rows; r++) {
        let acc = 0
        const at = r * cols
        for (let c = 0; c < cols; c++) acc = (acc + Math.imul(data[at + c], query[c])) | 0
        out[r] = acc
    }
    return out
}

// An answer as the table stood before `changes` (those made since the
// asker's hint): linear, so each change's part is simply taken out.
export function rewind(answered, query, changes) {
    const out = Int32Array.from(answered)
    for (const { row, column, change } of changes) out[row] = (out[row] - Math.imul(change, query[column])) | 0
    return out
}

// ------------------------------------------------------------ the asker

// A hint kept current: each change adds its multiple of one row of A.
export async function updateHint(hinted, changes, shape = SHAPE) {
    const { n } = shape
    const columns = [...new Set(changes.map((c) => c.column))]
    const rowsOf = new Map(await Promise.all(columns.map(async (column) => [column, await matrixRows(shape, column, 1)])))
    for (const { row, column, change } of changes) {
        const a = rowsOf.get(column)
        const h = row * n
        for (let j = 0; j < n; j++) hinted[h + j] = (hinted[h + j] + Math.imul(change, a[j])) | 0
    }
    return hinted
}

// A question's mask, A s + e, under a fresh secret s: made ahead of time
// (it is most of the asker's work), and used for one query only.
export async function mask(shape = SHAPE) {
    const { cols, n } = check(shape)
    const secret = randomWords(n)
    const vector = noise(cols, shape.sigma)
    for (let from = 0; from < cols; from += CHUNK) {
        const count = Math.min(CHUNK, cols - from)
        const a = await matrixRows(shape, from, count)
        for (let i = 0; i < count; i++) {
            let acc = vector[from + i]
            const at = i * n
            for (let j = 0; j < n; j++) acc = (acc + Math.imul(a[at + j], secret[j])) | 0
            vector[from + i] = acc
        }
    }
    return { shape, secret, vector, used: false }
}

// The query for one column. A mask serves once: two queries under one
// secret would show the peer both columns (their difference).
export function select(masked, column) {
    if (masked.used) throw new Error('pir: a mask is used for one query only')
    if (!(column >= 0 && column < masked.shape.cols)) throw new Error('pir: no such column')
    masked.used = true
    const query = Int32Array.from(masked.vector)
    query[column] = (query[column] + delta(masked.shape)) | 0
    return query
}

// Record `group` of the selected column, from a peer's answer and that
// peer's hint: each row, less the hint's part, rounded to its top bits.
export function readRecord(answered, hinted, masked, group) {
    const { shape, secret } = masked
    const { n, p } = shape
    const per = elements(shape)
    const shift = 32 - bits(p)
    const half = delta(shape) / 2
    const values = new Uint16Array(per)
    for (let k = 0; k < per; k++) {
        const row = group * per + k
        if (row >= answered.length) throw new Error('pir: no such group in this answer')
        let acc = answered[row]
        const h = row * n
        for (let j = 0; j < n; j++) acc = (acc - Math.imul(hinted[h + j], secret[j])) | 0
        values[k] = (((acc + half) | 0) >>> shift) & (p - 1)
    }
    return fromElements(values, shape)
}
