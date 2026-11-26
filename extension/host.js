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
//   swapped; the worker reads the chat's conversation, which runs here.
// - 'screen', the terminal again: the radio and the chat run here too (the
//   site's radio.js and chat.js), so they go on when the popup closes; what
//   they print comes to the terminal, and its /radio, /chat, chat lines and
//   memory questions come here (see the screen, below).
// One guess runs at a time: a new one, from anywhere, stops the last (the
// field being typed in is the one that matters). Nothing typed in a page is
// kept, or sent anywhere readable.

import * as answering from './js/answering.js'
import * as chat from './js/chat.js'
import { forgetEverything } from './js/commands.js'
import { config } from './js/config.js'
import { printElsewhere, say } from './js/print.js'
import { createAsker } from './js/private.js'
import { radio, restore } from './js/radio.js'
import * as recall from './js/recall.js'
import { state } from './js/state.js'
import { load as loadText, t } from './js/text.js'
import { chosen, dropUntried, keepChosen } from './js/writer.js'

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
let running = null // the model the worker holds (writer.js MODELS)
let ready = false
let status = null // the worker's last word on itself, for the terminal's ticker
let current = null // { id, port, theirs, terminal }: the guess being written, by worker id and its asker's own
let conversation = [] // the chat's last lines: a restarted worker gets them back
const LINES = 64
let next = 0
let idle = null
let watchdog = null
// Everything waits on the text, so the worker can be given the chat's
// preamble when it starts; messages keep their order behind it.
const texts = loadText()

function start(threads = 0) {
    ready = false
    running = chosen()
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
            keepChosen()
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
        model: running,
        lines: conversation
    })
}

function stop() {
    clearTimeout(watchdog)
    worker?.terminate()
    worker = null
    ready = false
    status = null
    current = null
    for (const port of pages) port.postMessage({ ready: false })
}

// Let the model go after IDLE without a guess; the next to ask starts it
// again. Another model chosen in a terminal (/model, kept in the
// localStorage this page shares with it) replaces the one running.
function rest() {
    if (worker && running !== chosen()) stop()
    if (!worker) start()
    clearTimeout(idle)
    idle = setTimeout(stop, IDLE)
}

// The toolbar button shows the download, then nothing.
function badge(text) {
    // Firefox's background page has the button (Manifest V2's browserAction).
    const button = api.action ?? api.browserAction
    const failed = (err) => console.warn('host: no badge:', err.message)
    if (button?.setBadgeText) {
        button.setBadgeBackgroundColor?.({ color: '#000000' })
        return Promise.resolve(button.setBadgeText({ text })).catch(failed)
    }
    // An offscreen document has no api.action; the service worker does.
    api.runtime.sendMessage({ type: 'badge', text }).catch(failed)
}

function stopFor(port) {
    if (current?.port !== port) return
    current = null
    worker?.postMessage({ command: 'stop' })
}

// ------------------------------------------------------------ pages

// The swarm's memory, asked privately, and answered from what the
// terminal kept of the chat. Cautious: continuations with numbers, links
// or addresses only where two peers agree.
let asker = null
let answerer = null

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
    // The conversation is the chat's, kept here: a terminal's own is not.
    // Ready is said in answer, once the model it chose is.
    if (command === 'load') {
        rest()
        if (ready) port.postMessage({ ready: true })
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

// ------------------------------------------------------------ the screen

// The radio and the chat run here, so they go on when the popup closes;
// terminals reach them on 'screen' ports. A terminal sends { command:
// 'radio' }, { command: 'send', line } (a chat line), { command: 'chat',
// name } (/chat), and { command: 'ask', id, context } (the chat's memory,
// for its ghost); it hears { print: { speaker, body, options } } and
// { clear } as the radio and the chat print, { memory: { id, memory, done } },
// and the ticker's part kept here ({ state }). What is printed while no
// terminal is open (the next song, the chat) waits for the next one. Both
// start with this page (see start, below), and stay: the stations shared
// and the chat joined, as an open tab of the site does.
const screens = new Set()
const MISSED = 200
const CHAT = 'chat' // localStorage: the chat this background was in
let missed = []
let shown = null
let kept = null // the chat as last saved

const toScreens = (message) => {
    if (!screens.size) missed = [...missed, message].slice(-MISSED)
    for (const port of screens) port.postMessage(message)
}

printElsewhere({
    print: (speaker, body, options) =>
        toScreens({ print: { speaker, body, options } }),
    clear: () => {
        if (!screens.size) missed = []
        toScreens({ clear: true })
    }
})

// The conversation the model reads for the terminal's guesses is the
// chat's.
chat.useConversation({
    remember(line) {
        conversation = [...conversation, line].slice(-LINES)
        worker?.postMessage({ command: 'remember', line })
    },
    forget() {
        conversation = []
        worker?.postMessage({ command: 'forget' })
    }
})

// The ticker's part kept here, and the private memory's peers.
const ticker = () => {
    const { radio = null, seeding = null, daemon = null } = state.snapshot()
    const { chat: room = null, memory = null } = state.snapshot()
    const asking = asker?.status()
    const served = answerer?.status()
    return {
        chat: room,
        daemon,
        memory,
        radio,
        seeding,
        private: asking
            ? {
                  peers: asking.peers,
                  ready: asking.ready,
                  pinned: asking.trusted,
                  asked: asking.asked,
                  answered: asking.answered,
                  dropped: asking.dropped,
                  ...(served ? { serving: served.chars } : {})
              }
            : null
    }
}

function showTicker() {
    const now = JSON.stringify(ticker())
    const room = state.get('chat')
    if (room && room !== kept) localStorage.setItem(CHAT, (kept = room))
    if (now === shown) return
    shown = now
    for (const port of screens) port.postMessage({ state: ticker() })
}

function onScreenOpen(port) {
    for (const message of missed) port.postMessage(message)
    missed = []
    port.postMessage({ state: ticker() })
}

function onScreen(port, { command, line, name, id, context } = {}) {
    if (command === 'radio') radio()
    else if (command === 'send' && typeof line === 'string') chat.send(line)
    else if (command === 'chat')
        chat.setChat([typeof name === 'string' ? name : ''])
    else if (command === 'ask' && typeof context === 'string')
        recall.ask(context, (memory, done) =>
            port.postMessage({ memory: { id, memory, done } })
        )
}

// ------------------------------------------------------------ start

// Everything starts with this page, with the browser or as the extension
// is installed (in Chrome, background.js opens it then), not with the
// popup: the chat receives, the stations are shared, the private memory
// asks and answers, and the model comes up (it is let go after IDLE
// without a guess); the welcome line and whatever is said wait for the
// first terminal.
texts.then(async () => {
    // After /reset (terminal.js), everything is forgotten before anything
    // starts: storage, songs, the model's weights.
    if (localStorage.getItem('reset')) await forgetEverything()
    // A model chosen last time that never came ready is not tried again.
    dropUntried()
    // The welcome line first, at the top of the terminal's history.
    say(t('ghost.info'))
    // Back in the chat it was in (chat.js reads it from the address).
    kept = localStorage.getItem(CHAT)
    if (kept)
        history.replaceState(null, '', `?chat=${encodeURIComponent(kept)}`)
    chat.connect()
    restore()
    asker = createAsker({ pinned: config.pinned ?? [], cautious: true })
    answerer = answering.answerer()
    answering.join({ asker, answerer })
    rest()
    setInterval(showTicker, 500)
})

// ------------------------------------------------------------ ports

const KINDS = {
    pen: { ports: pages, handle: onPage },
    terminal: { ports: terminals, handle: onTerminal },
    screen: { ports: screens, handle: onScreen }
}

api.runtime.onConnect.addListener((port) => {
    const kind = KINDS[port.name]
    if (!kind) return
    texts.then(() => {
        kind.ports.add(port)
        if (kind.ports === screens) return onScreenOpen(port)
        rest()
        if (kind.ports === pages && ready) port.postMessage({ ready: true })
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
    // /reset: Firefox's background page reloads itself (Chrome ignores
    // this in an offscreen document, which background.js reopens instead).
    if (message?.type === 'restart') location.reload()
})
