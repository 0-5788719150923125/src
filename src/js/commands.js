// Every command the terminal knows, as data.
//
//   run       called with the command's arguments

import { about } from './about.js'
import * as chat from './chat.js'
import { clear, say } from './print.js'
import { radio } from './radio.js'

export const COMMANDS = [
    { name: '/about', run: about },
    { name: '/alert', run: chat.enableAlerts },
    { name: '/clear', run: clear },
    { name: '/chat', run: chat.setChat },
    { name: '/help', run: help },
    { name: '/radio', run: radio },
    { name: '/reset', run: reset }
]

export const find = (name) => COMMANDS.find((command) => command.name === name)

function help() {
    say({ list: COMMANDS.map((command) => command.name).sort() })
}

// Forget everything this browser holds for the site, and start again:
// storage, every IndexedDB database (v4 makes none, but v3 left some
// behind), torrent pieces in the origin's private file system, model
// weights in caches, and the HTTP cache (reset.txt is served with
// Clear-Site-Data, src/_headers), so the reload fetches the site anew.
async function reset() {
    window.history.pushState('name', '', window.location.href.split('?')[0])
    localStorage.clear()
    sessionStorage.clear()
    const steps = [
        async () => {
            for (const { name } of await indexedDB.databases())
                indexedDB.deleteDatabase(name)
        },
        async () => {
            const root = await navigator.storage.getDirectory()
            for await (const name of root.keys())
                await root.removeEntry(name, { recursive: true })
        },
        async () => {
            for (const key of await caches.keys()) await caches.delete(key)
        },
        () => fetch('/reset.txt', { cache: 'no-store' })
    ]
    // Each as far as the browser allows: what one refuses is said, and the
    // rest go on.
    for (const step of steps)
        await step().catch((err) => console.warn('reset:', err.message || err))
    window.location.reload()
}
