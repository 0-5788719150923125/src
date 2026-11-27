import test from 'node:test'
import assert from 'node:assert/strict'
import {
    dial,
    onAir,
    rate,
    seedUrl,
    shuffledLoop,
    stationStats,
    tracksOf
} from '../src/js/station.js'
import {
    AGE,
    EXTENSION,
    chatExtension,
    createGossip,
    isPlain,
    relay,
    roomFile,
    sendTo,
    signed,
    toVerify
} from '../src/js/room.js'
import { keysFor, randomHex, sign, verify } from '../src/js/crypto.js'
import { createStore } from '../src/js/state.js'
import { buildChain, generateOne } from '../src/js/daemon.js'
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
    for (const seed of [
        '',
        'a',
        'GhostIsCuteVoidGirl',
        'GhostIsCuteVoidGirlaaa',
        'f'.repeat(64)
    ]) {
        assert.equal(seededRandom(seed), legacyPRNG(seed))
    }
})

test('formatDate uses a 12-hour clock', () => {
    assert.equal(
        formatDate(new Date(2026, 0, 2, 13, 4, 5)),
        '2026/01/02 01:04:05'
    )
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
        seedUrl(
            'http://localhost:8001',
            "59/57 - Estranged (Guns n' Roses).mp3"
        ),
        "http://localhost:8001/radio/59/57%20-%20Estranged%20(Guns%20n'%20Roses).mp3"
    )
})

test('a room is the same file for everyone', async () => {
    const a = roomFile('trade')
    const b = roomFile('trade')
    assert.equal(a.name, 'src-focus-trade')
    assert.deepEqual(
        new Uint8Array(await a.arrayBuffer()),
        new Uint8Array(await b.arrayBuffer())
    )
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
    const message = new TextEncoder().encode(
        JSON.stringify({ id: 'x1', message: 'hi' })
    )
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

test('gossip remembers ids while a message is in time, and so many at most', () => {
    const gossip = createGossip(1000, 2)
    assert.equal(gossip.fresh('a', 0), true)
    assert.equal(gossip.fresh('a', 1), false)
    assert.equal(gossip.has('a'), true)
    gossip.fresh('b', 2)
    gossip.fresh('c', 3)
    assert.equal(gossip.fresh('a', 4), true) // past the most
    gossip.fresh('d', 2000)
    assert.equal(gossip.has('c'), false) // past the span
})

test("a signature covers a message's chat, id and time, so it cannot be moved or replayed", async () => {
    const keys = await keysFor(randomHex(96))
    const now = Date.now()
    const payload = { id: 'x1', room: 'trade', at: now, message: 'hi' }
    payload.pubKey = keys.pub
    payload.signature = await sign(keys, signed(payload))
    const reads = async (p, room = 'trade', at = now) => {
        const text = toVerify(p, room, at)
        return Boolean(text) && verify(p.pubKey, p.signature, text)
    }
    assert.equal(await reads(payload), true)
    // Sent in another chat, as it stands or relabeled.
    assert.equal(await reads(payload, 'secret'), false)
    assert.equal(await reads({ ...payload, room: 'secret' }, 'secret'), false)
    // Sent again under a new id, or with a new time.
    assert.equal(await reads({ ...payload, id: 'x2' }), false)
    assert.equal(await reads({ ...payload, at: now + 1 }), false)
    // Replayed later, or from a clock far ahead.
    assert.equal(await reads(payload, 'trade', now + AGE + 1), false)
    assert.equal(await reads(payload, 'trade', now - AGE - 1), false)
    assert.equal(await reads(payload, 'trade', now + AGE), true)
    // No time, or the old form that signed the text alone.
    const { at, ...timeless } = payload
    assert.equal(await reads(timeless), false)
    const old = { ...timeless, signature: await sign(keys, 'hi') }
    assert.equal(await reads({ ...old, at: now }), false)
})

test('the store sets, reads and deletes nested keys, never in place', () => {
    const store = createStore({ wire: 'offline' })
    const before = store.snapshot()
    store.set('radio.frequency', '59FM')
    store.set('radio.station', 'x')
    assert.equal(store.get('radio.frequency'), '59FM')
    assert.deepEqual(before, { wire: 'offline' })
    store.delete('radio.frequency')
    assert.deepEqual(store.snapshot(), {
        wire: 'offline',
        radio: { station: 'x' }
    })
    store.delete('radio.station')
    store.delete('nothing.here')
    assert.deepEqual(store.snapshot(), { wire: 'offline' })
})

test('a daemon name depends only on its seed', () => {
    const chain = buildChain(['Abraxas', 'Astaroth', 'Azazel', 'Baal'])
    const name = generateOne(chain, 'seed')
    assert.equal(generateOne(chain, 'seed'), name)
    assert.match(name, /^[AB]/)
})

test('the build reads stations and the environment', async () => {
    const stations = await loadStations()
    assert.equal(stations['59.1'].artist, 'Toehider')
    const plain = siteConfig(stations, {})
    assert.equal(plain.seed, '')
    assert.deepEqual(plain.trackers, PUBLIC_TRACKERS)
    const local = siteConfig(stations, {
        SRC_SEED_URL: 'http://localhost:8001',
        SRC_TRACKER_URL: 'ws://localhost:8002'
    })
    assert.equal(local.seed, 'http://localhost:8001')
    assert.deepEqual(local.trackers, [
        'ws://localhost:8002',
        ...PUBLIC_TRACKERS
    ])
    const live = siteConfig(stations, {
        SRC_SEED_URL: 'https://seed.src.eco/',
        SRC_TRACKER_URL: 'wss://tracker.src.eco'
    })
    assert.equal(live.seed, 'https://seed.src.eco')
    assert.equal(live.trackers[0], 'wss://tracker.src.eco')
    // Pinned keys: Ed25519 public keys, base64url; anything else is left out.
    assert.deepEqual(plain.pinned, [])
    const key = 'uqTCm0ZfX0eJk2SR8bWbr0d6Dz8sJPkqVeXIunc4h3g'
    assert.deepEqual(
        siteConfig(stations, { SRC_PINNED_KEYS: ` ${key}, not-a-key ,` })
            .pinned,
        [key]
    )
})

test('the stack is optional, and deploys keep local addresses out', async () => {
    const stations = await loadStations()
    assert.deepEqual(
        siteConfig(stations, { SRC_TRACKER_URL: '' }).trackers,
        PUBLIC_TRACKERS
    )
    const local = {
        SRC_SEED_URL: 'http://localhost:8001',
        SRC_TRACKER_URL: 'ws://localhost:8002'
    }
    assert.deepEqual(
        siteConfig(stations, local, { deploy: true }).trackers,
        PUBLIC_TRACKERS
    )
    assert.equal(siteConfig(stations, local, { deploy: true }).seed, '')
    assert.equal(
        siteConfig(
            stations,
            { SRC_SEED_URL: 'https://seed.src.eco' },
            { deploy: true }
        ).seed,
        'https://seed.src.eco'
    )
    const live = siteConfig(
        stations,
        { SRC_TRACKER_URL: 'wss://tracker.src.eco' },
        { deploy: true }
    )
    assert.equal(live.trackers[0], 'wss://tracker.src.eco')
    // Several servers' trackers, first, and only the public ones in a deploy.
    const servers = {
        SRC_TRACKERS: ' wss://59.src.eco, wss://95.src.eco,ws://localhost:8002,'
    }
    assert.deepEqual(siteConfig(stations, servers, { deploy: true }).trackers, [
        'wss://59.src.eco',
        'wss://95.src.eco',
        ...PUBLIC_TRACKERS
    ])
})

test("a station's ticker numbers have labels and units", () => {
    assert.equal(dial('59'), '59.0')
    assert.equal(dial('59.1'), '59.1')
    assert.equal(dial('88.5'), '88.5')
    assert.deepEqual([0, 999, 1000, 12345, 1.5e6, -3].map(rate), [
        '0 B/s',
        '999 B/s',
        '1.0 kB/s',
        '12.3 kB/s',
        '1.5 MB/s',
        '0 B/s'
    ])
    const wires = [{ isSeeder: true }, { isSeeder: false }, {}]
    assert.deepEqual(
        stationStats('59', { wires, uploadSpeed: 2048, downloadSpeed: 3.2e6 }),
        {
            frequency: '59.0',
            seeders: 1,
            peers: 2,
            up: '2.0 kB/s',
            down: '3.2 MB/s'
        }
    )
})

test('every listener computes the same song and point on the schedule', () => {
    const tracks = ['a', 'b', 'c', 'd'].map((name) => ({
        path: `59.1/${name}.mp3`
    }))
    const lengths = {
        '59.1/a.mp3': 100,
        '59.1/b.mp3': 200,
        '59.1/c.mp3': 50,
        '59.1/d.mp3': 150
    } // a 500 s loop
    // In file order, the loop starts at UTC 0: 1,000,120 s is 120 s into a loop.
    const normal = onAir(tracks, lengths, { mode: 'normal' }, 1_000_120_000)
    assert.equal(normal.track.path, '59.1/b.mp3')
    assert.equal(Math.round(normal.offset), 20)
    assert.equal(normal.ends, 1_000_120_000 + 180_000)
    // Shuffled: the same on every call, a full permutation, and drawn anew
    // each time around the loop.
    const at = (now) =>
        onAir(tracks, lengths, { mode: 'shuffle', seed: '59.1' }, now)
    assert.deepEqual(at(1_000_120_000), at(1_000_120_000))
    const order = (round) => {
        const seen = []
        for (let t = round * 500_000; t < (round + 1) * 500_000; t += 10_000) {
            const { track } = at(t)
            if (seen.at(-1) !== track.path) seen.push(track.path)
        }
        return seen
    }
    assert.equal(new Set(order(2000)).size, 4)
    assert.ok(
        [2001, 2002, 2003, 2004].some(
            (round) => order(round).join() !== order(2000).join()
        )
    )
    // A song without a length is left out; none at all, no schedule.
    assert.equal(
        onAir(tracks, { '59.1/c.mp3': 50 }, {}, 123_456).track.path,
        '59.1/c.mp3'
    )
    assert.equal(onAir(tracks, {}, {}, 0), null)
})

test('a shuffled loop plays every song once, and none soon again across the seam', () => {
    for (const n of [59, 30, 7, 2, 1]) {
        const songs = Array.from({ length: n }, (_, i) => ({
            path: `59.1/${i}.mp3`
        }))
        const spread = Math.min(10, Math.floor(n / 3))
        let previous = shuffledLoop(songs, '59.1', 999)
        const orders = new Set()
        for (let round = 1000; round < 1200; round++) {
            const order = shuffledLoop(songs, '59.1', round)
            assert.equal(new Set(order).size, n) // every song, once
            if (spread) {
                const tail = new Set(previous.slice(-spread))
                assert.ok(
                    order.slice(0, spread).every((song) => !tail.has(song)),
                    `n=${n} round=${round}`
                )
            }
            assert.deepEqual(shuffledLoop(songs, '59.1', round), order) // the same on every device
            orders.add(order.map((song) => song.path).join())
            previous = order
        }
        if (n >= 7) assert.ok(orders.size > 190) // a new order nearly every loop
    }
})

test('the ticker prints top-level keys in name order, and leaves what is inside alone', async () => {
    const { sortedKeys } = await import('../src/js/state.js')
    const seeding = {
        frequency: '59.1',
        seeders: 1,
        peers: 0,
        up: '0 B/s',
        down: '0 B/s'
    }
    const shown = sortedKeys({
        writer: { download: '0%' },
        radio: { frequency: '59.1FM' },
        seeding,
        chat: 'trade',
        daemon: 'Era'
    })
    assert.deepEqual(Object.keys(shown), [
        'chat',
        'daemon',
        'radio',
        'seeding',
        'writer'
    ])
    assert.deepEqual(Object.keys(shown.seeding), [
        'frequency',
        'seeders',
        'peers',
        'up',
        'down'
    ])
})
