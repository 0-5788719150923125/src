// Two WebTorrent clients, each loaded on first use: one for the radio's
// stations, one for chat rooms. The chat client may use Cloudflare's TURN
// relay, so two browsers behind strict NATs still reach each other; the
// radio's never does, since songs are large and the mirror already serves
// them over HTTP. The service worker (src/sw.js, around WebTorrent's) lets
// audio stream straight out of a torrent into an <audio> element.

import { config } from './config.js'

let loading = null
let serving = null

// Both are promises, made on the first call, so callers that race get the
// same client and the same server.
export const getClient = () => (loading ??= startClient())

async function startClient(opts = {}) {
    const WebTorrent = await loadWebTorrent()
    const client = new WebTorrent(opts)
    client.on('error', (err) => console.warn('webtorrent:', err.message || err))
    return client
}

// The relayed connections still open, which take fresh credentials.
const relayed = new Set()
const hasRelay = (config) => (config?.iceServers || []).some((server) => server.username)

// WebTorrent's peer library takes the page's RTCPeerConnection once, as the
// bundle loads (it ignores a `wrtc` option), so the page's is replaced
// first, with one that changes nothing for a connection without a TURN
// server (the radio's, and chat with no relay). With one:
// - Gathering ends early. WebTorrent's trackers send an offer (and an
//   answer) only once gathering is complete, or after 5 s; browsers often
//   never report it complete (some STUN request on some interface never
//   times out), though every useful candidate is in within 150 ms. With
//   the relay that wait is fatal, not just slow: the relay drops the
//   answering side's checks until the offering side has the answer and
//   grants it a permission, and the answering side gives up after about
//   10 s (2026-11-23: an answer reaching the offerer 8 s late connected,
//   15 s late did not; through the trackers, with 5 s waits on both
//   sides, none connected). So it completes once a relay candidate is in,
//   plus a moment for the rest, or 2 s after the description is set.
// - It is kept in `relayed` while open, for new credentials.
let bundle = null
function loadWebTorrent() {
    return (bundle ??= (async () => {
        const Native = globalThis.RTCPeerConnection
        if (Native) {
            class Connection extends Native {
                #gathered = null
                constructor(config, ...rest) {
                    super(config, ...rest)
                    if (!hasRelay(config)) return
                    relayed.add(this)
                    this.addEventListener('connectionstatechange', () => {
                        if (this.connectionState === 'closed' || this.connectionState === 'failed') relayed.delete(this)
                    })
                    this.addEventListener('icecandidate', (event) => {
                        if (event.candidate?.type === 'relay') this.#finish(250)
                    })
                }
                async setLocalDescription(...args) {
                    await super.setLocalDescription(...args)
                    if (relayed.has(this)) this.#finish(2000)
                }
                // Report gathering complete in `ms`, unless sooner is set.
                #finish(ms) {
                    const at = Date.now() + ms
                    if (this.#gathered && this.#gathered.at <= at) return
                    clearTimeout(this.#gathered?.timer)
                    this.#gathered = {
                        at,
                        timer: setTimeout(() => {
                            if (this.signalingState === 'closed' || this.iceGatheringState === 'complete') return
                            this.dispatchEvent(new RTCPeerConnectionIceEvent('icecandidate', { candidate: null }))
                        }, ms)
                    }
                }
                close() {
                    clearTimeout(this.#gathered?.timer)
                    relayed.delete(this)
                    return super.close()
                }
            }
            globalThis.RTCPeerConnection = Connection
        }
        return (await import('../vendor/webtorrent.min.js')).default
    })())
}

// The chat client. /api/turn (functions/api/turn.js) hands out ICE servers
// with short-lived TURN credentials, or none (no relay deployed, the
// month's cap reached, the dev server without a key); then it connects
// directly only, as before. Connections try direct paths first and relay
// only when none works.
let chatting = null
export const getChatClient = () => (chatting ??= startChatClient())

const STUN = { urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] }

// { iceServers, ttl } from /api/turn (the site's own, beside the page; the
// browser extension names the site's in config.turn); iceServers is empty
// when there is no relay to be had, and `off` says none is deployed at all.
async function relayServers() {
    try {
        const response = await fetch(config.turn || './api/turn', { cache: 'no-store', signal: AbortSignal.timeout(4000) })
        if (!response.headers.get('content-type')?.includes('json')) return { iceServers: [], off: true }
        const { iceServers, ttl, reason } = await response.json()
        return { iceServers: Array.isArray(iceServers) ? iceServers : [], ttl: Number(ttl) || 3600, off: reason === 'off' }
    } catch {
        return { iceServers: [], ttl: 0, off: false }
    }
}

async function startChatClient() {
    const [relay] = await Promise.all([relayServers(), loadWebTorrent()])
    if (relay.off) return startClient()
    // The trackers read this object for every connection they make, so new
    // credentials go into it in place; connections already open are given
    // them too (setConfiguration), so none is cut when the old ones expire.
    const rtcConfig = { iceServers: [STUN, ...relay.iceServers] }
    // Fresh credentials at three quarters of their life; with none, ask
    // again every 5 minutes (a slow answer, or the month's cap).
    const renew = (current) =>
        setTimeout(
            async () => {
                const next = await relayServers()
                if (next.iceServers.length) {
                    rtcConfig.iceServers = [STUN, ...next.iceServers]
                    for (const pc of relayed) {
                        try {
                            pc.setConfiguration({ ...pc.getConfiguration(), iceServers: rtcConfig.iceServers })
                        } catch {}
                    }
                }
                renew(next)
            },
            current.iceServers.length ? Math.max(current.ttl * 0.75, 60) * 1000 : 300000
        )
    renew(relay)
    return startClient({ tracker: { rtcConfig } })
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
