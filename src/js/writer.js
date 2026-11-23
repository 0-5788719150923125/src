// PEN@ROOT writes ahead of you. As you type, a small language model in this
// tab (writer.worker.js) guesses how the line goes on, and ghost.js shows the
// guess after the cursor. It reads the room's conversation for context,
// and forgets it when you change rooms. Nothing is trained here, and
// nothing leaves the device.

import { say } from './print.js'
import * as recall from './recall.js'
import { state } from './state.js'
import { t } from './text.js'

// Lines kept for a worker that has yet to start; the worker keeps its own.
const MEMORY = 64
let lines = []
let worker = null
let ready = false
let current = null // the guess being written: { id, onGhost }
let next = 0

export function remember(line) {
    lines = [...lines, line].slice(-MEMORY)
    worker?.postMessage({ command: 'remember', line })
}

export function forget() {
    lines = []
    worker?.postMessage({ command: 'forget' })
}

export const isReady = () => ready

// Resolves once the model can guess, so a line typed while it loaded gets
// its guess then.
let markReady
export const whenReady = new Promise((resolve) => (markReady = resolve))

// Ask for a guess at the rest of `line`. `onGhost` receives { text } for
// each piece as it is written, then { done: true }. Returns the guess's id.
// The room is asked what it remembers first (recall.js); with no one to
// ask, that costs nothing.
export function guess(line, onGhost) {
    const id = ++next
    current = { id, onGhost }
    const context = [...lines.slice(-4), line].join('\n')
    recall.ask(context)
        .catch(() => null)
        .then((memory) => {
            if (current?.id === id) worker.postMessage({ command: 'guess', id, line, memory })
        })
    return id
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

export function load() {
    if (worker) return
    // Shown at once: the worker and its library take a moment to start
    // before they can say how the download is going.
    state.set('writer', { download: '0%' })
    start()
    // Said once the model can guess, not before: until then the ticker
    // shows the download. A touchscreen has no Tab key; there, the ghost is
    // taken by a tap.
    whenReady.then(() => say(matchMedia('(pointer: coarse)').matches ? t('pen.info-touch') : t('pen.info')))
}

function start(threads = 0) {
    worker = new Worker(new URL('./writer.worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }) => {
        if (data.starting && !threads) {
            clearTimeout(watchdog)
            watchdog = setTimeout(() => {
                console.warn('writer: the model did not start; trying again on one thread')
                worker.terminate()
                start(1)
            }, START_LIMIT)
        }
        if (data.ghost && data.ghost.id === current?.id) current.onGhost(data.ghost)
        // The guess has outrun what the room remembered: ask again.
        if (data.more && data.more.id === current?.id) {
            const { id, seq, line } = data.more
            recall
                .ask([...lines.slice(-4), line].join('\n'))
                .catch(() => null)
                .then((memory) => {
                    if (current?.id === id) worker.postMessage({ command: 'memory', id, seq, memory })
                })
        }
        if (data.ready) {
            clearTimeout(watchdog)
            ready = true
            markReady()
        }
        if (data.status) state.set('writer', data.status)
    }
    worker.onerror = (event) => {
        console.warn('writer:', event.message)
        state.set('writer.error', 'failed')
    }
    // The worker gets its words from here: what PEN reads before the
    // conversation.
    worker.postMessage({ command: 'load', text: { preamble: t('pen.preamble'), threads }, lines })
}
