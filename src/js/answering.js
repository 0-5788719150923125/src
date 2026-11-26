// Private questions to the swarm memory, in the browser (next/private-memory.md):
// joining the private swarm (private.js) to ask, as the browser extension
// does for its page fields, and to answer, from what this browser keeps of
// the chat (library.js), as every tab of the site does, so asking does not
// hang on the library servers: if they go down, browsers still answer.
//
// Answering runs in a worker (answer.worker.js): the first table and its
// hint take seconds, and the page stays free. The library is handed to it
// as the page starts, then again after each new line (a burst of chat
// within AGAIN as one), and the table changes only where the lines that
// came and went touch it (contexts.js createShelves).

import * as library from './library.js'
import { ANSWERED, EXTENSION, privateExtension, swarmFile } from './private.js'
import { announce, getClient } from './torrent.js'

const AGAIN = 250 // ms in which lines kept count as one change

let joined = null

// Join the private swarm, once, on the radio's torrent client, with an
// asker (createAsker) and/or an answerer (answerer, below). Each message
// goes to the one that takes its kind.
export function join({ asker = null, answerer = null } = {}) {
    if (joined) return joined
    const Private = privateExtension((message, wire) => {
        if (message.type === 'open' || !ANSWERED.has(message.type)) asker?.handle(message, wire)
        if (message.type !== 'open' && ANSWERED.has(message.type)) answerer?.handle(message, wire)
    })
    joined = getClient()
        .then((client) => client.seed(swarmFile(), { announce: announce() }).on('wire', (wire) => wire.use(Private)))
        .catch((err) => console.warn('answering:', err.message || err))
    return joined
}

// An answerer whose table a worker keeps, from the library, a line at a
// time.
export function answerer() {
    const worker = new Worker(new URL('./answer.worker.js', import.meta.url), { type: 'module' })
    const ids = new WeakMap() // wire -> id
    const wires = new Map() // id -> wire
    let next = 0
    let status = null
    worker.onmessage = ({ data }) => {
        const wire = wires.get(data.wire)
        if (data.send && wire && !wire.destroyed) {
            try {
                wire.extended(EXTENSION, data.send)
            } catch {}
        }
        if (data.status) status = data.status
    }
    worker.onerror = (event) => console.warn('answering:', event.message)
    const idOf = (wire) => {
        if (!ids.has(wire)) {
            const id = ++next
            ids.set(wire, id)
            wires.set(id, wire)
            wire.once('close', () => {
                wires.delete(id)
                worker.postMessage({ close: id })
            })
        }
        return ids.get(wire)
    }
    let timer = null
    const load = (after = 0) => {
        clearTimeout(timer)
        timer = setTimeout(() => worker.postMessage({ library: library.snapshot() }), after)
    }
    library.watch(() => load(AGAIN))
    load()
    return {
        handle: (message, wire) => worker.postMessage({ message, wire: idOf(wire) }),
        status: () => status
    }
}

// The site's tabs: answer, from the library.
export const start = () => join({ answerer: answerer() })
