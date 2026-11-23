// Test peers: a crowd that remembers a biased library, so the swarm memory
// behind the ghost text can be tried in a browser. Each peer holds a slice
// of one data set, joins a chat room through the trackers, and answers the
// memory questions browsers ask while their visitors type (memory.js). They
// never chat; they only remember.
//
//   PEERS      how many (8)
//   PEER_DATA  tinystories (children's stories), quijote (Don Quijote, in
//              Spanish), or a path to any .txt file (tinystories)
//   PEER_ROOM  the room to join (memorytest); open ?chat=<room> to meet them
//   PEER_MB    millions of characters per peer, at most (2)
//   PEER_DROP  share of questions left unanswered, to test a flaky room (0)
//   PEER_DELAY most ms an answer is held back, at random (0)
//   TRACKERS   comma-separated trackers to announce to
//   DATA_DIR   where downloads are kept (./data)
//
// Run with `node main.js --peers` from the repository, or as the stack's
// `peers` service (compose profile `test`).

import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import WebTorrent from 'webtorrent'

// Many clients in one process share sockets; the default warns at ten.
EventEmitter.defaultMaxListeners = 100

const { roomFile } = await import(process.env.ROOM_JS || './room.js')
const { index, lookup, memoryExtension, sendMemory } = await import(process.env.MEMORY_JS || './memory.js')

const list = (value) => (value || '').split(',').map((s) => s.trim()).filter(Boolean)
const PEERS = Math.max(1, Number(process.env.PEERS) || 8)
const DATA = process.env.PEER_DATA || 'tinystories'
const ROOM = (process.env.PEER_ROOM || 'memorytest').toLowerCase()
const PER_PEER = (Number(process.env.PEER_MB) || 2) * 1e6
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

// Contiguous slices, cut at line ends, one per peer.
function slices(text) {
    const size = Math.min(PER_PEER, Math.ceil(text.length / PEERS))
    const out = []
    let at = 0
    while (out.length < PEERS && at < text.length) {
        let end = Math.min(text.length, at + size)
        const cut = text.indexOf('\n', end)
        if (cut >= 0 && cut - end < 2000) end = cut + 1
        out.push(text.slice(at, end))
        at = end
    }
    return out
}

function startPeer(n, text) {
    const t = performance.now()
    const memory = index(text)
    const stats = { n, chars: text.length, wires: 0, asked: 0, matched: 0 }
    const client = new WebTorrent({ dht: false, lsd: false, utp: false, natUpnp: false, natPmp: false })
    client.on('error', (err) => log(`peer ${n}: ${err.message || err}`))
    const torrent = client.seed(roomFile(ROOM), { announce: TRACKERS })
    const Memory = memoryExtension((message, wire) => {
        if (typeof message.q !== 'number' || typeof message.c !== 'string') return
        const answer = lookup(memory, message.c)
        stats.asked++
        if (answer.spans.length) stats.matched++
        if (Math.random() < DROP) return
        const send = () => sendMemory(wire, { a: message.q, L: answer.L, s: answer.spans })
        if (DELAY) setTimeout(send, Math.random() * DELAY)
        else send()
    })
    torrent.on('wire', (wire) => {
        wire.use(Memory)
        stats.wires++
        wire.once('close', () => stats.wires--)
    })
    log(`peer ${n}: ${(text.length / 1e6).toFixed(2)}M characters indexed in ${Math.round(performance.now() - t)} ms`)
    return stats
}

const text = await library()
const peers = slices(text).map((slice, n) => startPeer(n, slice))
log(`${peers.length} peers remember ${DATA} in chat "${ROOM}" (open ?chat=${ROOM}); trackers: ${TRACKERS.join(', ') || 'none'}`)
setInterval(() => {
    const total = (key) => peers.reduce((sum, p) => sum + p[key], 0)
    log(`connections ${total('wires')}, questions ${total('asked')}, answered with a match ${total('matched')}`)
}, 30000).unref?.()
