// The terminal: the command line and its history, the banner, and the
// ticker that prints the state after PEN@ROOT.

import { send } from './chat.js'
import { available, find } from './commands.js'
import { you } from './identity.js'
import { seal } from './offline.js'
import { SPEAKERS, banner, handle, print, say, showPrompt } from './print.js'
import * as radio from './radio.js'
import { bookIsOpen, state } from './state.js'
import { escape, load, t } from './text.js'

const input = document.getElementById('command')

// ------------------------------------------------------------ commands

// Split a line into words, keeping "quoted phrases" whole.
const parse = (line) =>
    line
        .match(/"[^"]+"|[^\s]+/g)
        .map((word) => word.replace(/"(.+)"/, '$1'))
        .filter(Boolean)

// A command if the line names one; otherwise, a message: to the room while
// the book is open, sealed for later while it is not.
export async function run(name, args = [], line = '') {
    const command = find(name)
    if (command && available(command)) return command.run(args)
    if (name.startsWith('/')) return say(t('terminal.missing', { command: name }))
    if (bookIsOpen()) return send(line)
    return seal(line)
}

// Echo the line, then act on it.
async function submit(line) {
    const [word, ...args] = parse(line)
    const name = word.toLowerCase()
    const command = find(name)
    if (command?.secret?.(args)) {
        print(you(), { html: `${escape(word)} <span class="missing">${escape(t('terminal.protected'))}</span>` })
    } else {
        remember(line)
        const echo = print(you(), line)
        if (command?.expires) setTimeout(() => echo.remove(), command.expires * 1000)
    }
    await run(name, args, line)
}

// ------------------------------------------------------------ the line

// Up and down walk back through what was typed. An edited line keeps its
// edit; the line being typed waits at the end.
const history = []
let position = 0
let draft = ''

function remember(line) {
    history.push(line)
    position = history.length
}

function walk(step) {
    if (!history.length) return
    if (history[position] !== undefined) history[position] = input.value
    else draft = input.value
    position = Math.min(Math.max(position + step, 0), history.length)
    input.value = history[position] ?? draft
}

function onKey(event) {
    if (event.isComposing) return
    if (event.key === 'ArrowUp') walk(-1)
    else if (event.key === 'ArrowDown') walk(1)
    else if (event.key === 'Enter') {
        const line = input.value.replace(/[“”]/g, '"')
        if (!line.trim()) return
        input.value = ''
        submit(line)
    }
}

// ------------------------------------------------------------ ticker

const pen = document.getElementById('pen')
const head = document.getElementById('head')
const ticker = document.getElementById('state')

// The state, scrolling when it is wider than the screen. Widths are read
// from the text itself, which the scrolling does not change.
function tick() {
    ticker.textContent = JSON.stringify(state.snapshot())
    const margin = parseFloat(getComputedStyle(ticker).marginLeft) || 0
    const overflow = head.offsetWidth + margin + ticker.offsetWidth - document.body.clientWidth
    ticker.classList.toggle('ticking', overflow > 0)
    if (overflow > 0) ticker.style.setProperty('--marquee-x', `-${overflow + Math.ceil(head.offsetWidth / 3) * 3}px`)
    else ticker.style.removeProperty('--marquee-x')
}

// iOS keyboards push the ticker out of view; the Visual Viewport API puts
// it back.
function pinTicker() {
    const viewport = window.visualViewport
    if (!viewport) return
    const pin = () => (pen.style.top = `${viewport.offsetTop}px`)
    viewport.addEventListener('resize', pin)
    viewport.addEventListener('scroll', pin)
}

// ------------------------------------------------------------ start

const ATOM = `
<div id="atom">
    <div id="nucleus"></div>
    <div class="orbit"><div class="electron"></div></div>
    <div class="orbit"><div class="electron"></div></div>
    <div class="orbit"><div class="electron"></div></div>
</div>`

export async function start() {
    await load()
    head.textContent = handle({ ...SPEAKERS.pen, symbol: '=' })
    showPrompt(you())
    input.addEventListener('keydown', onKey)
    print(null, banner(ATOM, t('banner.title')))
    tick()
    setInterval(tick, 500)
    pinTicker()
    // Stations heard before are seeded again from what this browser holds.
    radio.restore()
    // ?focus=name connects straight into that room.
    if (new URLSearchParams(window.location.search).has('focus')) run('/connect')
}
