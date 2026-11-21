// PEN@ROOT speaks through a small language model that runs in this tab
// (brain.worker.js). It reads the last few chat messages and, now and then,
// answers them. Nothing is trained here, and nothing leaves the device.

import { SPEAKERS, print, say } from './print.js'
import { randomBetween } from './random.js'
import { state } from './state.js'
import { t } from './text.js'
import { delay } from './time.js'

const MEMORY = 32
const memory = []
let worker = null

export function remember(message) {
    memory.push(message)
    while (memory.length > MEMORY) memory.shift()
}

// /call
export const prompt = () => worker?.postMessage({ command: 'generate', messages: [...memory] })

const isMobile = () => /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)

export function load() {
    if (worker || isMobile()) return
    worker = new Worker(new URL('./brain.worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }) => {
        if (data.response) print(SPEAKERS.pen, data.response)
        if (data.status) state.set('brain', data.status)
    }
    worker.onerror = (event) => {
        console.warn('brain:', event.message)
        state.set('brain.load', 'failed')
    }
    // The worker gets its words from here: what PEN is told, and what it
    // says when the model has nothing.
    const text = { system: t('pen.system'), empty: t('pen.empty'), fallback: t('pen.fallback') }
    worker.postMessage({ command: 'load', text })
    say(t('pen.info'))
    speakSometimes()
}

// After a minute of warm-up, PEN speaks on about 3% of 15-45 second ticks.
async function speakSometimes(chance = 0.03) {
    await delay(60000)
    for (;;) {
        await delay(randomBetween(15000, 45000))
        if (Math.random() <= chance) prompt()
    }
}
