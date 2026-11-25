// The stack's peer: an always-on member of the swarm, so nothing depends on
// a browser tab staying open.
//
// - Every folder under RADIO_DIR is a station. It is seeded as one torrent
//   named after the folder (its frequency), and its .torrent file is written
//   to TORRENTS_DIR, where the web seed serves it to browsers.
// - A station whose folder holds no files here (a server it was never
//   copied to) is fetched instead: its .torrent from the deployed site
//   (SITE_URL), so this seeds exactly what browsers ask for, and its songs
//   from the swarm and the radio's mirror (MIRROR_URL, a web seed from the
//   start: a server fetches once), into CACHE_DIR, where they stay. Every
//   piece is seeded as it arrives. Once the station is whole, its .torrent
//   goes to TORRENTS_DIR, and the web seed serves the cached files too. A
//   restart checks what the cache holds and fetches only the rest. The site
//   is asked again every STATION_REFRESH hours; a new version is fetched
//   into the same place (pieces it shares with the old one stay), and the
//   files it dropped are deleted once it is whole.
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
import parseTorrent, { toTorrentFile } from 'parse-torrent'
import { describePorts, webrtc } from './webrtc.js'

const RADIO_DIR = process.env.RADIO_DIR || '/radio'
const TORRENTS_DIR = process.env.TORRENTS_DIR || '/torrents'
const CACHE_DIR = process.env.CACHE_DIR || '/cache'
const HEARTBEAT = process.env.HEARTBEAT || '/tmp/alive'
const list = (value) => (value || '').split(',').map((s) => s.trim()).filter(Boolean)
const ANNOUNCE = list(process.env.ANNOUNCE)
const TRACKERS = [...list(process.env.TRACKERS), ...ANNOUNCE]
const CHATS = list(process.env.CHATS ?? 'trade')
const SITE_URL = (process.env.SITE_URL || '').trim().replace(/\/+$/, '')
const MIRROR_URL = (process.env.MIRROR_URL || '').trim().replace(/\/+$/, '')
const REFRESH = (Number(process.env.STATION_REFRESH) || 6) * 3600000
const RETRY = 10 * 60000

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
    `webrtc: ${describePorts(portRange, connections)}; ` +
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

// Files the build would put in a station (it leaves out hidden ones).
const hasFiles = (dir) =>
    fs
        .readdirSync(dir, { withFileTypes: true })
        .some((entry) => !entry.name.startsWith('.') && (entry.isFile() || (entry.isDirectory() && hasFiles(path.join(dir, entry.name)))))

// The station's .torrent as the deployed site bundles it. Pages answers a
// missing file with the home page, so what comes back must parse.
async function siteTorrent(frequency) {
    const url = `${SITE_URL}/radio/${encodeURIComponent(frequency)}.torrent`
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) }).catch((err) => {
        throw new Error(`${url}: ${err.cause?.code || err.cause?.message || err.message}`)
    })
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const parsed = await parseTorrent(buf).catch(() => null)
    if (!parsed?.files?.length) throw new Error(`${url}: not a station's .torrent`)
    if (parsed.name !== frequency) throw new Error(`${url}: the torrent is named ${parsed.name}, not ${frequency}`)
    return { buf, parsed }
}

// The version this server last had whole, if any: its .torrent, kept in
// TORRENTS_DIR.
async function keptTorrent(frequency) {
    const file = path.join(TORRENTS_DIR, `${frequency}.torrent`)
    if (!fs.existsSync(file)) return null
    const buf = fs.readFileSync(file)
    return { buf, parsed: await parseTorrent(buf) }
}

// Fetch (or keep) a version of a station; `current` is the one this
// process holds, if any.
async function fetchStation(frequency, current, { buf, parsed }) {
    if (current && !current.destroyed && current.infoHash === parsed.infoHash) return current
    if (current && !current.destroyed) {
        log(`station ${frequency}: the site has a new version`)
        await new Promise((resolve) => client.remove(current, { destroyStore: false }, resolve).catch(resolve))
    }
    const published = path.join(TORRENTS_DIR, `${frequency}.torrent`)
    fs.rmSync(published, { force: true })
    const urlList = MIRROR_URL ? [`${MIRROR_URL}/${parsed.infoHash}/`] : []
    log(`station ${frequency}: fetching ${parsed.infoHash} from the swarm${MIRROR_URL ? ` and ${MIRROR_URL}` : ''} into ${CACHE_DIR}`)
    const torrent = client.add(buf, { path: CACHE_DIR, announce: TRACKERS, urlList })
    torrent.once('done', () => {
        fs.writeFileSync(published, buf)
        prune(frequency, torrent)
        log(`station ${frequency}: whole, seeding ${torrent.files.length} files as ${torrent.infoHash}`)
    })
    // Ready once what the cache already holds is checked.
    await new Promise((resolve, reject) => {
        torrent.once('ready', resolve)
        torrent.once('error', reject)
    })
    return torrent
}

// Delete what the cache holds of a station that its torrent does not have.
function prune(frequency, torrent) {
    const dir = path.join(CACHE_DIR, frequency)
    const keep = new Set(torrent.files.map((file) => path.join(CACHE_DIR, file.path)))
    for (const name of fs.readdirSync(dir, { recursive: true })) {
        const file = path.join(dir, name)
        if (keep.has(file) || !fs.statSync(file).isFile()) continue
        fs.rmSync(file)
        log(`station ${frequency}: deleted ${name}, which the station no longer has`)
    }
}

// Fetch a station now, then look for a new version every STATION_REFRESH
// hours (after a failure, every 10 minutes). While the site cannot be
// read, the version kept here is seeded, so a restart never waits on it.
function keepFetched(frequency) {
    const tick = async () => {
        let wait = REFRESH
        try {
            stations.set(frequency, await fetchStation(frequency, stations.get(frequency), await siteTorrent(frequency)))
        } catch (err) {
            log(`station ${frequency}: ${err.message || err}; trying again in ${RETRY / 60000} minutes`)
            wait = RETRY
            const kept = !stations.has(frequency) && (await keptTorrent(frequency).catch(() => null))
            if (kept) {
                log(`station ${frequency}: meanwhile, seeding the version kept here`)
                await fetchStation(frequency, null, kept).then(
                    (torrent) => stations.set(frequency, torrent),
                    (err) => log(`station ${frequency}: ${err.message || err}`)
                )
            }
        }
        setTimeout(tick, wait)
    }
    tick()
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

// One folder per station (compose.yaml mounts one per frequency, empty when
// its STATION_ variable is unset).
const folders = fs.existsSync(RADIO_DIR)
    ? fs.readdirSync(RADIO_DIR).filter((name) => fs.statSync(path.join(RADIO_DIR, name)).isDirectory())
    : []
if (!folders.length) log(`no stations under ${RADIO_DIR}`)
fs.mkdirSync(TORRENTS_DIR, { recursive: true })

const rooms = await Promise.all(CHATS.map(joinRoom))
const stations = new Map() // frequency -> torrent
for (const frequency of folders) {
    const folder = path.join(RADIO_DIR, frequency)
    if (!hasFiles(folder)) {
        if (SITE_URL) keepFetched(frequency)
        else log(`station ${frequency}: no files in ${folder}, and no SITE_URL to fetch them from`)
        continue
    }
    try {
        stations.set(frequency, await seedStation(frequency))
    } catch (err) {
        log(`station ${frequency}: ${err.message || err}`)
    }
}

// A heartbeat for the container's health check, and a line of numbers.
setInterval(() => {
    fs.writeFileSync(HEARTBEAT, String(Date.now()))
    const peers = (torrents) =>
        torrents.map((t) => (t.done || t.destroyed ? t.numPeers : `${t.numPeers} (${Math.floor(t.progress * 100)}%)`)).join('/')
    log(
        `peers: chats ${peers(rooms) || '-'}, stations ${peers([...stations.values()]) || '-'}; ` +
            `uploaded ${(client.torrents.reduce((n, t) => n + t.uploaded, 0) / 1048576).toFixed(1)} MiB` +
            (portRange ? `; webrtc ${connections.live}/${connections.limit}, ${connections.refused} refused` : '')
    )
}, 30000).unref?.()
fs.writeFileSync(HEARTBEAT, String(Date.now()))

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => client.destroy(() => process.exit(0)))
}
