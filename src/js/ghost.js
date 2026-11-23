// Ghost text: a guess at the rest of the line, drawn after the cursor. It
// is not part of the line: it cannot be selected and does not move the
// cursor. Tab takes it a word at a time, as if typed; held, it takes words
// quickly until released, a whole sentence in a moment. Tab never moves the
// focus. On a touchscreen, which has no Tab, a tap on the ghost keeps it up
// to the end of the word tapped. Escape dismisses the ghost. Typing what it
// shows keeps it; typing
// anything else stops it at once, and a new guess comes once the typing
// pauses. Commands get no guesses.

import * as writer from './writer.js'
import { ahead } from './predict.js'

const PAUSE = 150 // ms of quiet before a guess
// A guess that has shown nothing and not finished after this long is taken
// for lost (a worker restarted, a message dropped) and asked again, up to
// RETRIES times for the same line.
const STUCK = 5000
const RETRIES = 2
const input = document.getElementById('command')
const view = document.getElementById('ghost')
const typed = document.getElementById('typed')

let current = null // { id, base, written, done }: the line it guessed from, and the guess so far
let line = '' // the line as last seen
let timer = null
let watchdog = null
let retries = 0 // for the line as it stands

const wanted = (text) => text.trim() !== '' && !text.trimStart().startsWith('/')
const atEnd = () =>
    document.activeElement === input &&
    input.selectionStart === input.value.length &&
    input.selectionEnd === input.value.length
const shown = () => (current ? ahead(current, input.value) : null)

function ask() {
    const base = input.value
    if (!wanted(base) || !writer.isReady()) return
    const id = writer.guess(base, (ghost) => {
        if (current?.id !== id) return
        clearTimeout(watchdog)
        if (ghost.text) current.written += ghost.text
        if (ghost.done) current.done = true
        // Taken whole before it finished: guess on from the end. (A guess
        // that wrote nothing ends there.)
        if (current.done && current.written && shown() === '') changed(true)
        draw()
    })
    current = { id, base, written: '', done: false }
    clearTimeout(watchdog)
    watchdog = setTimeout(() => {
        if (current?.id !== id || current.written || current.done || retries >= RETRIES) return
        retries++
        drop()
        ask()
    }, STUCK)
}

function drop() {
    if (current) writer.stop()
    current = null
    clearTimeout(timer)
    clearTimeout(watchdog)
}

// Called whenever the line may have changed.
function changed(again = false) {
    if (input.value === line && !again) return draw()
    if (input.value !== line) retries = 0
    line = input.value
    const rest = shown()
    if (rest === null) drop()
    // Guess anew once the typing pauses, unless the guess still has
    // something to show or is still being written.
    if (!current || (rest === '' && current.done)) {
        drop()
        timer = setTimeout(ask, PAUSE)
    }
    draw()
}

// The mirror behind the line (style.css) holds the typed text, unseen, and
// the ghost after it, so the ghost starts where the text ends and wraps with
// it. The mirror also sizes the line, so it is kept up to date on every
// change, ghost or not.
function draw() {
    typed.textContent = input.value
    const rest = shown()
    view.textContent = rest && atEnd() ? rest : ''
}

// Take the ghost's next word (its leading space and any punctuation stuck to
// it) as if typed. The guess goes on writing behind it.
function takeWord() {
    const rest = shown()
    if (!rest || !atEnd()) return
    input.value += /^\s*\S+/.exec(rest)?.[0] ?? rest
    input.setSelectionRange(input.value.length, input.value.length)
    changed()
}

// Held, Tab takes a word every TAKE_EVERY ms once HOLD ms have passed,
// whatever the system's key repeat rate, and keeps taking words as the guess
// writes them, until it is released.
const HOLD = 220
const TAKE_EVERY = 25
let holding = null

function release() {
    clearTimeout(holding?.delay)
    clearInterval(holding?.repeat)
    holding = null
}

// The line lies over the ghost (style.css), so a tap on the ghost lands on
// the line; where it fell is found in the ghost's own text. Returns the
// ghost up to the end of the word nearest the point (a gap counts as the
// word after it), or null when the point is not near the ghost.
const REACH = 12 // px a finger may miss by
function upToWordAt(x, y) {
    const node = view.firstChild
    if (!node) return null
    const text = node.textContent
    const range = document.createRange()
    let best = { at: -1, distance: REACH }
    for (let i = 0; i < text.length; i++) {
        range.setStart(node, i)
        range.setEnd(node, i + 1)
        for (const r of range.getClientRects()) {
            const distance = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom))
            if (distance < best.distance) best = { at: i, distance }
        }
    }
    if (best.at < 0) return null
    const end = best.at + /^\s*\S*/.exec(text.slice(best.at))[0].length
    return text.slice(0, end)
}

// Where a tap went down, read before the tap moves the cursor (which hides
// the ghost); it is taken on the click that ends the tap, so a swipe that
// scrolls takes nothing. A mouse click never takes the ghost.
let tap = null

function onPointerDown(event) {
    tap = null
    if (event.pointerType === 'mouse' || !view.textContent) return
    const take = upToWordAt(event.clientX, event.clientY)
    if (take) tap = { take, line: input.value }
}

function onTap() {
    const { take, line } = tap ?? {}
    tap = null
    if (!take || input.value !== line || !shown()?.startsWith(take)) return
    input.value += take
    input.setSelectionRange(input.value.length, input.value.length)
    changed()
}

function onKey(event) {
    if (event.key === 'Tab' && !event.shiftKey) {
        // Tab belongs to the command line: it never moves the focus away.
        event.preventDefault()
        if (event.repeat || holding) return
        takeWord()
        const hold = (holding = { delay: setTimeout(() => (hold.repeat = setInterval(takeWord, TAKE_EVERY)), HOLD) })
    } else if (event.key === 'Escape') {
        drop()
        draw()
    }
}

export function attach() {
    input.addEventListener('keydown', onKey)
    input.addEventListener('input', () => changed())
    // The history walk (up and down) sets the line without an input event.
    input.addEventListener('keyup', (event) => {
        if (event.key === 'Tab') release()
        changed()
    })
    input.addEventListener('blur', release)
    input.addEventListener('pointerdown', onPointerDown)
    input.addEventListener('click', onTap)
    for (const type of ['click', 'focus', 'blur', 'select']) input.addEventListener(type, draw)
    document.addEventListener('selectionchange', draw)
    window.addEventListener('resize', draw)
    document.fonts?.ready.then(draw)
    // A line typed while the model loaded is guessed once it is ready.
    writer.whenReady.then(() => changed(true))
}
