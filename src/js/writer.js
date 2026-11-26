// PEN@ROOT writes ahead of you. As you type, a small language model in this
// tab (writer.worker.js) guesses how the line goes on, and ghost.js shows the
// guess after the cursor. It reads the room's conversation for context,
// and forgets it when you change rooms. Nothing is trained here, and
// nothing leaves the device.

import { say } from './print.js'
import * as recall from './recall.js'
import { state } from './state.js'
import { html, t } from './text.js'

// The models PEN@ROOT can write with (/model), smallest first: ONNX builds
// that transformers.js runs in the browser, all of one family, so they
// share a tokenizer and read the preamble alike. The first is the default.
// `size`: the download, at 8 bits (writer.worker.js). SmolLM2-1.7B-Instruct
// is left out: at 8 bits it took over 5 GB to load in Chromium (measured
// 2026-11-26), past the 4 GB WebAssembly can address.
export const MODELS = [
    { repo: 'HuggingFaceTB/SmolLM2-135M-Instruct', size: '137 MB' },
    { repo: 'HuggingFaceTB/SmolLM2-360M-Instruct', size: '365 MB' }
].map((model) => ({ ...model, name: model.repo.split('/')[1] }))

// The model chosen in this browser, kept in localStorage (which the
// browser extension's background shares with its terminal: host.js). A new
// choice is only tried until its model comes ready: one that never did
// (the tab ran out of memory loading it, or closed first) is dropped as
// the next page starts (dropUntried: the site's, or the extension's
// background), so it cannot fail on every visit.
const CHOSEN = 'model'
const TRYING = 'model-trying'
const stored = (key) =>
    MODELS.find(({ name }) => name === localStorage.getItem(key))
export const chosen = () => stored(TRYING) ?? stored(CHOSEN) ?? MODELS[0]
export const dropUntried = () => localStorage.removeItem(TRYING)
export function keepChosen() {
    const tried = stored(TRYING)
    if (tried) localStorage.setItem(CHOSEN, tried.name)
    localStorage.removeItem(TRYING)
}

// Lines kept for a worker that has yet to start; the worker keeps its own.
const MEMORY = 64
let lines = []
let worker = null
let ready = false
let current = null // the guess being written: { id, onGhost }
let next = 0
let welcome = null // the welcome line, said once the model is first ready
let switched = false // after /model: once ready, say which model writes

export function remember(line) {
    lines = [...lines, line].slice(-MEMORY)
    worker?.postMessage({ command: 'remember', line })
}

export function forget() {
    lines = []
    worker?.postMessage({ command: 'forget' })
}

export const isReady = () => ready

// Each is called whenever the model comes ready to guess: once it has
// loaded, and again after /model, so a line typed meanwhile gets its guess.
const listeners = []
export const onReady = (listener) => listeners.push(listener)

// Ask for a guess at the rest of `line`. `onGhost` receives { text } for
// each piece as it is written, then { done: true }. Returns the guess's id.
// The guess starts at once, with this tab's own memory; what the room
// remembers (recall.js) follows as it arrives.
export function guess(line, onGhost) {
    const id = ++next
    current = { id, onGhost }
    ask(id, 0, line, (memory, done) =>
        worker.postMessage({ command: 'guess', id, line, memory, done })
    )
    return id
}

// Put question `seq` of guess `id` to the room's memory, about how `line`
// goes on after the conversation's last lines. The first word (this tab's
// own memory, at once) goes to `first` if given; the rest, as it comes, to
// the worker.
function ask(id, seq, line, first = null) {
    const send = (memory, done) => {
        if (current?.id !== id) return
        if (first) {
            const start = first
            first = null
            return start(memory, done)
        }
        worker.postMessage({ command: 'memory', id, seq, memory, done })
    }
    try {
        recall.ask([...lines.slice(-4), line].join('\n'), send)
    } catch {
        send(null, true)
    }
}

export function stop() {
    current = null
    worker?.postMessage({ command: 'stop' })
}

// ONNX Runtime's threads sometimes never come up in Firefox (2 starts in
// 20, measured 2026-11-21; never with one thread). A start that takes this
// long after the weights arrive (normally 3-5 s) is taken for hung, and the
// worker is replaced by one on a single thread. The weights are cached by
// then.
const START_LIMIT = 12000
let watchdog = null

// How the worker is made. The browser extension's terminal uses the one its
// background runs for the whole browser instead (extension/terminal.js),
// which speaks the same messages.
let makeWorker = () =>
    new Worker(new URL('./writer.worker.js', import.meta.url), {
        type: 'module'
    })
export const useWorker = (make) => (makeWorker = make)

// `greet`: whether the line is said once the model can guess (the
// browser extension's background says its own, once).
export function load(greet = true) {
    if (worker) return
    // Shown at once: the worker and its library take a moment to start
    // before they can say how the download is going.
    state.set('writer', { download: '0%' })
    start()
    // Said once the model can guess, not before: until then the ticker
    // shows the download. A touchscreen has no Tab key; there, the ghost is
    // taken by a tap.
    const touch = matchMedia('(pointer: coarse)').matches
    if (greet) welcome = touch ? t('pen.info-touch') : t('pen.info')
}

// /model: which model writes, and the others; /model NAME switches to one,
// in this browser, from now on. As the command is typed, the ghost suggests
// the names (modelNames, commands.js).
export function setModel([name]) {
    const now = chosen()
    const usage = () =>
        say(
            html('model.usage', {
                models: MODELS.map((m) => `${m.name} (${m.size})`).join(', ')
            })
        )
    if (!name) {
        say(t('model.using', { model: now.name }))
        return usage()
    }
    const model = MODELS.find(
        (m) => m.name.toLowerCase() === name.toLowerCase()
    )
    if (!model) {
        say(t('model.unknown', { name }))
        return usage()
    }
    if (model === now) return say(t('model.using', { model: now.name }))
    localStorage.setItem(TRYING, model.name)
    say(t('model.loading', { model: model.name, size: model.size }))
    switched = true
    if (!worker) return
    // The worker goes, and the model with it (a worker's memory is given
    // back only when it ends); a new one loads the chosen model and reads
    // the chat again.
    clearTimeout(watchdog)
    worker.terminate()
    ready = false
    current = null
    state.set('writer', { download: '0%' })
    start()
}

// The names /model takes, for the ghost to suggest: the others first, the
// one in use last.
export function modelNames() {
    const now = chosen()
    return [...MODELS.filter((m) => m !== now), now].map((m) => m.name)
}

function start(threads = 0) {
    worker = makeWorker()
    worker.onmessage = ({ data }) => {
        if (data.starting && !threads) {
            clearTimeout(watchdog)
            watchdog = setTimeout(() => {
                console.warn(
                    'writer: the model did not start; trying again on one thread'
                )
                worker.terminate()
                start(1)
            }, START_LIMIT)
        }
        if (data.ghost && data.ghost.id === current?.id)
            current.onGhost(data.ghost)
        // The guess has outrun what the room remembered: ask again.
        if (data.more && data.more.id === current?.id)
            ask(data.more.id, data.more.seq, data.more.line)
        if (data.ready) {
            clearTimeout(watchdog)
            ready = true
            keepChosen()
            if (welcome) say(welcome)
            if (switched) say(t('model.using', { model: chosen().name }))
            welcome = null
            switched = false
            for (const listener of listeners) listener()
        }
        if (data.status) state.set('writer', data.status)
    }
    worker.onerror = (event) => {
        console.warn('writer:', event.message)
        state.set('writer.error', 'failed')
    }
    // The worker gets its words from here: what PEN reads before the
    // conversation.
    worker.postMessage({
        command: 'load',
        text: { preamble: t('pen.preamble'), threads },
        model: chosen(),
        lines
    })
}
