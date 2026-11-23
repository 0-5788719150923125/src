// One WebTorrent client for the whole page, loaded on first use. Chat rooms
// and radio stations are torrents in it. The service worker (src/sw.js,
// around WebTorrent's) lets
// audio stream straight out of a torrent into an <audio> element.

import { config } from './config.js'

let loading = null
let serving = null

// Both are promises, made on the first call, so callers that race get the
// same client and the same server.
export const getClient = () => (loading ??= startClient())

async function startClient() {
    const { default: WebTorrent } = await import('../vendor/webtorrent.min.js')
    const client = new WebTorrent()
    client.on('error', (err) => console.warn('webtorrent:', err.message || err))
    return client
}

export const announce = () => config.trackers

// The streaming server, or null where service workers are unavailable (for
// example, some private windows). The radio then plays over HTTP, from the
// web seed or the mirror. The
// first call starts it; a caller can start it early, while a torrent loads.
export const getServer = () => (serving ??= startServer())

async function startServer() {
    try {
        const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' })
        const worker = registration.active || registration.waiting || registration.installing
        if (worker.state !== 'activated') {
            await new Promise((resolve) =>
                worker.addEventListener('statechange', () => worker.state === 'activated' && resolve())
            )
        }
        // Audio requests only reach the worker once it controls the page. On
        // a first visit it claims the page as it activates; a page loaded
        // without it (a hard reload, a restored tab) asks to be claimed.
        if (!navigator.serviceWorker.controller) {
            await new Promise((resolve, reject) => {
                navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })
                registration.active?.postMessage('claim')
                setTimeout(() => reject(new Error('service worker never took control')), 5000)
            })
        }
        return (await getClient()).createServer({ controller: registration })
    } catch (err) {
        console.warn('streaming unavailable, playing over HTTP:', err.message || err)
        return null
    }
}

export const destroy = (torrent) =>
    new Promise((resolve) => (torrent && !torrent.destroyed ? torrent.destroy({}, resolve) : resolve()))
