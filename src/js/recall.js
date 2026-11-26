// Asking the room what it remembers, and answering it (memory.js). For
// each guess, the end of the conversation and the line being typed go to
// the peers this tab is connected to. The guess never waits for them: it
// starts with this tab's own memory (library.js), and every answer that
// arrives is merged with the ones before and handed on, so it steers
// whatever the guess has yet to write. Questions from the room's peers are
// answered from this tab's library. The ticker shows how many peers
// remember, how many answered, and how long a match they found.

import * as library from './library.js'
import {
    CONTEXT,
    clean,
    memoryExtension,
    merge,
    remembers,
    sendMemory
} from './memory.js'
import { state } from './state.js'

// ms after which a question is closed: answers later than this are not
// heard (measured 2026-11-25: the stack's servers answer in 80 ms at the
// median, 275 ms at worst).
const WAIT = 300
const PER_SECOND = 10 // questions answered per peer per second, at most
let room = null // the room's torrent, whose wires carry the questions
let name = '' // and its name
let next = 0
const waiting = new Map() // question id -> { answers, from, expect, heard, finish }
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
    if (typeof message.q === 'number' && typeof message.c === 'string')
        return answerQuestion(message, wire)
    const question = waiting.get(message.a)
    if (!question || question.from.has(wire)) return
    question.from.add(wire)
    question.answers.push(clean(message))
    if (question.answers.length - 1 >= question.expect) question.finish()
    else question.heard()
}

// A failure here is logged and gives `fallback`: a broken library, answer or
// callback means less memory, never a failed guess.
function safely(run, fallback = null) {
    try {
        return run()
    } catch (err) {
        console.warn('recall:', err.message || err)
        return fallback
    }
}

// How this tab's library says `context` goes on, weighing this room's text
// over other rooms': { L, spans, w }, or null.
const own = (context) =>
    safely(() => library.answer(context.slice(-CONTEXT), name))

// A peer in this room asks how a line goes on.
function answerQuestion(message, wire) {
    const now = Date.now()
    const seen = asked.get(wire) ?? { at: now, count: 0 }
    if (now - seen.at > 1000) Object.assign(seen, { at: now, count: 0 })
    asked.set(wire, seen)
    if (++seen.count > PER_SECOND) return
    const found = own(message.c)
    sendMemory(wire, {
        a: message.q,
        L: found?.L ?? 0,
        s: found?.spans ?? [],
        w: found?.w ?? 1
    })
}

// What the room remembers about how `context` goes on: `update(memory,
// done)` is called at once (before this returns) with this tab's own
// memory, then again with all the answers so far each time a peer answers,
// and a last time with done = true once every peer has answered or WAIT
// has passed. memory is null when nothing matched. Never throws: a peer
// that is slow, gone, or broken only means less memory.
export function ask(context, update) {
    const tell = (memory, done) => safely(() => update(memory, done))
    const answers = [own(context)]
    const merged = () =>
        safely(() => {
            const memory = merge(answers)
            return memory.L ? memory : null
        })
    const wires = (room?.wires ?? []).filter(remembers)
    if (!wires.length) {
        const memory = merged()
        if (memory)
            state.set('memory', { peers: 0, answered: 0, match: memory.L })
        return tell(memory, true)
    }
    const id = ++next
    const question = { answers, from: new Set(), expect: 0 }
    let timer = null
    question.heard = () => tell(merged(), false)
    question.finish = () => {
        if (!waiting.delete(id)) return
        clearTimeout(timer)
        const memory = merged()
        state.set('memory', {
            peers: wires.length,
            answered: answers.length - 1,
            match: memory?.L ?? 0
        })
        tell(memory, true)
    }
    waiting.set(id, question)
    for (const wire of wires)
        if (sendMemory(wire, { q: id, c: context.slice(-CONTEXT) }))
            question.expect++
    if (!question.expect) return question.finish()
    tell(merged(), false)
    timer = setTimeout(question.finish, WAIT)
}
