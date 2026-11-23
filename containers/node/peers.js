// Peers that remember a library: a crowd that holds text and answers the
// memory questions browsers ask while their visitors type (memory.js), so
// what it holds sways the ghost text. Each peer holds a slice of the text
// (so no two vote for the same line), and joins the chats in PEER_CHATS
// through the trackers. They never chat; they only remember.
//
// Two uses: the stack's `library` service (compose profile `public`), whose
// text is the prose and code of git repositories (PEER_DATA=git,
// PEER_SOURCES; sources.js), refreshed every PEER_REFRESH hours; and test
// peers with a biased library (`node main.js --peers`, or the `peers`
// service, profile `test`).
//
//   PEER_DATA     git, tinystories (children's stories), quijote (Don
//                 Quijote, in Spanish), or a path to a .txt file
//   PEER_SOURCES  for git: the repositories (sources.js)
//   PEER_CHATS    comma-separated chats to answer in (memorytest)
//   PEER_WEIGHT   how much an answer counts, 0 to 1 (1); browsers scale a
//                 match by it, and a person's own counts 1
//   PEERS         how many (8; for git, enough for the text, up to 16)
//   PEER_MB       millions of characters per peer, at most (2)
//   PEER_REFRESH  for git: hours between refreshes (24; 0: never)
//   PEER_DROP     share of questions left unanswered, to test a flaky chat
//   PEER_DELAY    most ms an answer is held back, at random (0)
//   TRACKERS      comma-separated trackers to announce to
//   WEBRTC_PORTS  a UDP range, on a public server (webrtc.js)
//   DATA_DIR      where downloads and clones are kept (./data)

import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import WebTorrent from 'webtorrent'
import { webrtc } from './webrtc.js'

// Many clients in one process share sockets; the default warns at ten.
EventEmitter.defaultMaxListeners = 100

const { roomFile } = await import(process.env.ROOM_JS || './room.js')
const { index, lookup, memoryExtension, sendMemory } = await import(process.env.MEMORY_JS || './memory.js')

const list = (value) => (value || '').split(',').map((s) => s.trim()).filter(Boolean)
const DATA = process.env.PEER_DATA || 'tinystories'
const CHATS = list(process.env.PEER_CHATS || 'memorytest').map((name) => name.toLowerCase())
const WEIGHT = Math.min(1, Math.max(0, Number(process.env.PEER_WEIGHT ?? 1)))
const PER_PEER = (Number(process.env.PEER_MB) || 2) * 1e6
const MAX_PEERS = 16
const REFRESH = (Number(process.env.PEER_REFRESH ?? 24) || 0) * 3600000
const HEARTBEAT = process.env.HEARTBEAT || '/tmp/alive'
const TRACKERS = list(process.env.TRACKERS)
const DROP = Number(process.env.PEER_DROP) || 0
const DELAY = Number(process.env.PEER_DELAY) || 0
const DATA_DIR = process.env.DATA_DIR || './data'
const log = (...args) => console.log(new Date().toISOString(), ...args)

// Only what the chat accepts (room.js isPlain): accents folded, curly quotes
// and dashes made plain, anything else dropped.
const plain = (text) =>
    text
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[‘’]/g, "'")
        .replace(/[“”«»]/g, '"')
        .replace(/[–—]/g, '-')
        .replace(/[^\x20-\x7e\n]|[<>^]/g, '')
        .replace(/[ \t]+/g, ' ')

// Project Gutenberg: the book between its markers, hard-wrapped lines joined
// back into paragraphs.
const gutenberg = (text) => {
    const body = text.split(/\*\*\* ?START OF[^\n]*\n/)[1]?.split(/\*\*\* ?END OF/)[0] ?? text
    return body.split(/\r?\n\s*\r?\n/).map((p) => p.replace(/\s*\r?\n\s*/g, ' ').trim()).filter(Boolean).join('\n')
}

const SOURCES = {
    tinystories: {
        urls: ['https://huggingface.co/datasets/roneneldan/TinyStories/resolve/main/TinyStoriesV2-GPT4-valid.txt'],
        file: 'tinystories.txt',
        shape: (text) => text.split('<|endoftext|>').map((s) => s.trim()).filter(Boolean).join('\n')
    },
    quijote: {
        // Gutenberg's own site turns some clients away (503); its mirror
        // does not.
        urls: ['https://gutenberg.pglaf.org/2/0/0/2000/2000-0.txt', 'https://www.gutenberg.org/cache/epub/2000/pg2000.txt'],
        file: 'quijote.txt',
        shape: gutenberg
    }
}

async function library() {
    if (DATA === 'git') {
        const { parseSources, readSources } = await import('./sources.js')
        return plain(await readSources(parseSources(process.env.PEER_SOURCES), path.join(DATA_DIR, 'sources'), log))
    }
    const source = SOURCES[DATA]
    if (!source) return plain(fs.readFileSync(DATA, 'utf8'))
    const file = path.join(DATA_DIR, source.file)
    if (!fs.existsSync(file)) {
        let body = null
        for (const url of source.urls) {
            log(`downloading ${DATA} from ${url}`)
            const response = await fetch(url).catch((err) => ({ ok: false, status: err.message }))
            if (response.ok) {
                body = await response.text()
                break
            }
            log(`  ${response.status}`)
        }
        if (body === null) throw new Error(`could not download ${DATA}`)
        fs.mkdirSync(DATA_DIR, { recursive: true })
        fs.writeFileSync(file, body)
    }
    return plain(source.shape(fs.readFileSync(file, 'utf8')))
}

// How many peers: PEERS, or for git, enough to hold the text.
const peerCount = (text) =>
    Number(process.env.PEERS) > 0 ? Number(process.env.PEERS) : DATA === 'git' ? Math.min(MAX_PEERS, Math.max(1, Math.ceil(text.length / PER_PEER))) : 8

// Contiguous slices, cut at line ends, one per peer. Text past what the
// peers can hold is left out, and said so.
function slices(text) {
    const count = peerCount(text)
    const size = Math.min(PER_PEER, Math.ceil(text.length / count))
    if (size * count < text.length) log(`only ${((size * count) / 1e6).toFixed(1)}M of ${(text.length / 1e6).toFixed(1)}M characters fit in ${count} peers (PEERS, PEER_MB)`)
    const out = []
    let at = 0
    while (out.length < count && at < text.length) {
        let end = Math.min(text.length, at + size)
        const cut = text.indexOf('\n', end)
        if (cut >= 0 && cut - end < 2000) end = cut + 1
        out.push(text.slice(at, end))
        at = end
    }
    return out
}

// A peer's text, indexed; null holds nothing (a slice gone after a refresh).
function remember(peer, text) {
    const t = performance.now()
    peer.memory = text ? index(text) : null
    peer.chars = text.length
    if (text) log(`peer ${peer.n}: ${(text.length / 1e6).toFixed(2)}M characters indexed in ${Math.round(performance.now() - t)} ms`)
}

function startPeer(n, text, rtcConfig) {
    const peer = { n, memory: null, chars: 0, wires: 0, asked: 0, matched: 0 }
    remember(peer, text)
    const client = new WebTorrent({ dht: false, lsd: false, utp: false, natUpnp: false, natPmp: false, tracker: { rtcConfig } })
    client.on('error', (err) => log(`peer ${n}: ${err.message || err}`))
    const Memory = memoryExtension((message, wire) => {
        if (typeof message.q !== 'number' || typeof message.c !== 'string') return
        const answer = peer.memory ? lookup(peer.memory, message.c) : { L: 0, spans: [] }
        peer.asked++
        if (answer.spans.length) peer.matched++
        if (Math.random() < DROP) return
        const send = () => sendMemory(wire, { a: message.q, L: answer.L, s: answer.spans, w: WEIGHT })
        if (DELAY) setTimeout(send, Math.random() * DELAY)
        else send()
    })
    for (const chat of CHATS) {
        const torrent = client.seed(roomFile(chat), { announce: TRACKERS })
        torrent.on('wire', (wire) => {
            wire.use(Memory)
            peer.wires++
            wire.once('close', () => peer.wires--)
        })
    }
    return peer
}

// On a public server, WebRTC's ports are a range (webrtc.js); one range for
// every peer in this process.
const { rtcConfig } = await webrtc()

const beat = () => fs.writeFileSync(HEARTBEAT, String(Date.now()))
let text = await library()
if (!text) log(DATA === 'git' ? 'PEER_SOURCES gave no text; nothing to remember (set it, or check the sources above)' : `${DATA} is empty`)
const peers = slices(text).map((slice, n) => startPeer(n, slice, rtcConfig))
log(`${peers.length} peers remember ${DATA} in ${CHATS.map((c) => `"${c}"`).join(', ')} (open ?chat=${CHATS[0]}), counting ${WEIGHT}; trackers: ${TRACKERS.join(', ') || 'none'}`)
beat()
setInterval(() => {
    beat()
    const total = (key) => peers.reduce((sum, p) => sum + p[key], 0)
    log(`connections ${total('wires')}, questions ${total('asked')}, answered with a match ${total('matched')}`)
}, 30000).unref?.()

// The sources change; read them again, and re-index the peers in place.
if (DATA === 'git' && REFRESH) {
    setInterval(async () => {
        const fresh = await library().catch((err) => (log(`refresh failed: ${err.message || err}`), null))
        if (fresh === null || fresh === text) return
        text = fresh
        const parts = slices(text)
        parts.forEach((slice, n) => (peers[n] ? remember(peers[n], slice) : peers.push(startPeer(n, slice, rtcConfig))))
        for (const peer of peers.slice(parts.length)) remember(peer, '')
        log(`refreshed: ${(text.length / 1e6).toFixed(2)}M characters in ${parts.length} peers`)
    }, REFRESH)
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0))
