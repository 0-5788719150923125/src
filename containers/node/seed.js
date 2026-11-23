// The stack's peer: an always-on member of the swarm, so nothing depends on
// a browser tab staying open.
//
// - Every folder under RADIO_DIR is a station. It is seeded as one torrent
//   named after the folder (its frequency), and its .torrent file is written
//   to TORRENTS_DIR, where the web seed serves it to browsers.
// - It sits in every chat listed in CHATS and relays messages like any
//   tab would. Being reachable more often than a browser, it bridges peers
//   that could not reach each other.
//
// ANNOUNCE is the list of public trackers written into .torrent files.
// TRACKERS are extra trackers this peer announces to without publishing
// them, such as the stack's own tracker on the internal network.

import fs from 'node:fs'
import path from 'node:path'
import WebTorrent from 'webtorrent'
import { toTorrentFile } from 'parse-torrent'
import { webrtc } from './webrtc.js'

const RADIO_DIR = process.env.RADIO_DIR || '/radio'
const TORRENTS_DIR = process.env.TORRENTS_DIR || '/torrents'
const HEARTBEAT = process.env.HEARTBEAT || '/tmp/alive'
const list = (value) => (value || '').split(',').map((s) => s.trim()).filter(Boolean)
const ANNOUNCE = list(process.env.ANNOUNCE)
const TRACKERS = [...list(process.env.TRACKERS), ...ANNOUNCE]
const CHATS = list(process.env.CHATS ?? 'trade')

// room.js is shared with the browser (src/js/room.js), so both derive the
// same room torrents. The image copies it next to this file.
const { chatExtension, createGossip, relay, roomFile } = await import(process.env.ROOM_JS || './room.js')

const log = (...args) => console.log(new Date().toISOString(), ...args)

// WebRTC's UDP ports (WEBRTC_PORTS) and the guard that keeps a full range
// from crashing the process: webrtc.js, shared with the library's peers.
const { portRange, rtcConfig, connections } = await webrtc()

// UPLOAD_LIMIT caps what this peer uploads, in KiB/s (0 or unset: no cap);
// the swarm makes up the rest.
const uploadLimit = Number(process.env.UPLOAD_LIMIT) > 0 ? Number(process.env.UPLOAD_LIMIT) * 1024 : -1

const client = new WebTorrent({ dht: false, lsd: false, utp: false, natUpnp: false, natPmp: false, tracker: { rtcConfig }, uploadLimit })
client.on('error', (err) => log('error:', err.message || err))
log(
    `webrtc: ${portRange ? `udp ${portRange.begin}-${portRange.end}, at most ${connections.limit} connections` : 'any udp port'}; ` +
        `upload ${uploadLimit > 0 ? `at most ${uploadLimit / 1024} KiB/s` : 'unlimited'}`
)

// A store that only reads the station's files. WebTorrent's default store
// opens every file read-write, which the read-only mount (compose.yaml)
// refuses with EROFS, so the seeder announced every piece and then rejected
// every request for one: the radio only ever played from the web seed.
// Seeding a folder never writes (WebTorrent skips verifying what it hashed).
class ReadOnlyStore {
    constructor(chunkLength, { files, path: root, length }) {
        this.chunkLength = Number(chunkLength)
        this.length = length
        this.files = files.map((file) => ({ path: path.join(root, file.path), offset: file.offset, length: file.length }))
        this.handles = new Map()
        this.closed = false
    }

    open(file) {
        if (!this.handles.has(file.path)) this.handles.set(file.path, fs.promises.open(file.path, 'r'))
        return this.handles.get(file.path)
    }

    // Bytes [start, end) of the torrent, across its files.
    async read(start, end) {
        const out = Buffer.alloc(end - start)
        for (const file of this.files) {
            const from = Math.max(start, file.offset)
            const to = Math.min(end, file.offset + file.length)
            if (from >= to) continue
            const handle = await this.open(file)
            const { bytesRead } = await handle.read(out, from - start, to - from, from - file.offset)
            if (bytesRead !== to - from) throw new Error(`${file.path}: short read`)
        }
        return out
    }

    get(index, opts, cb) {
        if (typeof opts === 'function') [opts, cb] = [null, opts]
        if (this.closed) return queueMicrotask(() => cb(new Error('Storage is closed')))
        const chunkStart = index * this.chunkLength
        const chunkEnd = Math.min(chunkStart + this.chunkLength, this.length)
        const start = chunkStart + (opts?.offset || 0)
        const end = opts?.length != null ? start + opts.length : chunkEnd
        this.read(start, Math.min(end, chunkEnd)).then((buf) => cb(null, buf), cb)
    }

    put(index, buf, cb) {
        queueMicrotask(() => cb?.(new Error('the station is read-only')))
    }

    close(cb) {
        this.closed = true
        Promise.all([...this.handles.values()].map((handle) => handle.then((h) => h.close(), () => {})))
            .then(() => cb?.(null), (err) => cb?.(err))
    }

    // Never deletes the station.
    destroy(cb) {
        this.close(cb)
    }
}

const seed = (input, opts) =>
    new Promise((resolve, reject) => {
        const torrent = client.seed(input, opts, resolve)
        torrent.once('error', reject)
    })

async function seedStation(frequency) {
    const folder = path.join(RADIO_DIR, frequency)
    log(`station ${frequency}: hashing ${folder}`)
    const torrent = await seed(folder, { name: frequency, announce: TRACKERS, store: ReadOnlyStore })
    const file = toTorrentFile({ ...torrent, announce: ANNOUNCE, urlList: [] })
    fs.writeFileSync(path.join(TORRENTS_DIR, `${frequency}.torrent`), file)
    log(`station ${frequency}: seeding ${torrent.files.length} files as ${torrent.infoHash}`)
    return torrent
}

async function joinRoom(room) {
    const gossip = createGossip()
    const torrent = await seed(roomFile(room), { announce: TRACKERS })
    const Chat = chatExtension((payload, from) => {
        if (gossip.fresh(payload.id)) relay(payload, from, torrent.wires)
    })
    torrent.on('wire', (wire) => wire.use(Chat))
    log(`chat ${room}: relaying as ${torrent.infoHash}`)
    return torrent
}

const stations = fs.existsSync(RADIO_DIR)
    ? fs.readdirSync(RADIO_DIR).filter((name) => fs.statSync(path.join(RADIO_DIR, name)).isDirectory())
    : []
if (!stations.length) log(`no stations under ${RADIO_DIR}`)
fs.mkdirSync(TORRENTS_DIR, { recursive: true })

const rooms = await Promise.all(CHATS.map(joinRoom))
const radio = []
for (const frequency of stations) {
    try {
        radio.push(await seedStation(frequency))
    } catch (err) {
        log(`station ${frequency}: ${err.message || err}`)
    }
}

// A heartbeat for the container's health check, and a line of numbers.
setInterval(() => {
    fs.writeFileSync(HEARTBEAT, String(Date.now()))
    const peers = (torrents) => torrents.map((t) => t.numPeers).join('/')
    log(
        `peers: chats ${peers(rooms) || '-'}, stations ${peers(radio) || '-'}; ` +
            `uploaded ${(client.torrents.reduce((n, t) => n + t.uploaded, 0) / 1048576).toFixed(1)} MiB` +
            (portRange ? `; webrtc ${connections.live}/${connections.limit}, ${connections.refused} refused` : '')
    )
}, 30000).unref?.()
fs.writeFileSync(HEARTBEAT, String(Date.now()))

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => client.destroy(() => process.exit(0)))
}
