// Every command the terminal knows, as data.
//
//   when      'offline' before /connect, 'online' after it; always if absent
//   secret    given the arguments, true when they must never be echoed or
//             kept in the history
//   expires   seconds until the echo of the command is taken away
//   run       called with the command's arguments

import { about } from './about.js'
import * as brain from './brain.js'
import * as chat from './chat.js'
import { choose } from './identity.js'
import { lab } from './lab.js'
import { open } from './offline.js'
import { clear, say } from './print.js'
import { radio } from './radio.js'

export const COMMANDS = [
    { name: '/about', run: about },
    { name: '/alert', when: 'online', run: chat.enableAlerts },
    { name: '/call', when: 'online', expires: 30, run: brain.prompt },
    { name: '/clear', run: clear },
    { name: '/connect', when: 'offline', run: chat.connect },
    { name: '/decrypt', when: 'offline', run: open },
    { name: '/focus', when: 'online', run: chat.setFocus },
    { name: '/help', run: help },
    { name: '/id', when: 'offline', secret: ([identity]) => identity && identity !== 'auto', run: choose },
    { name: '/lab', when: 'online', run: lab },
    { name: '/radio', run: radio },
    { name: '/reset', run: reset }
]

export const find = (name) => COMMANDS.find((command) => command.name === name)

export const available = (command) =>
    !command.when || command.when === (chat.isOnline() ? 'online' : 'offline')

function help() {
    say({ list: COMMANDS.filter(available).map((command) => command.name).sort() })
}

// Forget everything this browser holds for the site, and start again. v3
// kept GUN, its message log and its model in IndexedDB; v4 keeps torrent
// pieces in the origin's private file system and model weights in caches.
async function reset() {
    window.history.pushState('name', '', window.location.href.split('?')[0])
    localStorage.clear()
    sessionStorage.clear()
    for (const db of ['gun', 'memory', 'tensorflowjs']) window.indexedDB.deleteDatabase(db)
    try {
        const root = await navigator.storage.getDirectory()
        for await (const name of root.keys()) await root.removeEntry(name, { recursive: true })
    } catch {}
    try {
        for (const key of await caches.keys()) await caches.delete(key)
    } catch {}
    window.location.reload()
}
