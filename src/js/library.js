// What this tab remembers of the rooms it has been in: their lines, sent and
// received, kept in this browser so they outlast the page. It answers the
// room's memory questions (recall.js) from all of them, the room a question
// came through counting fully and every other room for less (memory.js
// OTHER_ROOM), and it answers this tab's own questions the same way.
//
// The newest ROOM_CHARS of each room are kept, for the ROOMS rooms used
// last. Rooms have never had a history; with this, their past can surface as
// suggestions to people who were not there.
//
// Lines are judged by the quality rules (quality.js): a line whose signs of
// noise (mashing, shouting, repetition, links...) add up to NOISE or less
// is not kept, and in answers a line counts from FLOOR (plain) up to 1
// (written with care), so careful writing outweighs the rest.

import { OTHER_ROOM, combine, index, lookup } from './memory.js'
import { quality } from './quality.js'
import { evaluate, part } from './rules.js'

const KEY = 'library' // localStorage
const ROOMS = 24
const ROOM_CHARS = 64000
const NOISE = -1.5
const FLOOR = 0.25

let rooms = read() // name -> { lines, used }
const indexes = new Map() // name -> index of that room's text, built when first needed
let saving = null
const watchers = new Set()

function read() {
    try {
        const kept = JSON.parse(localStorage.getItem(KEY))
        return kept && typeof kept === 'object' ? kept : {}
    } catch {
        return {}
    }
}

// Written a moment after the last change, not on every line.
function save() {
    clearTimeout(saving)
    saving = setTimeout(() => {
        try {
            localStorage.setItem(KEY, JSON.stringify(rooms))
        } catch (err) {
            console.warn('library: the chat was not kept:', err.message)
        }
    }, 1000)
}

export function remember(room, line) {
    if (part(evaluate(quality, line), 'noise') <= NOISE) return
    const kept = (rooms[room] ??= { lines: [], used: 0 })
    kept.lines.push(line)
    kept.used = Date.now()
    let chars = kept.lines.reduce((sum, l) => sum + l.length + 1, 0)
    while (chars > ROOM_CHARS && kept.lines.length > 1)
        chars -= kept.lines.shift().length + 1
    for (const name of Object.keys(rooms)
        .sort((a, b) => rooms[b].used - rooms[a].used)
        .slice(ROOMS)) {
        delete rooms[name]
        indexes.delete(name)
    }
    indexes.delete(room)
    save()
    for (const watcher of watchers) watcher()
}

// Every room this browser keeps, and its lines, oldest first: what it
// answers private questions from (answering.js), whatever room they came
// through.
export const snapshot = () =>
    Object.fromEntries(
        Object.entries(rooms).map(([name, room]) => [name, room.lines])
    )

// Called after each line kept.
export const watch = (watcher) => watchers.add(watcher)

// Read again from storage: another page of the same origin may have kept
// lines since (the extension's background, reading what its terminal kept).
export function reload() {
    rooms = read()
    indexes.clear()
    for (const watcher of watchers) watcher()
}

// A room's index, with where each line starts and what it counts for. The
// text starts with a line break too, so the first line can be matched from
// its start like every other.
function indexOf(name) {
    if (!indexes.has(name)) {
        const { lines } = rooms[name]
        const starts = []
        let at = 1
        for (const line of lines) {
            starts.push(at)
            at += line.length + 1
        }
        const weights = lines.map(
            (line) => FLOOR + (1 - FLOOR) * evaluate(quality, line).score
        )
        // The line a position falls in, by binary search over the starts.
        const weigh = (position) => {
            let lo = 0
            let hi = starts.length - 1
            while (lo < hi) {
                const mid = (lo + hi + 1) >> 1
                if (starts[mid] <= position) lo = mid
                else hi = mid - 1
            }
            return weights[lo] ?? FLOOR
        }
        indexes.set(name, { ...index('\n' + lines.join('\n') + '\n'), weigh })
    }
    return indexes.get(name)
}

// How `context` goes on, by every room this tab remembers, `current` being
// the room the question came through: { L, w, spans }, or null.
export function answer(context, current) {
    return combine(
        Object.keys(rooms).map((name) => {
            const room = indexOf(name)
            return {
                ...lookup(room, context, room.weigh),
                w: name === current ? 1 : OTHER_ROOM
            }
        })
    )
}
