// A browser's private answers (answering.js), off the page's thread: the
// table of what it remembers (contexts.js, kept a line at a time) and its
// hint, and every question, a pass over the whole table (pir.js). The page
// relays the wires: { message, wire } for each message a peer that answers
// takes (private.js ANSWERED), { close: wire } when one goes, and
// { library } (room -> lines) as the page starts and after each change.
// The worker sends back { wire, send } (bytes for that wire) and
// { status }.
//
// A browser gives less than a server: a few hints a minute, a few answers
// a second, in all.

import { createAnswerer } from './private.js'
import { quality } from './quality.js'
import { evaluate } from './rules.js'

const MIN_TEXT = 4000 // characters below which there is nothing worth offering
const FLOOR = 0.25 // what a plain line counts for, a careful one 1 (as library.js)

const answerer = createAnswerer({ groups: 1, hintsPerMinute: 6, questionsPerSecond: 20 })
const wires = new Map() // id -> a stand-in for the page's wire
let syncing = false
let wanted = null // the library, waiting for the sync under way to end

function wireOf(id) {
    if (!wires.has(id)) {
        wires.set(id, {
            destroyed: false,
            peerExtendedMapping: { src_pir: 1 },
            closers: [],
            once(event, fn) {
                if (event === 'close') this.closers.push(fn)
            },
            extended(name, bytes) {
                postMessage({ wire: id, send: bytes }, [bytes.buffer])
            }
        })
    }
    return wires.get(id)
}

// A line counts for how well it was written.
const weigh = (line) => FLOOR + (1 - FLOOR) * evaluate(quality, line).score

// The table, from the library as it now stands; one sync at a time, the
// latest library next. Nothing is offered until there is enough to say.
async function sync(library) {
    if (syncing) return void (wanted = library)
    const chars = Object.values(library).reduce((sum, lines) => sum + lines.reduce((n, line) => n + line.length + 1, 0), 0)
    if (chars < MIN_TEXT && !answerer.version) return
    syncing = true
    const t = performance.now()
    try {
        const { version, changes } = await answerer.sync(library, { weigh })
        postMessage({ status: { version, chars, changes, ms: Math.round(performance.now() - t) } })
    } catch (err) {
        console.warn('answer.worker:', err.message || err)
    }
    syncing = false
    if (wanted) {
        const next = wanted
        wanted = null
        sync(next)
    }
}

onmessage = ({ data }) => {
    if (data.library && typeof data.library === 'object') {
        const library = {}
        for (const [room, lines] of Object.entries(data.library)) if (Array.isArray(lines)) library[room] = lines.filter((line) => typeof line === 'string')
        sync(library)
    }
    if (data.message && typeof data.wire === 'number') answerer.handle(data.message, wireOf(data.wire))
    if (typeof data.close === 'number') {
        const wire = wires.get(data.close)
        if (!wire) return
        wire.destroyed = true
        wires.delete(data.close)
        for (const fn of wire.closers) fn()
    }
}
