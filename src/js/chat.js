// Chat. A focus is a room torrent (room.js); messages cross its wires.
// There are no servers to keep up and no history: a message reaches whoever
// is in the room when it is sent, as it always has. Signed messages print
// in purple, with the sender's public key in a tooltip.

import * as brain from './brain.js'
import { createBullet } from './bullets.js'
import { decrypt, encrypt, randomHex, sign, verify } from './crypto.js'
import { daemonName } from './daemon.js'
import { signIn, signedIn, you } from './identity.js'
import { SPEAKERS, banner, clear, handle, print, say, showPrompt } from './print.js'
import { MAX_LENGTH, chatExtension, createGossip, isPlain, relay, roomFile, sendTo } from './room.js'
import { createSigil } from './sigil.js'
import { state } from './state.js'
import { html, t } from './text.js'
import { announce, destroy, getClient, trackerConnected } from './torrent.js'

const DEFAULT_FOCUS = 'trade'
const SIGIL = 'GhostIsCuteVoidGirl' // seeds the welcome sigil of anyone unsigned
const DAEMON = 'identifier' // localStorage: seeds this browser's daemon name

const session = {
    online: false,
    focus: DEFAULT_FOCUS,
    password: null,
    room: null,
    gossip: createGossip()
}

export const isOnline = () => session.online

// /connect, into the room named in the address (?focus=), or the default.
export async function connect() {
    session.online = true
    await signIn()
    showPrompt(you())

    let seed = localStorage.getItem(DAEMON)
    if (!seed) localStorage.setItem(DAEMON, (seed = randomHex(64)))
    state.set('daemon', daemonName(seed))

    try {
        await setFocus([new URLSearchParams(window.location.search).get('focus') || DEFAULT_FOCUS])
    } catch (err) {
        console.error(err)
        say(t('chat.failed'))
    }
    watchStatus()
    brain.load()
}

// /focus [name] [password]
export async function setFocus([name, password]) {
    if (!name) return say(html('chat.focus'))
    session.password = password || null
    session.focus = name.toLowerCase()
    state.set('focus', session.focus)
    const url = new URL(window.location.href)
    url.searchParams.set('focus', session.focus)
    window.history.pushState({}, '', url)
    clear()
    print(null, banner(await createSigil(signedIn()?.pub ?? SIGIL), t('banner.connected')))
    await joinRoom(session.focus)
}

async function joinRoom(focus) {
    const previous = session.room
    session.room = null
    await destroy(previous)
    const client = await getClient()
    const torrent = client.seed(roomFile(focus), { announce: announce() })
    const Chat = chatExtension(receive)
    torrent.on('wire', (wire) => {
        wire.use(Chat)
        createBullet()
    })
    session.room = torrent
}

// ------------------------------------------------------------ messages

// A message as this tab can read it, or null: opened with the room's
// password, its signature checked, plain text of a sane length.
async function read({ message, pubKey, signature }) {
    if (typeof message !== 'string') return null
    if (session.password) message = await decrypt(message, session.password)
    if (pubKey && !(await verify(pubKey, signature, message))) return null
    if (message.length > MAX_LENGTH) return null
    message = message.replace(/\n/g, ' ')
    return message && isPlain(message) ? { message, sender: pubKey || null } : null
}

async function receive(payload, fromWire) {
    if (!session.room || !session.gossip.fresh(payload.id)) return
    relay(payload, fromWire, session.room.wires)
    if (payload.focus !== session.focus) return
    try {
        const readable = await read(payload)
        if (!readable) return
        const { message, sender } = readable
        const speaker = sender ? SPEAKERS.signed : SPEAKERS.fold
        notify(`${handle(speaker)} ${message}`)
        if (!session.password) brain.remember(message)
        const body = sender ? { text: message, tooltip: t('chat.sender', { key: sender }) } : message
        print(speaker, body, { scroll: 'follow' })
    } catch (err) {
        console.warn('Dropped a message that could not be read:', err.message || err)
    }
}

export async function send(message) {
    if (!session.password) brain.remember(message)
    const keys = signedIn()
    const payload = {
        id: randomHex(32),
        focus: session.focus,
        message: session.password ? await encrypt(message, session.password) : message,
        pubKey: keys ? keys.pub : null,
        signature: keys ? await sign(keys, message) : null
    }
    session.gossip.fresh(payload.id)
    for (const wire of session.room?.wires ?? []) sendTo(wire, payload)
}

// ------------------------------------------------------------ status

// The book is open (closed, when signed) while this tab can reach the
// swarm: a peer in the room, or a tracker that can introduce one.
function watchStatus() {
    const { room } = session
    if (room && (room.wires.length > 0 || trackerConnected(room))) state.set('book', signedIn() ? 'closed' : 'open')
    else state.set('book', state.get('book') === 'connecting' ? 'offline' : 'connecting')
    setTimeout(watchStatus, 500)
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
    if ((await Notification.requestPermission()) === 'granted') notify(t('alert.enabled'))
}
