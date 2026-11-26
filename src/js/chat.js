// Chat. A room is a torrent (room.js); messages cross its wires.
// There are no servers to keep up: a message reaches whoever is in the room
// when it is sent, as it always has. Each tab also keeps the lines of the
// rooms it has been in (library.js), and lends them to
// the swarm memory, so a room's past can surface as suggestions. Every
// message is signed by its sender's key (identity.js); unsigned ones are
// dropped, and the key shows on hover. The writer (writer.js) reads the
// room's conversation to guess what you will type, and forgets it when you
// change rooms.

import * as writer from './writer.js'
import * as library from './library.js'
import * as recall from './recall.js'
import { randomHex, sign, verify } from './crypto.js'
import { daemonName } from './daemon.js'
import { keptSecret, signIn, signedIn, you } from './identity.js'
import {
    SPEAKERS,
    banner,
    clear,
    handle,
    print,
    say,
    showPrompt
} from './print.js'
import {
    MAX_LENGTH,
    chatExtension,
    createGossip,
    isPlain,
    relay,
    roomFile,
    sendTo
} from './room.js'
import { createSigil } from './sigil.js'
import { state } from './state.js'
import { html, t } from './text.js'
import { announce, destroy, getChatClient } from './torrent.js'

const DEFAULT_ROOM = 'trade'
const DAEMON = 'identifier' // localStorage: seeds this browser's daemon name

const session = {
    name: DEFAULT_ROOM, // the room's name
    room: null, // its torrent
    gossip: createGossip()
}

// At start: sign in, and join the chat named in the address, or the default.
// Visitors call a room a chat (/chat, ?chat=, the ticker's `chat`; the
// user's call, 2026-11-22, after WoW's "trade chat"); the code still says
// room, and so does the field in each message, so older pages still talk.
export async function connect() {
    // Every message is signed; a browser that cannot sign stays out.
    if (!(await signIn())) return
    showPrompt(you())
    state.set('daemon', daemonName(keptSecret(DAEMON, 64)))
    try {
        await enter(
            new URLSearchParams(window.location.search).get('chat') ||
                DEFAULT_ROOM
        )
    } catch (err) {
        console.error(err)
        say(t('chat.failed'))
    }
}

// /chat <name>: a fresh screen, your sigil, and the new chat.
export async function setChat([name]) {
    if (!name) return say(html('chat.usage'))
    clear()
    const keys = signedIn()
    if (keys)
        print(null, banner(await createSigil(keys.pub), t('banner.connected')))
    await enter(name)
}

async function enter(chat) {
    const name = chat.toLowerCase()
    session.name = name
    state.set('chat', name)
    const url = new URL(window.location.href)
    url.searchParams.set('chat', name)
    window.history.pushState({}, '', url)
    writer.forget()
    const previous = session.room
    session.room = null
    await destroy(previous)
    const client = await getChatClient()
    const torrent = client.seed(roomFile(name), { announce: announce() })
    const Chat = chatExtension(receive)
    torrent.on('wire', (wire) => {
        wire.use(Chat)
        recall.attach(wire)
    })
    recall.use(torrent, name)
    session.room = torrent
}

// ------------------------------------------------------------ messages

// A message as this tab can read it, or null: its signature checked, plain
// text of a sane length.
async function read({ message, pubKey, signature }) {
    if (
        typeof message !== 'string' ||
        typeof pubKey !== 'string' ||
        typeof signature !== 'string'
    )
        return null
    if (!(await verify(pubKey, signature, message))) return null
    if (message.length > MAX_LENGTH) return null
    message = message.replace(/\n/g, ' ')
    return message && isPlain(message) ? { message, sender: pubKey } : null
}

// Flooding. Every peer passes on what it has not seen, so one peer sending
// too fast would be multiplied across the room. A connection that sends
// more than WIRE_LIMIT messages a second is not heard past it, and one that
// sends WIRE_CUTOFF is dropped; a sender's key heard more than SENDER_LIMIT
// times in SENDER_WINDOW ms is not shown, kept or passed on. Only messages
// this tab can read and verify are passed on, so forgeries and floods stop
// at the first peer.
const WIRE_LIMIT = 20
const WIRE_CUTOFF = 100
const SENDER_LIMIT = 10
const SENDER_WINDOW = 10000
const heardOn = new WeakMap() // wire -> { at, count }
const heardFrom = new Map() // sender's key -> times heard, within the window

function wireAllows(wire) {
    const now = Date.now()
    const heard = heardOn.get(wire) ?? { at: now, count: 0 }
    if (now - heard.at >= 1000) Object.assign(heard, { at: now, count: 0 })
    heardOn.set(wire, heard)
    if (++heard.count >= WIRE_CUTOFF) wire.destroy()
    return heard.count <= WIRE_LIMIT
}

function senderAllows(key) {
    const now = Date.now()
    const times = (heardFrom.get(key) ?? []).filter(
        (at) => now - at < SENDER_WINDOW
    )
    times.push(now)
    heardFrom.set(key, times)
    if (heardFrom.size > 1000)
        for (const [k, t] of heardFrom)
            if (now - t.at(-1) >= SENDER_WINDOW) heardFrom.delete(k)
    return times.length <= SENDER_LIMIT
}

async function receive(payload, fromWire) {
    if (
        !session.room ||
        !session.gossip.fresh(payload.id) ||
        !wireAllows(fromWire) ||
        payload.room !== session.name
    )
        return
    try {
        const { message, sender } = (await read(payload)) ?? {}
        if (!message || !senderAllows(sender)) return
        relay(payload, fromWire, session.room.wires)
        notify(`${handle(SPEAKERS.fold)} ${message}`)
        keep(message)
        // The sender's key, on hover: who said it, should they need blocking.
        print(
            SPEAKERS.fold,
            { text: message, tooltip: t('chat.sender', { key: sender }) },
            { scroll: 'follow' }
        )
    } catch (err) {
        console.warn(
            'Dropped a message that could not be read:',
            err.message || err
        )
    }
}

// The writer reads every line of the room; the library keeps them, and
// shares them with the swarm.
function keep(message) {
    writer.remember(message)
    library.remember(session.name, message)
}

export async function send(message) {
    const keys = signedIn()
    if (!keys) return
    keep(message)
    const payload = {
        id: randomHex(32),
        room: session.name,
        message,
        pubKey: keys.pub,
        signature: await sign(keys, message)
    }
    session.gossip.fresh(payload.id)
    for (const wire of session.room?.wires ?? []) sendTo(wire, payload)
}

// ------------------------------------------------------------ notifications

function notify(body) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(t('alert.title'), { body, icon: 'favicon.ico' })
    }
}

// /alert
export async function enableAlerts() {
    if (!('Notification' in window)) return say(t('alert.unsupported'))
    if ((await Notification.requestPermission()) === 'granted')
        notify(t('alert.enabled'))
}
