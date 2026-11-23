// The terminal: the command line and its history, the banner, and the
// ticker that prints the state after PEN@ROOT.

import { connect, send } from './chat.js'
import { find } from './commands.js'
import * as ghost from './ghost.js'
import { you } from './identity.js'
import { SPEAKERS, banner, handle, print, say, showPrompt } from './print.js'
import * as radio from './radio.js'
import { sortedKeys, state } from './state.js'
import { load, t } from './text.js'
import * as writer from './writer.js'

const input = document.getElementById('command')

// ------------------------------------------------------------ commands

// Split a line into words, keeping "quoted phrases" whole.
const parse = (line) =>
    line
        .match(/"[^"]+"|[^\s]+/g)
        .map((word) => word.replace(/"(.+)"/, '$1'))
        .filter(Boolean)

// A command if the line names one; otherwise, a message to the room.
export async function run(name, args = [], line = '') {
    const command = find(name)
    if (command) return command.run(args)
    if (name.startsWith('/')) return say(t('terminal.missing', { command: name }))
    return send(line)
}

// Echo the line, then act on it.
async function submit(line) {
    const [word, ...args] = parse(line)
    const name = word.toLowerCase()
    remember(line)
    print(you(), line)
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

// The line is a textarea so that it can wrap, but it stays one line: Enter
// sends, up and down walk the history, and pasted line breaks become spaces.
function onKey(event) {
    if (event.isComposing) return
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        walk(event.key === 'ArrowUp' ? -1 : 1)
    } else if (event.key === 'Enter') {
        event.preventDefault()
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
const [text, echo] = ticker.children
const SPEED = 30 // pixels a second

let loop = 0 // how far the text slides before it repeats; 0 while it fits
let offset = 0
let last = null

// The state, looping when it is wider than the screen: the text is followed
// by a copy of itself, and once the copy has slid to where the text began,
// the slide starts over from there unseen. Widths are read from the text
// itself, which the sliding does not change.
function tick() {
    const json = JSON.stringify(sortedKeys(state.snapshot()))
    if (json !== text.textContent) text.textContent = echo.textContent = json
    const margin = parseFloat(getComputedStyle(ticker).marginLeft) || 0
    const overflow = head.offsetWidth + margin + text.getBoundingClientRect().width - document.body.clientWidth
    ticker.classList.toggle('ticking', overflow > 0)
    loop = overflow > 0 ? echo.getBoundingClientRect().left - text.getBoundingClientRect().left : 0
    if (loop && last === null) {
        last = performance.now()
        requestAnimationFrame(slide)
    }
}

// Moves at a steady speed, measured in pixels rather than as a fraction of
// the loop, so a state that grows or shrinks does not make the text jump.
function slide(now) {
    if (!loop) {
        offset = 0
        last = null
        ticker.style.removeProperty('transform')
        return
    }
    // A hidden tab gets no frames; it picks up where it left off.
    const elapsed = Math.min(Math.max(now - last, 0), 100)
    offset = (offset + (SPEED * elapsed) / 1000) % loop
    last = now
    ticker.style.transform = `translateX(${-offset}px)`
    requestAnimationFrame(slide)
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
    input.addEventListener('input', () => {
        if (!/[\r\n]/.test(input.value)) return
        const at = input.selectionStart
        input.value = input.value.replace(/\r?\n/g, ' ')
        input.setSelectionRange(at, at)
    })
    // Wrapped lines start at the left edge; the first starts after the prompt.
    const prompt = document.getElementById('prompt')
    const indent = () => input.parentElement.style.setProperty('--indent', `${prompt.offsetWidth + 7}px`)
    new ResizeObserver(indent).observe(prompt)
    indent()
    ghost.attach()
    print(null, banner(ATOM, t('banner.title')))
    tick()
    setInterval(tick, 500)
    pinTicker()
    // Stations heard before are seeded again from what this browser holds.
    radio.restore()
    // Into the chat named in the address (?chat=), or the default one,
    // signed in without a word; and the writer's model starts loading at
    // once, its progress in the ticker.
    connect()
    writer.load()
}
