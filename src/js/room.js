// A room is a torrent. Every peer derives the same tiny torrent from the
// room's name, so they all meet on one info hash through the trackers. Chat
// rides a BitTorrent extension (BEP 10) on the wires of that torrent: each
// message is JSON, and every peer forwards what it has not seen before to
// its other wires, so a message crosses the mesh without every peer being
// connected to every other.
//
// This module is shared verbatim by the browser and the stack's seeder
// (containers/node/seed.js), so both derive the same info hash.

import { extension, json, readJson, send } from './wire.js'

export const EXTENSION = 'src_chat'
export const MAX_BYTES = 8192
export const MAX_LENGTH = 1024

// What a stranger may print: these characters only, and no word longer
// than 20. Markup, styling and foreign scripts stay out.
export function isPlain(message) {
    const allowed = !/[^0-9A-Za-z!@#$%&*()_\-+={[}\]\|:;"'''"",. ?\/\\~`]/.test(
        message
    )
    const shortWords = !message.split(' ').some((word) => word.length > 20)
    return allowed && shortWords
}

// The file a room's torrent is made of. Seeding the same name and bytes
// yields the same info hash everywhere. The bytes still say "focus", what
// rooms were once called: changing them would move every room to a new
// info hash.
export const roomFile = (room) =>
    new File(
        [new TextEncoder().encode(`The Source / focus / ${room}`)],
        `src-focus-${room}`
    )

// A wire extension that hands every well-formed message to onMessage.
export const chatExtension = (onMessage) =>
    extension(
        EXTENSION,
        (bytes) => {
            const payload = readJson(MAX_BYTES)(bytes)
            return typeof payload?.id === 'string' ? payload : null
        },
        onMessage
    )

// Send to one wire, if the peer on it speaks this extension.
export const sendTo = (wire, payload) => send(wire, EXTENSION, json(payload))

export const relay = (payload, from, wires) =>
    wires.filter((wire) => wire !== from).map((wire) => sendTo(wire, payload))

// Remembers the last `size` message ids; fresh() is true once per id.
export function createGossip(size = 1024) {
    const seen = new Set()
    return {
        fresh(id) {
            if (seen.has(id)) return false
            seen.add(id)
            if (seen.size > size) seen.delete(seen.values().next().value)
            return true
        }
    }
}
