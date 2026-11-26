// Peers that remember a library: a crowd that holds text and answers the
// memory questions browsers ask while their visitors type (memory.js), so
// what it holds sways the ghost text. The text is cut into slices of at
// most PEER_MB million characters, each indexed on its own; each peer
// holds some of them (so no two vote for the same line) and answers from
// all of its slices as one, and joins the chats in PEER_CHATS through the
// trackers. They never chat; they only remember.
//
// Each also answers privately (PEER_PRIVATE, on by default; private.js):
// in a swarm of its own, from a table of its text made for private
// retrieval, so the browser extension can ask about what is typed in other
// sites' fields without the peer learning it. With PEER_KEY it proves a key
// to askers, and the extension, built with that key in SRC_PINNED_KEYS,
// counts such peers above the rest; browsers answer too, so none is needed
// (next/private-memory.md).
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
//   PEERS         how many (8; for git, 1: one connection per visitor,
//                 one answer per server, however much it holds)
//   PEER_MB       millions of characters per slice, at most (2); for git,
//                 as many slices as the text needs, up to 16
//   PEER_REFRESH  for git: hours between refreshes (6; 0: never)
//   PEER_DROP     share of questions left unanswered, to test a flaky chat
//   PEER_DELAY    most ms an answer is held back, at random (0)
//   PEER_PRIVATE  answer private questions too (1; 0: not)
//   PEER_PRIVATE_GROUPS  the private table's size, in groups of 16,384
//                 records of 256 bytes (4 for git, 16 MiB, about 900,000 characters
//                 held well; 1 for test data; an asker downloads 1.3 MB a group, once)
//   PEER_KEY      a secret: the key this peer proves to private askers
//                 (its public key is logged at start, for SRC_PINNED_KEYS);
//                 with several peers, each adds its number
//   TRACKERS      comma-separated trackers to announce to
//   WEBRTC_PORTS  a UDP range, or one port, on a public server (webrtc.js)
//   DATA_DIR      where downloads and clones are kept (./data)

import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import WebTorrent from 'webtorrent'
import { keysFor } from '../../src/js/crypto.js'
import {
    combine,
    index,
    lookup,
    memoryExtension,
    sendMemory
} from '../../src/js/memory.js'
import {
    createAnswerer,
    privateExtension,
    swarmFile
} from '../../src/js/private.js'
import { roomFile } from '../../src/js/room.js'
import { describePorts, webrtc } from './webrtc.js'

// Many clients in one process share sockets; the default warns at ten.
EventEmitter.defaultMaxListeners = 100

const list = (value) =>
    (value || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
const DATA = process.env.PEER_DATA || 'tinystories'
const CHATS = list(process.env.PEER_CHATS || 'memorytest').map((name) =>
    name.toLowerCase()
)
const WEIGHT = Math.min(1, Math.max(0, Number(process.env.PEER_WEIGHT ?? 1)))
const PER_PEER = (Number(process.env.PEER_MB) || 2) * 1e6
const MAX_SLICES = 16
const REFRESH = (Number(process.env.PEER_REFRESH ?? 6) || 0) * 3600000
const HEARTBEAT = process.env.HEARTBEAT || '/tmp/alive'
const TRACKERS = list(process.env.TRACKERS)
const DROP = Number(process.env.PEER_DROP) || 0
const DELAY = Number(process.env.PEER_DELAY) || 0
const DATA_DIR = process.env.DATA_DIR || './data'
const PRIVATE = process.env.PEER_PRIVATE !== '0'
const PRIVATE_GROUPS = Math.max(
    1,
    Number(process.env.PEER_PRIVATE_GROUPS) || (DATA === 'git' ? 4 : 1)
)
const KEY = process.env.PEER_KEY || ''
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
    const body =
        text.split(/\*\*\* ?START OF[^\n]*\n/)[1]?.split(/\*\*\* ?END OF/)[0] ??
        text
    return body
        .split(/\r?\n\s*\r?\n/)
        .map((p) => p.replace(/\s*\r?\n\s*/g, ' ').trim())
        .filter(Boolean)
        .join('\n')
}

const SOURCES = {
    tinystories: {
        urls: [
            'https://huggingface.co/datasets/roneneldan/TinyStories/resolve/main/TinyStoriesV2-GPT4-valid.txt'
        ],
        file: 'tinystories.txt',
        shape: (text) =>
            text
                .split('<|endoftext|>')
                .map((s) => s.trim())
                .filter(Boolean)
                .join('\n')
    },
    quijote: {
        // Gutenberg's own site turns some clients away (503); its mirror
        // does not.
        urls: [
            'https://gutenberg.pglaf.org/2/0/0/2000/2000-0.txt',
            'https://www.gutenberg.org/cache/epub/2000/pg2000.txt'
        ],
        file: 'quijote.txt',
        shape: gutenberg
    }
}

async function library() {
    if (DATA === 'git') {
        const { parseSources, readSources } = await import('./sources.js')
        return plain(
            await readSources(
                parseSources(process.env.PEER_SOURCES),
                path.join(DATA_DIR, 'sources'),
                log
            )
        )
    }
    const source = SOURCES[DATA]
    if (!source) return plain(fs.readFileSync(DATA, 'utf8'))
    const file = path.join(DATA_DIR, source.file)
    if (!fs.existsSync(file)) {
        let body = null
        for (const url of source.urls) {
            log(`downloading ${DATA} from ${url}`)
            const response = await fetch(url).catch((err) => ({
                ok: false,
                status: err.message
            }))
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

// How many peers: PEERS, else one for git (so a visitor connects to a
// server once), and eight test peers, each its own voter.
const PEER_COUNT =
    Number(process.env.PEERS) > 0
        ? Number(process.env.PEERS)
        : DATA === 'git'
          ? 1
          : 8

// How many slices: one per test peer; for git, enough to hold the text.
const sliceCount = (text) =>
    DATA === 'git'
        ? Math.min(
              MAX_SLICES,
              Math.max(PEER_COUNT, Math.ceil(text.length / PER_PEER))
          )
        : PEER_COUNT

// Contiguous slices, cut at line ends. Text past what the slices can hold
// is left out, and said so.
function slices(text) {
    const count = sliceCount(text)
    const size = Math.min(PER_PEER, Math.ceil(text.length / count))
    if (size * count < text.length)
        log(
            `only ${((size * count) / 1e6).toFixed(1)}M of ${(text.length / 1e6).toFixed(1)}M characters fit in ${count} slices (PEERS, PEER_MB)`
        )
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

// The slices each peer holds: every PEER_COUNT-th, from its own number.
const deal = (parts) =>
    Array.from({ length: PEER_COUNT }, (_, n) =>
        parts.filter((_, i) => i % PEER_COUNT === n)
    )

// A peer's slices, each indexed on its own; none: it holds nothing. The
// private table holds them all, as one text, in the background (its hint
// takes a while: about 6 s per group).
function remember(peer, texts) {
    const t = performance.now()
    peer.memories = texts.map((text) => index(text))
    peer.chars = texts.reduce((sum, text) => sum + text.length, 0)
    if (texts.length) {
        log(
            `peer ${peer.n}: ${(peer.chars / 1e6).toFixed(2)}M characters in ${texts.length} slice${texts.length > 1 ? 's' : ''}, indexed in ${Math.round(performance.now() - t)} ms`
        )
    }
    if (!peer.answerer || !texts.length) return
    const p = performance.now()
    peer.answerer
        .load(texts.join('\n'))
        .then(({ version, changes }) =>
            log(
                `peer ${peer.n}: private table version ${version} (${PRIVATE_GROUPS} groups${version > 1 ? `, ${changes} elements changed` : ''}) in ${Math.round(performance.now() - p)} ms`
            )
        )
        .catch((err) =>
            log(`peer ${peer.n}: private table failed: ${err.message || err}`)
        )
}

// What a peer remembers of how `context` goes on: every slice's lookup,
// combined as one answer (combine, in memory.js: the slices whose match is
// near the longest vote, so a line two slices hold counts once), or none.
const recollect = (peer, context) =>
    combine(
        peer.memories.map((memory) => ({ ...lookup(memory, context), w: 1 }))
    )

function startPeer(n, texts, rtcConfig) {
    const peer = {
        n,
        memories: [],
        chars: 0,
        wires: 0,
        asked: 0,
        matched: 0,
        answerer: null
    }
    const secret = KEY && (PEER_COUNT > 1 ? `${KEY}:${n}` : KEY)
    if (PRIVATE)
        peer.answerer = createAnswerer({
            groups: PRIVATE_GROUPS,
            secret: secret || null
        })
    if (secret)
        keysFor(secret).then(({ pub }) =>
            log(`peer ${n}: private key ${pub} (for SRC_PINNED_KEYS)`)
        )
    remember(peer, texts)
    const client = new WebTorrent({
        dht: false,
        lsd: false,
        utp: false,
        natUpnp: false,
        natPmp: false,
        tracker: { rtcConfig }
    })
    client.on('error', (err) => log(`peer ${n}: ${err.message || err}`))
    const Memory = memoryExtension((message, wire) => {
        if (typeof message.q !== 'number' || typeof message.c !== 'string')
            return
        const answer = recollect(peer, message.c) ?? { L: 0, spans: [] }
        peer.asked++
        if (answer.spans.length) peer.matched++
        if (Math.random() < DROP) return
        const send = () =>
            sendMemory(wire, {
                a: message.q,
                L: answer.L,
                s: answer.spans,
                w: WEIGHT
            })
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
    if (peer.answerer) {
        const Private = privateExtension(peer.answerer.handle)
        client
            .seed(swarmFile(), { announce: TRACKERS })
            .on('wire', (wire) => wire.use(Private))
    }
    return peer
}

// On a public server, WebRTC's ports are a range, or one shared port behind
// a VPN (webrtc.js); one for every peer in this process.
const { portRange, rtcConfig, connections } = await webrtc()
log(`webrtc: ${describePorts(portRange, connections)}`)

const beat = () => fs.writeFileSync(HEARTBEAT, String(Date.now()))
let text = await library()
if (!text)
    log(
        DATA === 'git'
            ? 'PEER_SOURCES gave no text; nothing to remember (set it, or check the sources above)'
            : `${DATA} is empty`
    )
const peers = deal(slices(text)).map((held, n) => startPeer(n, held, rtcConfig))
log(
    `${peers.length} peer${peers.length > 1 ? 's' : ''} remember${peers.length > 1 ? '' : 's'} ${DATA} in ${CHATS.map((c) => `"${c}"`).join(', ')} (open ?chat=${CHATS[0]}), counting ${WEIGHT}; trackers: ${TRACKERS.join(', ') || 'none'}`
)
beat()
setInterval(() => {
    beat()
    const total = (key) => peers.reduce((sum, p) => sum + p[key], 0)
    const answered = (key) =>
        peers.reduce((sum, p) => sum + (p.answerer?.stats[key] ?? 0), 0)
    log(
        `connections ${total('wires')}, questions ${total('asked')}, answered with a match ${total('matched')}${PRIVATE ? `; private: hints sent ${answered('hints')}, questions ${answered('questions')}` : ''}`
    )
}, 30000).unref?.()

// The sources change; read them again, and re-index the peers in place.
if (DATA === 'git' && REFRESH) {
    setInterval(async () => {
        const fresh = await library().catch(
            (err) => (log(`refresh failed: ${err.message || err}`), null)
        )
        if (fresh === null || fresh === text) return
        text = fresh
        const parts = slices(text)
        deal(parts).forEach((held, n) => remember(peers[n], held))
        log(
            `refreshed: ${(text.length / 1e6).toFixed(2)}M characters in ${parts.length} slices, ${peers.length} peer${peers.length > 1 ? 's' : ''}`
        )
    }, REFRESH)
}

for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => process.exit(0))
