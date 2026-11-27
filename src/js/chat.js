// Chat. A room is a torrent (room.js); messages cross its wires.
// There are no servers to keep up: a message reaches whoever is in the room
// when it is sent, as it always has. Each tab also keeps the lines of the
// rooms it has been in (library.js), and lends them to
// the swarm memory, so a room's past can surface as suggestions. Every
// message is signed by its sender's key (identity.js); unsigned ones are
// dropped. The writer (writer.js) reads the room's conversation to guess
// what you will type, and forgets it when you change rooms.
//
// The browser extension runs the chat in its background page, which
// outlives its popup (extension/host.js): there, the conversation goes to
// the background's own model (useConversation), and the extension's
// terminal hands connecting, sending and /chat to the background
// (chatElsewhere, extension/terminal.js). Both are unset on the site.

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
    sendTo,
    signed,
    toVerify
} from './room.js'
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

let elsewhere = null // { connect, send, setChat }
export const chatElsewhere = (to) => (elsewhere = to)
let conversation = writer // { remember, forget }
export const useConversation = (to) => (conversation = to)

// At start: sign in, and join the chat named in the address, or the default.
// Visitors call a room a chat (/chat, ?chat=, the ticker's `chat`; the
// user's call, 2026-11-22, after WoW's "trade chat"); the code still says
// room, and so does the field in each message, so older pages still talk.
export async function connect() {
    if (elsewhere) return elsewhere.connect()
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

// /chat <name>: a fresh screen, the banner, and the new chat.
export async function setChat([name]) {
    if (elsewhere) return elsewhere.setChat(name)
    if (!name) return say(html('chat.usage'))
    clear()
    print(null, banner(t('banner.connected')))
    await enter(name)
}

async function enter(chat) {
    const name = chat.toLowerCase()
    session.name = name
    state.set('chat', name)
    const url = new URL(window.location.href)
    url.searchParams.set('chat', name)
    window.history.pushState({}, '', url)
    conversation.forget()
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

// A message as this tab can read it, or null: for this chat, in time, its
// signature checked (room.js toVerify), plain text of a sane length.
async function read(payload) {
    const text = toVerify(payload, session.name)
    if (!text || !(await verify(payload.pubKey, payload.signature, text)))
        return null
    let { message } = payload
    if (message.length > MAX_LENGTH) return null
    message = message.replace(/\n/g, ' ')
    return message && isPlain(message)
        ? { message, sender: payload.pubKey }
        : null
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
        session.gossip.has(payload.id) ||
        !wireAllows(fromWire)
    )
        return
    try {
        const { message, sender } = (await read(payload)) ?? {}
        if (!message || !session.gossip.fresh(payload.id)) return
        if (!senderAllows(sender)) return
        relay(payload, fromWire, session.room.wires)
        notify(`${handle(SPEAKERS.fold)} ${message}`)
        keep(message)
        print(SPEAKERS.fold, message, { scroll: 'follow' })
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
    conversation.remember(message)
    library.remember(session.name, message)
}

export async function send(message) {
    if (elsewhere) return elsewhere.send(message)
    const keys = signedIn()
    if (!keys) return
    keep(message)
    const payload = {
        id: randomHex(32),
        room: session.name,
        at: Date.now(),
        message,
        pubKey: keys.pub
    }
    payload.signature = await sign(keys, signed(payload))
    session.gossip.fresh(payload.id)
    for (const wire of session.room?.wires ?? []) sendTo(wire, payload)
}

// ------------------------------------------------------------ notifications

// A desktop notification for every line heard, from /alert until /alert
// again. The extension has its permission from its manifest, so the choice
// is kept apart (localStorage, shared with its background, where the chat
// runs), and its pages use the extensions' API where they have it: Firefox
// gives them none through the web's (Chrome's offscreen document, which
// has no extension API, does).
const ALERTS = 'alerts' // localStorage: set while /alert is on
const notifications = globalThis.chrome?.notifications

function notify(body) {
    if (!localStorage.getItem(ALERTS)) return
    const title = t('alert.title')
    const icon = 'favicon.ico'
    if (notifications)
        notifications.create({
            type: 'basic',
            title,
            message: body,
            iconUrl: icon
        })
    else if (Notification.permission === 'granted')
        new Notification(title, { body, icon })
}

// /alert
export async function toggleAlerts() {
    if (localStorage.getItem(ALERTS)) {
        localStorage.removeItem(ALERTS)
        return say(t('alert.disabled'))
    }
    if (!notifications && !('Notification' in window))
        return say(t('alert.unsupported'))
    if (
        !notifications &&
        (await Notification.requestPermission()) !== 'granted'
    )
        return say(t('alert.denied'))
    localStorage.setItem(ALERTS, '1')
    say(t('alert.enabled'))
    notify(t('alert.enabled'))
}
