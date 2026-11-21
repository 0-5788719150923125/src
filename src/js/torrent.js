// One WebTorrent client for the whole page, loaded on first use. Chat rooms
// and radio stations are torrents in it. The service worker (sw.js) lets
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
// example, some private windows). Callers fall back to the web seed. The
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
        // On a first visit the worker claims the page just after it
        // activates; audio requests only reach it once it controls the page.
        if (!navigator.serviceWorker.controller) {
            await new Promise((resolve, reject) => {
                navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })
                setTimeout(() => reject(new Error('service worker never took control')), 5000)
            })
        }
        return (await getClient()).createServer({ controller: registration })
    } catch (err) {
        console.warn('streaming unavailable, using the web seed:', err.message || err)
        return null
    }
}

// Whether any tracker socket of this torrent is open.
export const trackerConnected = (torrent) =>
    Boolean(torrent?.discovery?.tracker?._trackers?.some((t) => t.socket && t.socket.connected))

export const destroy = (torrent) =>
    new Promise((resolve) => (torrent && !torrent.destroyed ? torrent.destroy({}, resolve) : resolve()))
