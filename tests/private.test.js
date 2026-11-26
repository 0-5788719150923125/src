import test from 'node:test'
import assert from 'node:assert/strict'
import { keysFor } from '../src/js/crypto.js'
import { SHAPE } from '../src/js/pir.js'
import {
    createAnswerer,
    createAsker,
    privateExtension
} from '../src/js/private.js'

const S = { ...SHAPE, cols: 64 }
const ARCHIVES =
    '\nthe quick brown fox jumps over the lazy dog\nthe archives say the signal started before the network did\n'

// Two fake wires joined to each other, as BitTorrent wires carrying the
// extension; `drop(bytes)` loses messages, `sent` keeps what each side sent.
function connect(asker, answerer, { drop = () => false } = {}) {
    const make = () => ({
        peerExtendedMapping: { src_pir: 1 },
        destroyed: false,
        sent: [],
        closers: [],
        once(event, fn) {
            if (event === 'close') this.closers.push(fn)
        }
    })
    const a = make()
    const b = make()
    const pass = (from, to) => (name, buf) => {
        const bytes = Uint8Array.from(buf)
        // What a data channel to Node takes, less the BitTorrent framing.
        if (bytes.length > 65536 - 6)
            throw new Error(`message of ${bytes.length} bytes`)
        from.sent.push(bytes)
        if (!drop(bytes, from === a))
            setImmediate(() => to.ext.onMessage(bytes))
    }
    a.extended = pass(a, b)
    b.extended = pass(b, a)
    a.ext = new (privateExtension(asker.handle))(a)
    b.ext = new (privateExtension(answerer.handle))(b)
    a.ext.onExtendedHandshake({ m: { src_pir: 1 } })
    b.ext.onExtendedHandshake({ m: { src_pir: 1 } })
    return { a, b }
}

const until = async (ok, ms = 5000) => {
    for (const end = Date.now() + ms; !ok();) {
        if (Date.now() > end) throw new Error('timed out')
        await new Promise((r) => setTimeout(r, 10))
    }
}

// The asker's final memory about `context`.
const ask = (asker, context) =>
    new Promise((resolve) =>
        asker.ask(context, (memory, done) => done && resolve(memory))
    )
const spansOf = (memory) => (memory?.spans ?? []).map(([text]) => text)

async function ready(asker, peers = 1) {
    await until(() => asker.status().ready >= peers)
    await asker.fill()
}

// An answerer holding ARCHIVES, and an asker connected to it, ready.
async function pair(answering = {}, asking = {}) {
    const answerer = createAnswerer({ shape: S, ...answering })
    await answerer.load(ARCHIVES)
    const asker = createAsker({ shape: S, ...asking })
    const wires = connect(asker, answerer)
    await ready(asker)
    return { answerer, asker, ...wires }
}

test('a question is answered, and the peer never sees its words', async () => {
    const { answerer, asker, a } = await pair()
    const memory = await ask(asker, 'they say the archives say the sig')
    assert.deepEqual(spansOf(memory), ['nal started before the'])
    assert.equal(memory.L, 15)
    // Nothing the asker sent holds what it typed.
    const sent = Buffer.concat(a.sent)
    for (const word of ['archives', 'sig', 'they say'])
        assert.equal(sent.indexOf(word), -1, word)
    assert.equal(answerer.stats.questions, 1)
})

test('one query goes to peers of every size, and their answers merge', async () => {
    const small = createAnswerer({ shape: S, groups: 1 })
    const large = createAnswerer({ shape: S, groups: 3 })
    await small.load('\nwe will meet at the old mill tonight\n')
    await large.load('\nwe will meet at the station at noon\n')
    const asker = createAsker({ shape: S })
    const one = connect(asker, small)
    const two = connect(asker, large)
    await ready(asker, 2)
    const memory = await ask(asker, 'so we will meet at ')
    assert.deepEqual(spansOf(memory).sort(), [
        'the old mill tonight',
        'the station at noon'
    ])
    // The very same query went to both (at the real width, in two parts).
    const query = (side) => side.a.sent.filter((bytes) => bytes[0] === 6)
    assert.deepEqual(query(one), query(two))
})

test('pinned peers count fully, the rest for half; pinnedOnly hears no one else', async () => {
    const pinned = createAnswerer({ shape: S, secret: 'library one' })
    const stranger = createAnswerer({ shape: S, secret: 'someone else' })
    const unsigned = createAnswerer({ shape: S })
    await pinned.load('\nplease send it to the main office today\n')
    await stranger.load('\nplease send it to my private address now\n')
    await unsigned.load('\nplease send it to the wrong place now\n')
    const { pub } = await keysFor('library one')
    const only = createAsker({ shape: S, pinned: [pub], pinnedOnly: true })
    const prefers = createAsker({ shape: S, pinned: [pub] })
    for (const asker of [only, prefers])
        for (const peer of [pinned, stranger, unsigned]) connect(asker, peer)
    await ready(only)
    await ready(prefers, 3)
    await new Promise((r) => setTimeout(r, 200))
    assert.deepEqual([only.status().ready, only.status().trusted], [1, 1])
    assert.deepEqual(spansOf(await ask(only, 'could you please send it to ')), [
        'the main office today'
    ])
    assert.deepEqual([prefers.status().ready, prefers.status().trusted], [3, 1])
    const memory = await ask(prefers, 'could you please send it to ')
    assert.equal(memory.spans[0][0], 'the main office today')
    assert.equal(memory.spans[0][1], 0.5) // 1 of 2 counted halves
    assert.equal(memory.spans.length, 3)
    assert.equal(memory.w, 1) // the memory itself counts fully
})

test('with the pinned peers gone, the others still answer', async () => {
    const tab = createAnswerer({ shape: S })
    await tab.load('\nplease send it to the main office today\n')
    const { pub } = await keysFor('a library that is down')
    const asker = createAsker({ shape: S, pinned: [pub] })
    connect(asker, tab)
    await ready(asker)
    assert.deepEqual(
        spansOf(await ask(asker, 'could you please send it to ')),
        ['the main office today']
    )
})

test('a peer gives out hints and answers within its budgets', async () => {
    const stingy = createAnswerer({ shape: S, hintsPerMinute: 1 })
    await stingy.load(ARCHIVES)
    const first = createAsker({ shape: S })
    const second = createAsker({ shape: S })
    connect(first, stingy)
    connect(second, stingy)
    await until(() => first.status().ready + second.status().ready >= 1)
    await new Promise((r) => setTimeout(r, 200))
    assert.equal(first.status().ready + second.status().ready, 1)
    assert.equal(stingy.stats.hints, 1)
})

test('changes reach askers, and a peer answers a hint that missed them', async () => {
    const answerer = createAnswerer({ shape: S })
    await answerer.load(ARCHIVES)
    const current = createAsker({ shape: S })
    const behind = createAsker({ shape: S })
    connect(current, answerer)
    connect(behind, answerer, {
        drop: (bytes, fromAsker) => !fromAsker && bytes[0] === 5
    }) // loses CHANGES
    await ready(current)
    await ready(behind)
    await answerer.load('\nthe archives say the signal was a song all along\n')
    await until(() => current.status().ready && answerer.version === 2)
    await new Promise((r) => setTimeout(r, 100))
    assert.deepEqual(
        spansOf(await ask(current, 'they say the archives say the sig')),
        ['nal was a song all along']
    )
    // Still on version 1: answered as the table stood then.
    assert.deepEqual(
        spansOf(await ask(behind, 'they say the archives say the sig')),
        ['nal started before the']
    )
})

test('a hint too old to answer is fetched again', async () => {
    const { answerer, asker } = await pair({ history: 0, push: 0 })
    await answerer.load('\nthe archives say the signal was a song all along\n')
    // Too many changes to push: a new offer, and a new hint.
    await until(() => asker.status().ready && answerer.stats.hints === 2)
    await new Promise((r) => setTimeout(r, 100))
    assert.deepEqual(
        spansOf(await ask(asker, 'they say the archives say the sig')),
        ['nal was a song all along']
    )
})

test('a cautious asker keeps numbers and links only where two peers agree', async () => {
    const text = '\nfor help call the desk at 555 0199 any day\n'
    const one = createAnswerer({ shape: S })
    const two = createAnswerer({ shape: S })
    const liar = createAnswerer({ shape: S })
    await one.load(text)
    await two.load(text)
    await liar.load('\nfor help call the desk at 555 6666 any day\n')
    const alone = createAsker({ shape: S, cautious: true })
    connect(alone, liar)
    await ready(alone)
    assert.equal(await ask(alone, 'and for help call the desk at '), null)
    const asker = createAsker({ shape: S, cautious: true })
    connect(asker, one)
    connect(asker, two)
    connect(asker, liar)
    await ready(asker, 3)
    assert.deepEqual(
        spansOf(await ask(asker, 'and for help call the desk at ')),
        ['555 0199 any day']
    )
})

test('with no mask left, the latest question waits for the next; older ones are dropped', async () => {
    const { asker } = await pair({}, { pool: 1 })
    const first = ask(asker, 'they say the quick brown ') // takes the one mask
    const second = ask(asker, 'they say the archives say ') // waits, then is dropped
    const third = ask(asker, 'they say the archives say the sig') // waits for the next mask
    assert.deepEqual(spansOf(await first), ['fox jumps over the lazy dog'])
    assert.equal(await second, null)
    assert.deepEqual(spansOf(await third), ['nal started before the'])
    assert.deepEqual([asker.status().asked, asker.status().dropped], [2, 1])
})

test('the record fetched as a word starts answers every guess within it, at once', async () => {
    const { answerer, asker } = await pair()
    asker.prefetch('they say the archives say the ')
    await until(() => asker.status().answered === 1)
    // Answered before ask returns: no query, no wait.
    for (const [typed, span] of [
        ['s', 'ignal started before the'],
        ['sig', 'nal started before the'],
        ['signa', 'l started before the']
    ]) {
        let got = null
        asker.ask(
            `they say the archives say the ${typed}`,
            (memory, done) => done && (got = memory)
        )
        assert.deepEqual(spansOf(got), [span], typed)
    }
    assert.equal(asker.status().asked, 1)
    assert.equal(answerer.stats.questions, 1)
})

test('a kept record is fetched again once its peer changes', async () => {
    const { answerer, asker } = await pair()
    assert.deepEqual(
        spansOf(await ask(asker, 'they say the archives say the sig')),
        ['nal started before the']
    )
    await answerer.load('\nthe archives say the signal was a song all along\n')
    await until(() => answerer.version === 2)
    await new Promise((r) => setTimeout(r, 100))
    assert.deepEqual(
        spansOf(await ask(asker, 'they say the archives say the sig')),
        ['nal was a song all along']
    )
    assert.equal(asker.status().asked, 2)
})

test('a peer kept a line at a time sends askers only the changes', async () => {
    const answerer = createAnswerer({ shape: S })
    const lines = [
        'the quick brown fox jumps over the lazy dog',
        'the archives say the signal started before the network did'
    ]
    await answerer.sync({ trade: lines })
    const asker = createAsker({ shape: S })
    connect(asker, answerer)
    await ready(asker)
    assert.deepEqual(
        spansOf(await ask(asker, 'they say the archives say the sig')),
        ['nal started before the']
    )
    await answerer.sync({
        trade: [...lines, 'we will meet at the old mill tonight']
    })
    await until(() => answerer.version === 2)
    await new Promise((r) => setTimeout(r, 100))
    assert.deepEqual(spansOf(await ask(asker, 'so we will meet at ')), [
        'the old mill tonight'
    ])
    assert.equal(answerer.stats.hints, 1) // no new hint: the changes sufficed
})

test('changes too many for one message come in parts', async () => {
    const answerer = createAnswerer({ shape: S })
    await answerer.sync({
        trade: ['the archives say the signal started before the network did']
    })
    const asker = createAsker({ shape: S })
    const { b } = connect(asker, answerer)
    await ready(asker)
    // Many new lines at once: thousands of elements change.
    const many = Array.from(
        { length: 60 },
        (_, i) => `line ${i} of the burst says the word number ${i} is here now`
    )
    await answerer.sync({
        trade: [
            'the archives say the signal started before the network did',
            ...many,
            'we will meet at the old mill tonight'
        ]
    })
    await new Promise((r) => setTimeout(r, 300))
    const parts = b.sent.filter((bytes) => bytes[0] === 5)
    assert.ok(parts.length > 1, `${parts.length} parts`)
    assert.deepEqual(spansOf(await ask(asker, 'so we will meet at ')), [
        'the old mill tonight'
    ])
    assert.equal(answerer.stats.hints, 1)
})

test('loads and syncs take turns: two at once make one first table', async () => {
    const answerer = createAnswerer({ shape: S })
    const [one, two] = await Promise.all([
        answerer.sync({
            trade: [
                'the archives say the signal started before the network did'
            ]
        }),
        answerer.sync({
            trade: [
                'the archives say the signal started before the network did',
                'we will meet at the old mill tonight'
            ]
        })
    ])
    assert.deepEqual([one.version, two.version], [1, 2])
})
