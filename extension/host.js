// The extension's one model, shared by every tab and by its own terminal:
// the site's writer worker (src/js/writer.worker.js), run here once for the
// whole browser, so each page's ghost text (page.js) only draws and asks,
// and the terminal's ghost is ready when the popup opens. A model per tab
// would be unusable (137 MB and up to 4 threads each).
//
// In Chrome this page is an offscreen document, which background.js opens
// the first time something asks, since Chrome's service worker can run no
// Worker. In Firefox it is the background page itself, which can. Either
// way it loads the model when the first page or terminal connects, and
// lets it go after IDLE without a guess (the weights stay cached, so the
// next start takes seconds).
//
// Two kinds of port:
// - 'pen', a page: it sends { guess: { id, line, title, site } } (line:
//   what is typed before the caret) and { stop }; it hears { ready }, then
//   { ghost: { id, text } } as the guess is written, and { ghost: { id,
//   done } }. Its guesses read the page's title and host before the text
//   (ghost.preamble), and never the chat or its memory: a question to the
//   chat would show it what is typed elsewhere. They ask the swarm's
//   memory privately instead (private.js, answering.js): an encrypted query
//   that the answering peers cannot read; they learn only that a question
//   came, and when. Any peer can answer: the library servers (counted
//   fully when the build pins their keys) and browsers, this one too (from
//   what its terminal kept of the chat), so nothing hangs on a server. One
//   query per word, fetched as the word starts ({ prefetch: { line } }) and
//   answering every guess within it; never a follow-up, so how often the
//   host asks does not depend on what came back.
// - 'terminal', the extension's terminal (terminal.js): it speaks the
//   worker's own messages (src/js/writer.js), passed on with guess ids
//   swapped; the chat's lines it sends become the conversation the worker
//   reads for its guesses.
// One guess runs at a time: a new one, from anywhere, stops the last (the
// field being typed in is the one that matters). Nothing typed in a page is
// kept, or sent anywhere readable.
//
// The radio plays here too (the site's radio.js), so it goes on when the
// popup closes; terminals reach it on a third kind of port, 'radio' (see
// the radio, below).

import * as answering from './js/answering.js'
import { config } from './js/config.js'
import * as library from './js/library.js'
import { printElsewhere } from './js/print.js'
import { createAsker } from './js/private.js'
import { radio, restore } from './js/radio.js'
import { state } from './js/state.js'
import { load as loadText, t } from './js/text.js'

const api = globalThis.browser ?? globalThis.chrome
const IDLE = 30 * 60 * 1000 // ms without a guess before the model is let go
const PAGE_TEXT = 4000 // characters of a page's text before the caret, at most
// A start that takes this long after the weights arrive is taken for hung
// (ONNX Runtime's threads sometimes never come up in Firefox; see
// src/js/writer.js), and the worker is replaced by one on a single thread.
const START_LIMIT = 12000

const pages = new Set()
const terminals = new Set()
let worker = null
let ready = false
let status = null // the worker's last word on itself, for the terminal's ticker
let current = null // { id, port, theirs, terminal }: the guess being written, by worker id and its asker's own
let conversation = [] // the chat's last lines, from the terminal: a restarted worker gets them back
const LINES = 64
let next = 0
let idle = null
let watchdog = null
// Everything waits on the text, so the worker can be given the chat's
// preamble when it starts; messages keep their order behind it.
const texts = loadText()

function start(threads = 0) {
    ready = false
    worker = new Worker(new URL('./js/writer.worker.js', import.meta.url), {
        type: 'module'
    })
    worker.onmessage = ({ data }) => {
        if (data.starting && !threads) {
            clearTimeout(watchdog)
            watchdog = setTimeout(() => {
                console.warn(
                    'host: the model did not start; trying again on one thread'
                )
                worker.terminate()
                start(1)
            }, START_LIMIT)
        }
        if (data.ghost && data.ghost.id === current?.id) {
            current.port.postMessage({
                ghost: { ...data.ghost, id: current.theirs }
            })
            if (data.ghost.done) current = null
        }
        // The worker asks the chat's memory as it writes: the terminal's
        // chat answers; pages have none.
        if (data.more && data.more.id === current?.id) {
            if (current.terminal)
                current.port.postMessage({
                    more: { ...data.more, id: current.theirs }
                })
            else
                worker.postMessage({
                    command: 'memory',
                    id: data.more.id,
                    seq: data.more.seq,
                    memory: null,
                    done: true
                })
        }
        if (data.ready) {
            clearTimeout(watchdog)
            ready = true
            badge('')
            if (current?.waiting)
                worker.postMessage({ ...current.waiting, id: current.id })
            for (const port of [...pages, ...terminals])
                port.postMessage({ ready: true })
        }
        if (data.status) {
            status = data.status
            for (const port of terminals) port.postMessage({ status })
            if (data.status.download)
                badge(
                    data.status.download === '0%' ? '...' : data.status.download
                )
            if (data.status.error) badge('!')
        }
    }
    worker.onerror = (event) => {
        console.warn('host:', event.message)
        badge('!')
    }
    // The chat's preamble: what the terminal's guesses read before the
    // conversation. A page's guesses bring their own.
    worker.postMessage({
        command: 'load',
        text: { preamble: t('pen.preamble'), threads },
        lines: conversation
    })
}

function stop() {
    clearTimeout(watchdog)
    worker?.terminate()
    worker = null
    ready = false
    current = null
    for (const port of pages) port.postMessage({ ready: false })
}

// Let the model go after IDLE without a guess; the next to ask starts it
// again.
function rest() {
    if (!worker) start()
    clearTimeout(idle)
    idle = setTimeout(stop, IDLE)
}

// The toolbar button shows the download, then nothing.
function badge(text) {
    // Firefox's background page has the button (Manifest V2's browserAction).
    const button = api.action ?? api.browserAction
    if (button?.setBadgeText) {
        button.setBadgeBackgroundColor?.({ color: '#000000' })
        return Promise.resolve(button.setBadgeText({ text })).catch(() => {})
    }
    // An offscreen document has no api.action; the service worker does.
    api.runtime.sendMessage({ type: 'badge', text }).catch(() => {})
}

function stopFor(port) {
    if (current?.port !== port) return
    current = null
    worker?.postMessage({ command: 'stop' })
}

// ------------------------------------------------------------ pages

// The swarm's memory, asked privately, and answered from what the
// terminal kept of the chat: joined when a page or terminal first
// connects. Cautious: continuations with numbers, links or addresses only
// where two peers agree.
let asker = null
let answerer = null

function joinMemory() {
    if (asker) return
    asker = createAsker({ pinned: config.pinned ?? [], cautious: true })
    answerer = answering.answerer()
    answering.join({ asker, answerer })
}

// The terminal keeps chat lines in this origin's storage; this page hears
// of them as they are written.
addEventListener('storage', (event) => {
    if (event.key === 'library') library.reload()
})

function pageGuess(port, { id, line, title, site }) {
    if (typeof line !== 'string' || !line.trim()) return
    rest()
    if (!ready) return
    const preface = `${t('ghost.preamble', { title: String(title || '').slice(0, 200), site: String(site || '') })}\n\n`
    const guessed = (current = {
        id: ++next,
        port,
        theirs: id,
        terminal: false
    })
    const asking = Boolean(asker?.ready())
    const text = line.slice(-PAGE_TEXT)
    worker.postMessage({
        command: 'guess',
        id: guessed.id,
        line: text,
        memory: null,
        done: !asking,
        preface
    })
    if (!asking) return
    asker.ask(text, (memory, done) => {
        if (current === guessed)
            worker.postMessage({
                command: 'memory',
                id: guessed.id,
                seq: 0,
                memory,
                done
            })
    })
}

function onPage(port, message) {
    if (message?.guess) pageGuess(port, message.guess)
    else if (message?.stop) stopFor(port)
    else if (typeof message?.prefetch?.line === 'string' && asker?.ready())
        asker.prefetch(message.prefetch.line.slice(-PAGE_TEXT))
}

// ------------------------------------------------------------ terminals

function onTerminal(port, message) {
    const command = message?.command
    if (command === 'load') {
        // A terminal that opens starts its conversation afresh.
        conversation = (message.lines ?? [])
            .filter((line) => typeof line === 'string')
            .slice(-LINES)
        // A worker started now reads it as it loads; a running one is told.
        if (worker) {
            worker.postMessage({ command: 'forget' })
            for (const line of conversation)
                worker.postMessage({ command: 'remember', line })
        }
        rest()
    } else if (command === 'remember' && typeof message.line === 'string') {
        conversation = [...conversation, message.line].slice(-LINES)
        worker?.postMessage(message)
    } else if (command === 'forget') {
        conversation = []
        worker?.postMessage(message)
    } else if (command === 'guess') {
        rest()
        // Asked while the model (re)starts: sent once it is ready.
        current = {
            id: ++next,
            port,
            theirs: message.id,
            terminal: true,
            waiting: ready ? null : message
        }
        if (ready) worker.postMessage({ ...message, id: current.id })
    } else if (command === 'memory') {
        if (current?.port === port && current.theirs === message.id)
            worker.postMessage({ ...message, id: current.id })
    } else if (command === 'stop') {
        stopFor(port)
    }
}

// ------------------------------------------------------------ the radio

// A terminal's /radio comes here ({ command: 'radio' }), and what the radio
// says goes to every open terminal ({ print: { speaker, body, options } }),
// with its part of the ticker ({ state: { radio, seeding } }). What it
// says while no terminal is open (the next song) waits for the next one.
// The stations are joined, and their songs shared, as on the site, once a
// terminal first opens, and from then on while the background runs.
const radios = new Set()
const MISSED = 20
let missed = []
let tuned = false
let shown = null

printElsewhere((speaker, body, options) => {
    const line = { speaker, body, options }
    if (!radios.size) missed = [...missed, line].slice(-MISSED)
    for (const port of radios) port.postMessage({ print: line })
})

// With the private memory's peers: how many, how many it can ask.
const ticker = () => {
    const { radio = null, seeding = null } = state.snapshot()
    const memory = asker?.status()
    const served = answerer?.status()
    return {
        radio,
        seeding,
        private: memory
            ? {
                  peers: memory.peers,
                  ready: memory.ready,
                  pinned: memory.trusted,
                  asked: memory.asked,
                  answered: memory.answered,
                  dropped: memory.dropped,
                  ...(served ? { serving: served.chars } : {})
              }
            : null
    }
}

function showTicker() {
    const now = JSON.stringify(ticker())
    if (now === shown) return
    shown = now
    for (const port of radios) port.postMessage({ state: ticker() })
}

function onRadioOpen(port) {
    if (!tuned) {
        tuned = true
        restore()
        setInterval(showTicker, 1000)
    }
    for (const line of missed) port.postMessage({ print: line })
    missed = []
    port.postMessage({ state: ticker() })
}

// ------------------------------------------------------------ ports

const KINDS = {
    pen: { ports: pages, handle: onPage },
    terminal: { ports: terminals, handle: onTerminal },
    radio: {
        ports: radios,
        handle: (port, message) => message?.command === 'radio' && radio()
    }
}

api.runtime.onConnect.addListener((port) => {
    const kind = KINDS[port.name]
    if (!kind) return
    texts.then(() => {
        kind.ports.add(port)
        joinMemory()
        if (kind.ports === radios) return onRadioOpen(port)
        rest()
        if (ready) port.postMessage({ ready: true })
        if (kind.ports === terminals && status) port.postMessage({ status })
    })
    port.onMessage.addListener((message) =>
        texts.then(() => kind.handle(port, message))
    )
    port.onDisconnect.addListener(() => {
        kind.ports.delete(port)
        stopFor(port)
    })
})

// Pages and terminals ask whether the host is up before they connect (in
// Chrome, the service worker opens it first; in Firefox, this page answers
// itself).
api.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type === 'host') reply(true)
})
