// Asking the room what it remembers, and answering it (memory.js). Before
// each guess, the end of the conversation and the line being typed go to
// the peers this tab is connected to; the answers that arrive in time,
// with this tab's own (library.js), are merged and handed to the writer.
// Questions from the room's peers are answered from this tab's library.
// The ticker shows how many peers remember and how long a match they found.

import * as library from './library.js'
import { CONTEXT, clean, memoryExtension, merge, remembers, sendMemory } from './memory.js'
import { state } from './state.js'

const WAIT = 150 // ms to wait for answers before guessing without them
const PER_SECOND = 10 // questions answered per peer per second, at most
let room = null // the room's torrent, whose wires carry the questions
let name = '' // and its name
let next = 0
const waiting = new Map() // question id -> { answers, from, expect, finish }
const asked = new WeakMap() // wire -> { at, count }, for the rate limit

export function use(torrent, roomName) {
    room = torrent
    name = roomName
    state.delete('memory')
}

// Called for every wire of the room, before its handshake.
export function attach(wire) {
    wire.use(memoryExtension(onMessage))
}

function onMessage(message, wire) {
    if (typeof message.q === 'number' && typeof message.c === 'string') return answerQuestion(message, wire)
    const question = waiting.get(message.a)
    if (!question || question.from.has(wire)) return
    question.from.add(wire)
    question.answers.push(clean(message))
    if (question.answers.length - 1 >= question.expect) question.finish()
}

// A peer in this room asks how a line goes on: answer from the library,
// which weighs this room's text over other rooms'.
function answerQuestion(message, wire) {
    const now = Date.now()
    const seen = asked.get(wire) ?? { at: now, count: 0 }
    if (now - seen.at > 1000) Object.assign(seen, { at: now, count: 0 })
    asked.set(wire, seen)
    if (++seen.count > PER_SECOND) return
    let found = null
    try {
        found = library.answer(message.c.slice(-CONTEXT), name)
    } catch (err) {
        console.warn('recall:', err.message || err)
    }
    try {
        sendMemory(wire, { a: message.q, L: found?.L ?? 0, s: found?.spans ?? [], w: found?.w ?? 1 })
    } catch {}
}

const own = (context) => {
    try {
        const found = library.answer(context.slice(-CONTEXT), name)
        return found && { L: found.L, spans: found.spans, w: found.w }
    } catch {
        return null
    }
}

// What the room remembers about how `context` goes on, this tab's own
// library included, or null. Never fails and never waits past WAIT: a peer
// that is slow, gone, or broken only means less memory, and the writer
// guesses with what it has.
export function ask(context) {
    const mine = own(context)
    const wires = (room?.wires ?? []).filter(remembers)
    if (!wires.length) {
        const memory = merge([mine])
        if (memory.L) state.set('memory', { peers: 0, answered: 0, match: memory.L })
        return Promise.resolve(memory.L ? memory : null)
    }
    const id = ++next
    return new Promise((resolve) => {
        const question = { answers: [mine], from: new Set(), expect: 0 }
        const timer = setTimeout(() => question.finish(), WAIT)
        question.finish = () => {
            if (!waiting.delete(id)) return
            clearTimeout(timer)
            let memory = null
            try {
                memory = merge(question.answers)
                state.set('memory', { peers: wires.length, answered: question.answers.length - 1, match: memory.L })
            } catch (err) {
                console.warn('recall:', err.message || err)
            }
            resolve(memory?.L ? memory : null)
        }
        waiting.set(id, question)
        for (const wire of wires) {
            try {
                if (sendMemory(wire, { q: id, c: context.slice(-CONTEXT) })) question.expect++
            } catch {}
        }
        if (!question.expect) question.finish()
    })
}
