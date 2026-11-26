// Ghost text: a guess at the rest of the line, drawn after the cursor. It
// is not part of the line: it cannot be selected and does not move the
// cursor. Tab takes it a word at a time, as if typed; held, it takes words
// quickly until released, a whole sentence in a moment. Tab never moves the
// focus. On a touchscreen, which has no Tab, a tap on the ghost keeps it up
// to the end of the word tapped, and a finger drawn along it keeps it up to
// the end of the word where the finger lifts (drawn back, it keeps less;
// back past the ghost's start, nothing). Escape dismisses the ghost. Typing
// what it shows keeps it; typing anything else stops it at once, and a new
// guess comes once the typing pauses. Commands get no guesses.

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
const taking = document.getElementById('taking') // what a swipe would keep, drawn as typed
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
        // Corrected by the swarm: written again from the start.
        if (ghost.reset) Object.assign(current, { written: '', done: false })
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
        if (
            current?.id !== id ||
            current.written ||
            current.done ||
            retries >= RETRIES
        )
            return
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
    // Guess anew once the typing pauses, unless the guess still has
    // something to show or is still being written.
    if (rest === null || (rest === '' && current.done)) {
        drop()
        timer = setTimeout(ask, PAUSE)
    }
    draw()
}

// The mirror behind the line (style.css) holds the typed text, unseen, and
// the ghost after it, so the ghost starts where the text ends and wraps with
// it. The mirror also sizes the line, so it is kept up to date on every
// change, ghost or not. During a swipe, the ghost's start that would be kept
// is drawn apart, like typed text.
function draw() {
    typed.textContent = input.value
    const rest = shown()
    const visible = rest && atEnd() ? rest : ''
    const keep =
        press?.swiping &&
        press.line === input.value &&
        visible.startsWith(press.region)
            ? press.region
            : ''
    taking.textContent = keep
    view.textContent = visible.slice(keep.length)
}

// Add `text` to the line as if typed, the cursor after it.
function type(text) {
    input.value += text
    input.setSelectionRange(input.value.length, input.value.length)
    changed()
}

// Take the ghost's next word (its leading space and any punctuation stuck to
// it). The guess goes on writing behind it.
function takeWord() {
    const rest = shown()
    if (rest && atEnd()) type(/^\s*\S+/.exec(rest)?.[0] ?? rest)
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

// The line lies over the ghost (style.css), so a touch on the ghost lands on
// the line; where it fell is found in the ghost's own text, by the boxes of
// its characters (wherever they are drawn: a swipe draws its start apart).
function ghostBoxes() {
    const range = document.createRange()
    const boxes = []
    let text = ''
    for (const node of [taking.firstChild, view.firstChild]) {
        if (!node) continue
        for (let i = 0; i < node.length; i++) {
            range.setStart(node, i)
            range.setEnd(node, i + 1)
            for (const r of range.getClientRects())
                boxes.push({
                    at: text.length + i,
                    left: r.left,
                    right: r.right,
                    top: r.top,
                    bottom: r.bottom
                })
        }
        text += node.textContent
    }
    return { text, boxes }
}

// The ghost up to the end of the word at `at` (a gap counts as the word
// after it).
const upToWord = (text, at) =>
    text.slice(0, at + /^\s*\S*/.exec(text.slice(at))[0].length)

// How far a point is from a box, across and down.
const across = (b, x) => Math.max(b.left - x, 0, x - b.right)
const down = (b, y) => Math.max(b.top - y, 0, y - b.bottom)
const nearest = (boxes, distance) =>
    boxes.reduce((best, b) => (distance(b) < distance(best) ? b : best))

// For a tap: the ghost up to the end of the word nearest the point, or null
// when the point is not near the ghost.
const REACH = 12 // px a finger may miss by
function upToWordAt(x, y) {
    const { text, boxes } = ghostBoxes()
    if (!boxes.length) return null
    const distance = (b) => Math.hypot(across(b, x), down(b, y))
    const b = nearest(boxes, distance)
    return distance(b) < REACH ? upToWord(text, b.at) : null
}

// For a swipe: the same, wherever the finger is, along the line of the
// ghost nearest it (the ghost wraps, and a finger beside one line can be
// nearer the next); nothing once it is back before the ghost's first
// character.
function swipedTo(x, y) {
    const { text, boxes } = ghostBoxes()
    if (!boxes.length) return ''
    const { top } = nearest(boxes, (b) => down(b, y))
    const line = boxes.filter((b) => Math.abs(b.top - top) < 2)
    if (line[0].at === 0 && x < line[0].left) return ''
    return upToWord(text, nearest(line, (b) => across(b, x)).at)
}

// Keep `take`, the ghost's start, if the line is still `line`.
function keep(take, line) {
    if (take && input.value === line && shown()?.startsWith(take)) type(take)
}

// A finger (or pen) down on the ghost. Where it went down is read at once,
// before the tap moves the cursor (which hides the ghost). Lifted where it
// went down, it is a tap, taken on the click that ends it, so a touch that
// scrolls the page takes nothing. Drawn sideways SWIPE px or more, it is a
// swipe: what it would keep follows the finger, and is kept when the finger
// lifts. The line lets the page scroll up and down, but not sideways
// (style.css), so a sideways draw stays a swipe; a scroll cancels it. A
// mouse never takes the ghost.
const SWIPE = 12
let tap = null // { take, line }: what a tap here would keep
let press = null // { id, x, line, region, swiping }
let swiped = false // a swipe just ended: a click after it must not move the cursor

function onPointerDown(event) {
    tap = null
    press = null
    swiped = false
    if (
        event.pointerType === 'mouse' ||
        !(view.textContent || taking.textContent)
    )
        return
    const take = upToWordAt(event.clientX, event.clientY)
    if (!take) return
    tap = { take, line: input.value }
    press = {
        id: event.pointerId,
        x: event.clientX,
        line: input.value,
        region: take,
        swiping: false
    }
}

function onPointerMove(event) {
    if (press?.id !== event.pointerId) return
    if (!press.swiping) {
        if (Math.abs(event.clientX - press.x) < SWIPE) return
        press.swiping = true
        tap = null
    }
    press.region = swipedTo(event.clientX, event.clientY)
    draw()
}

function onPointerUp(event) {
    if (press?.id !== event.pointerId) return
    const { swiping, region, line } = press
    press = null
    if (!swiping) return
    swiped = true
    keep(region, line)
    draw()
}

function onPointerCancel(event) {
    if (press?.id !== event.pointerId) return
    press = null
    tap = null
    draw()
}

function onClick() {
    if (swiped) {
        // A short swipe can still end in a click, which puts the cursor
        // where the finger was: back to the end, where the ghost is.
        swiped = false
        input.setSelectionRange(input.value.length, input.value.length)
        return changed()
    }
    const { take, line } = tap ?? {}
    tap = null
    keep(take, line)
}

function onKey(event) {
    if (event.key === 'Tab' && !event.shiftKey) {
        // Tab belongs to the command line: it never moves the focus away.
        event.preventDefault()
        if (event.repeat || holding) return
        takeWord()
        const hold = (holding = {
            delay: setTimeout(
                () => (hold.repeat = setInterval(takeWord, TAKE_EVERY)),
                HOLD
            )
        })
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
    input.addEventListener('pointermove', onPointerMove)
    input.addEventListener('pointerup', onPointerUp)
    input.addEventListener('pointercancel', onPointerCancel)
    input.addEventListener('click', onClick)
    // Held on the ghost, a finger means to swipe: no menu, no selection.
    input.addEventListener(
        'contextmenu',
        (event) => press && event.preventDefault()
    )
    for (const type of ['click', 'focus', 'blur', 'select'])
        input.addEventListener(type, draw)
    document.addEventListener('selectionchange', draw)
    window.addEventListener('resize', draw)
    document.fonts?.ready.then(draw)
    // A line typed while the model loaded is guessed once it is ready.
    writer.whenReady.then(() => changed(true))
}
