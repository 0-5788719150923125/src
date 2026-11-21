import test from 'node:test'
import assert from 'node:assert/strict'
import { seedUrl, tracksOf } from '../src/js/station.js'
import { EXTENSION, chatExtension, createGossip, isPlain, relay, roomFile, sendTo } from '../src/js/room.js'
import { createStore } from '../src/js/state.js'
import { buildChain, generateOne } from '../src/js/daemon.js'
import { schedule } from '../src/js/morse.js'
import { seededRandom } from '../src/js/random.js'
import { formatDate } from '../src/js/time.js'
import { PUBLIC_TRACKERS, loadStations, siteConfig } from '../scripts/build.js'

// The v3 implementation, kept here so the port can be checked against it.
function legacyPRNG(str) {
    function xmur3(str) {
        for (var i = 0, h = 1779033703 ^ str.length; i < str.length; i++) {
            h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
            h = (h << 13) | (h >>> 19)
        }
        return function () {
            h = Math.imul(h ^ (h >>> 16), 2246822507)
            h = Math.imul(h ^ (h >>> 13), 3266489909)
            return (h ^= h >>> 16) >>> 0
        }
    }
    function xoshiro128ss(a, b, c, d) {
        return function () {
            var t = b << 9,
                r = a * 5
            r = ((r << 7) | (r >>> 25)) * 9
            c ^= a
            d ^= b
            b ^= c
            a ^= d
            c ^= t
            d = (d << 11) | (d >>> 21)
            return (r >>> 0) / 4294967296
        }
    }
    const state = xmur3(str)
    return xoshiro128ss(state(), state(), state(), state())()
}

test('seededRandom matches v3', () => {
    for (const seed of ['', 'a', 'GhostIsCuteVoidGirl', 'GhostIsCuteVoidGirlaaa', 'f'.repeat(64)]) {
        assert.equal(seededRandom(seed), legacyPRNG(seed))
    }
})

test('formatDate uses a 12-hour clock', () => {
    assert.equal(formatDate(new Date(2026, 0, 2, 13, 4, 5)), '2026/01/02 01:04:05')
})

test('only plain messages pass', () => {
    assert.equal(isPlain('hello there, friend!'), true)
    assert.equal(isPlain('<script>'), false)
    assert.equal(isPlain('a'.repeat(21)), false)
})

test('tracks come from file names, extras from shared prefixes', () => {
    const tracks = tracksOf(
        [
            '59/02 - Leviathan Hunter - cover.png',
            '59/01 - Fantasy (Earth Wind and Fire).mp3',
            '59/02 - Leviathan Hunter.mp3',
            '59/02 - Leviathan Hunter - lyrics 2.jpg',
            '59/02 - Leviathan Hunter - lyrics 1.jpg',
            '59/notes.txt'
        ],
        { artist: 'Toehider' }
    )
    assert.deepEqual(
        tracks.map((t) => t.title),
        ['Fantasy (Earth Wind and Fire)', 'Leviathan Hunter']
    )
    assert.equal(tracks[0].artist, 'Toehider')
    assert.deepEqual(tracks[0].extras, [])
    assert.deepEqual(
        tracks[1].extras.map((e) => e.label),
        ['cover', 'lyrics 1', 'lyrics 2']
    )
})

test('seed URLs encode each path segment', () => {
    assert.equal(
        seedUrl('http://localhost:8001', "59/57 - Estranged (Guns n' Roses).mp3"),
        "http://localhost:8001/radio/59/57%20-%20Estranged%20(Guns%20n'%20Roses).mp3"
    )
})

test('a room is the same file for everyone', async () => {
    const a = roomFile('trade')
    const b = roomFile('trade')
    assert.equal(a.name, 'src-focus-trade')
    assert.deepEqual(new Uint8Array(await a.arrayBuffer()), new Uint8Array(await b.arrayBuffer()))
    assert.notEqual(roomFile('guild').name, a.name)
})

// A stand-in for a bittorrent-protocol wire.
const fakeWire = (speaks = true) => ({
    destroyed: false,
    peerExtendedMapping: speaks ? { [EXTENSION]: 3 } : {},
    sent: [],
    extended(name, buf) {
        this.sent.push(JSON.parse(new TextDecoder().decode(buf)))
    }
})

test('messages relay to every other wire, once', () => {
    const gossip = createGossip()
    const from = fakeWire()
    const others = [fakeWire(), fakeWire(), fakeWire(false)]
    const received = []
    const Chat = chatExtension((payload, wire) => {
        if (!gossip.fresh(payload.id)) return
        received.push(payload)
        relay(payload, wire, [from, ...others])
    })
    assert.equal(Chat.prototype.name, EXTENSION)
    const ext = new Chat(from)
    const message = new TextEncoder().encode(JSON.stringify({ id: 'x1', message: 'hi' }))
    ext.onMessage(message)
    ext.onMessage(message)
    ext.onMessage(new TextEncoder().encode('not json'))
    ext.onMessage(new Uint8Array(9000))
    assert.equal(received.length, 1)
    assert.equal(from.sent.length, 0)
    assert.equal(others[0].sent.length, 1)
    assert.equal(others[1].sent[0].message, 'hi')
    assert.equal(others[2].sent.length, 0)
    assert.equal(sendTo({ ...fakeWire(), destroyed: true }, { id: 'y' }), false)
})

test('gossip forgets the oldest ids past its size', () => {
    const gossip = createGossip(2)
    assert.equal(gossip.fresh('a'), true)
    assert.equal(gossip.fresh('a'), false)
    gossip.fresh('b')
    gossip.fresh('c')
    assert.equal(gossip.fresh('a'), true)
})

test('the store sets, reads and deletes nested keys, never in place', () => {
    const store = createStore({ book: 'offline' })
    const before = store.snapshot()
    store.set('radio.frequency', '59FM')
    store.set('radio.station', 'x')
    assert.equal(store.get('radio.frequency'), '59FM')
    assert.deepEqual(before, { book: 'offline' })
    store.delete('radio.frequency')
    assert.deepEqual(store.snapshot(), { book: 'offline', radio: { station: 'x' } })
    store.delete('radio.station')
    store.delete('nothing.here')
    assert.deepEqual(store.snapshot(), { book: 'offline' })
})

test('a daemon name depends only on its seed', () => {
    const chain = buildChain(['Abraxas', 'Astaroth', 'Azazel', 'Baal'])
    const name = generateOne(chain, 'seed')
    assert.equal(generateOne(chain, 'seed'), name)
    assert.match(name, /^[AB]/)
})

test('morse timing follows its units', () => {
    // E is one dot: one unit for the letter gap, one before the symbol, one for the dot.
    assert.deepEqual(schedule('e', 1), [3])
    assert.equal(schedule('the quick brown fox jumped over a lazy dog').length > 60, true)
})

test('the build reads stations and the environment', async () => {
    const stations = await loadStations()
    assert.equal(stations['59'].artist, 'Toehider')
    const local = siteConfig(stations, {})
    assert.equal(local.seed, 'http://localhost:8001')
    assert.deepEqual(local.trackers, ['ws://localhost:8002', ...PUBLIC_TRACKERS])
    const live = siteConfig(stations, { SRC_SEED_URL: 'https://seed.src.eco/', SRC_TRACKER_URL: 'wss://tracker.src.eco' })
    assert.equal(live.seed, 'https://seed.src.eco')
    assert.equal(live.trackers[0], 'wss://tracker.src.eco')
})

test('the stack tracker is optional, and deploys keep local addresses out', async () => {
    const stations = await loadStations()
    assert.deepEqual(siteConfig(stations, { SRC_TRACKER_URL: '' }).trackers, PUBLIC_TRACKERS)
    assert.deepEqual(siteConfig(stations, {}, { deploy: true }).trackers, PUBLIC_TRACKERS)
    const live = siteConfig(stations, { SRC_TRACKER_URL: 'wss://tracker.src.eco' }, { deploy: true })
    assert.equal(live.trackers[0], 'wss://tracker.src.eco')
})
