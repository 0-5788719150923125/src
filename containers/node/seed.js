// The stack's peer: an always-on member of the swarm, so nothing depends on
// a browser tab staying open.
//
// - Every folder under RADIO_DIR is a station. It is seeded as one torrent
//   named after the folder (its frequency), and its .torrent file is written
//   to TORRENTS_DIR, where the web seed serves it to browsers.
// - It sits in every chat room listed in ROOMS and relays messages like any
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

const RADIO_DIR = process.env.RADIO_DIR || '/radio'
const TORRENTS_DIR = process.env.TORRENTS_DIR || '/torrents'
const HEARTBEAT = process.env.HEARTBEAT || '/tmp/alive'
const list = (value) => (value || '').split(',').map((s) => s.trim()).filter(Boolean)
const ANNOUNCE = list(process.env.ANNOUNCE)
const TRACKERS = [...list(process.env.TRACKERS), ...ANNOUNCE]
const ROOMS = list(process.env.ROOMS ?? 'trade')

// room.js is shared with the browser (src/js/room.js), so both derive the
// same room torrents. The image copies it next to this file.
const { chatExtension, createGossip, relay, roomFile } = await import(process.env.ROOM_JS || './room.js')

const log = (...args) => console.log(new Date().toISOString(), ...args)

const client = new WebTorrent({ dht: false, lsd: false, utp: false, natUpnp: false, natPmp: false })
client.on('error', (err) => log('error:', err.message || err))

const seed = (input, opts) =>
    new Promise((resolve, reject) => {
        const torrent = client.seed(input, opts, resolve)
        torrent.once('error', reject)
    })

async function seedStation(frequency) {
    const folder = path.join(RADIO_DIR, frequency)
    log(`station ${frequency}: hashing ${folder}`)
    const torrent = await seed(folder, { name: frequency, announce: TRACKERS })
    const file = toTorrentFile({ ...torrent, announce: ANNOUNCE, urlList: [] })
    fs.writeFileSync(path.join(TORRENTS_DIR, `${frequency}.torrent`), file)
    log(`station ${frequency}: seeding ${torrent.files.length} files as ${torrent.infoHash}`)
    return torrent
}

async function joinRoom(focus) {
    const gossip = createGossip()
    const torrent = await seed(roomFile(focus), { announce: TRACKERS })
    const Chat = chatExtension((payload, from) => {
        if (gossip.fresh(payload.id)) relay(payload, from, torrent.wires)
    })
    torrent.on('wire', (wire) => wire.use(Chat))
    log(`room ${focus}: relaying as ${torrent.infoHash}`)
    return torrent
}

const stations = fs.existsSync(RADIO_DIR)
    ? fs.readdirSync(RADIO_DIR).filter((name) => fs.statSync(path.join(RADIO_DIR, name)).isDirectory())
    : []
if (!stations.length) log(`no stations under ${RADIO_DIR}`)
fs.mkdirSync(TORRENTS_DIR, { recursive: true })

const rooms = await Promise.all(ROOMS.map(joinRoom))
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
        `peers: rooms ${peers(rooms) || '-'}, stations ${peers(radio) || '-'}; ` +
            `uploaded ${(client.torrents.reduce((n, t) => n + t.uploaded, 0) / 1048576).toFixed(1)} MiB`
    )
}, 30000).unref?.()
fs.writeFileSync(HEARTBEAT, String(Date.now()))

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => client.destroy(() => process.exit(0)))
}
