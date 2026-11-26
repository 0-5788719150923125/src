// The extension's terminal is the site's (popup.html and panel.html are
// its index.html, with this module in place of js/main.js), plus what only
// an extension can do or needs:
// - its model is the one the extension shares, and so is its radio (both
//   in host.js), so the radio plays on when the popup closes;
// - the popup is a new page each time it opens, so what was on the screen,
//   and the chat it was in, are kept while the browser runs, and come back;
// - /ghost turns the ghost text in other sites' fields (page.js) on or
//   off, everywhere or on one site, kept in chrome.storage where every
//   tab's page.js reads it.
//
//   /ghost                 what is on, and where not
//   /ghost on | off        everywhere
//   /ghost on | off SITE   one site (a host name, or "here": the tab the
//                          terminal was opened over)

import { COMMANDS, find } from './js/commands.js'
import { print, say } from './js/print.js'
import * as radio from './js/radio.js'
import { state } from './js/state.js'
import { start } from './js/terminal.js'
import { html, t } from './js/text.js'
import * as writer from './js/writer.js'

const api = globalThis.browser ?? globalThis.chrome

COMMANDS.push({ name: '/ghost', run: ghost })

// A port of this name to the extension's background (host.js), or an
// error when it is not up: in Chrome, asking opens it.
async function connectHost(name) {
    if (!(await api.runtime.sendMessage({ type: 'host' })))
        throw new Error('no host')
    return api.runtime.connect({ name })
}

// ------------------------------------------------------------ the model

// The terminal's model is the one the extension runs for the whole browser
// (host.js), reached on a port that carries the worker's own messages, so
// its ghost is ready as the popup opens, and the browser holds one model,
// not two. Should the host not answer, the terminal starts one of its own,
// as the site does.
function sharedWorker() {
    const proxy = { onmessage: null, onerror: null }
    let queue = []
    let target = null // the port, or a worker of the terminal's own
    const use = (to) => {
        target = to
        for (const message of queue) to.postMessage(message)
        queue = []
    }
    proxy.postMessage = (message) =>
        target ? target.postMessage(message) : queue.push(message)
    proxy.terminate = () =>
        target?.disconnect ? target.disconnect() : target?.terminate()
    ;(async () => {
        try {
            const port = await connectHost('terminal')
            port.onMessage.addListener((data) => proxy.onmessage?.({ data }))
            port.onDisconnect.addListener(() =>
                proxy.onerror?.({ message: "the extension's model went away" })
            )
            use(port)
        } catch (err) {
            console.warn(
                'terminal: running a model of its own:',
                err.message || err
            )
            const own = new Worker(
                new URL('./js/writer.worker.js', import.meta.url),
                { type: 'module' }
            )
            own.onmessage = (event) => proxy.onmessage?.(event)
            own.onerror = (event) => proxy.onerror?.(event)
            use(own)
        }
    })()
    return proxy
}
writer.useWorker(sharedWorker)

// ------------------------------------------------------------ the radio

// The radio plays in the background (host.js), which outlives the popup:
// /radio is passed there, and what the radio says, with its part of the
// ticker, comes back, including what it said while the popup was closed.
// Should the host not answer, the terminal plays the radio itself, as the
// site does, until it closes.
function radioElsewhere() {
    let port = null
    let typed = 0 // /radio typed before the host answered
    async function open() {
        try {
            port = await connectHost('radio')
        } catch (err) {
            console.warn(
                'terminal: playing the radio itself:',
                err.message || err
            )
            radio.playElsewhere(null)
            radio.restore()
            for (; typed; typed--) radio.radio()
            return
        }
        port.onMessage.addListener((message) => {
            if (message.print)
                print(
                    message.print.speaker,
                    message.print.body,
                    message.print.options
                )
            for (const [key, value] of Object.entries(message.state ?? {})) {
                if (value) state.set(key, value)
                else state.delete(key)
            }
        })
        port.onDisconnect.addListener(() => {
            port = null
            state.delete('radio')
            state.delete('seeding')
        })
        for (; typed; typed--) port.postMessage({ command: 'radio' })
    }
    return {
        radio: () => (port ? port.postMessage({ command: 'radio' }) : typed++),
        // The site's terminal calls this as it starts, under the banner.
        restore: open
    }
}
radio.playElsewhere(radioElsewhere())

// ------------------------------------------------------------ the screen

// Kept in storage.session (in memory, until the browser closes): the lines
// on the screen, and the chat. Each opening prints its own banner and
// welcome lines, so those are left out, and the rest goes back under the
// banner.
const SCREEN = 'screen'
const store = api.storage.session
const output = document.querySelector('#container output')
const isBanner = (line) => Boolean(line.querySelector('#atom'))
let keeping = true

async function recall() {
    try {
        const { [SCREEN]: kept } = await store.get(SCREEN)
        return kept && Array.isArray(kept.lines) ? kept : null
    } catch {
        return null
    }
}

// The kept lines, under this opening's banner. They were this page's own
// markup, as print.js made it; parsed inert, and moved in.
function show(kept) {
    if (!kept?.lines.length) return
    const parsed = new DOMParser().parseFromString(
        `<!DOCTYPE html><body>${kept.lines.join('')}`,
        'text/html'
    )
    const banner = [...output.children].find(isBanner)
    if (banner) banner.after(...parsed.body.children)
    else output.prepend(...parsed.body.children)
    window.scrollTo(0, document.documentElement.scrollHeight)
}

function keep() {
    if (!store) return
    const welcome = t('ghost.info')
    const isOwn = (line) =>
        isBanner(line) ||
        line.querySelector(':scope > .text')?.textContent === welcome
    let chat = state.get('chat')
    let pending = null
    const save = () => {
        clearTimeout(pending)
        pending = null
        if (!keeping) return
        const lines = [...output.children]
            .filter((line) => !isOwn(line))
            .map((line) => line.outerHTML)
        store
            .set({ [SCREEN]: { lines, chat: state.get('chat') ?? null } })
            .catch(() => {})
    }
    const soon = () => (pending ??= setTimeout(save, 100))
    new MutationObserver(soon).observe(output, { childList: true })
    // /chat changes the chat a moment after it clears the screen.
    setInterval(() => {
        if (state.get('chat') === chat) return
        chat = state.get('chat')
        soon()
    }, 500)
    addEventListener('pagehide', () => pending && save())
}

// /reset forgets the kept screen too.
const reset = find('/reset')
const forget = reset.run
reset.run = async (args) => {
    keeping = false
    await store?.remove(SCREEN).catch(() => {})
    return forget(args)
}

// ------------------------------------------------------------ /ghost

const load = async () => {
    const { ghost: stored } = await api.storage.local.get('ghost')
    return { on: stored?.on !== false, sites: { ...(stored?.sites || {}) } }
}

// The host name of the tab the terminal opened over, or null: the popup
// may see it (activeTab), the side panel may not.
async function here() {
    try {
        const [tab] = await api.tabs.query({
            active: true,
            lastFocusedWindow: true
        })
        const url = tab?.url && new URL(tab.url)
        return url && /^https?:$/.test(url.protocol) ? url.hostname : null
    } catch {
        return null
    }
}

// "example.com", "https://example.com/page" or "here", as a host name.
async function siteOf(word) {
    if (word.toLowerCase() === 'here') return here()
    try {
        return (
            new URL(word.includes('://') ? word : `https://${word}`).hostname ||
            null
        )
    } catch {
        return null
    }
}

const everywhere = (on) =>
    on ? html('ghost.on-everywhere') : html('ghost.off-everywhere')
const atSite = (on, site) =>
    on ? html('ghost.on-site', { site }) : html('ghost.off-site', { site })

function status({ on, sites }) {
    say(everywhere(on))
    // The sites set apart from the rule.
    const apart = Object.keys(sites)
        .filter((site) => sites[site] !== on)
        .sort()
        .join(', ')
    if (apart)
        say(
            on
                ? t('ghost.exceptions-off', { sites: apart })
                : t('ghost.exceptions-on', { sites: apart })
        )
}

async function ghost([word, where]) {
    const settings = await load()
    const value = { on: true, off: false }[word?.toLowerCase()]
    if (value === undefined) {
        status(settings)
        return say(html('ghost.usage'))
    }
    if (!where) {
        // Everywhere, starting over: the sites set apart before are not.
        await api.storage.local.set({ ghost: { on: value, sites: {} } })
        return say(everywhere(value))
    }
    const site = await siteOf(where)
    if (!site) return say(html('ghost.unknown-site'))
    if (value === settings.on) delete settings.sites[site]
    else settings.sites[site] = value
    await api.storage.local.set({ ghost: settings })
    say(atSite(value, site))
}

// ------------------------------------------------------------ start

// Back in the chat it was in (the site reads it from the address), then
// the site's terminal, with the extension's welcome line, then the kept
// lines under its banner.
const kept = store ? await recall() : null
if (kept?.chat && !new URLSearchParams(location.search).has('chat')) {
    const url = new URL(location.href)
    url.searchParams.set('chat', kept.chat)
    history.replaceState(null, '', url)
}
await start({ welcome: 'ghost.info' })
show(kept)
keep()
