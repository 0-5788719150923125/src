// The extension's background in Chrome: a service worker, which can run
// neither a Worker, WebRTC nor audio, so it only opens the offscreen
// document where the model, the radio and the chat live (host.html), with
// the browser, at install, or when a page asks for it, and shows on the
// toolbar button what that document tells it (the model's download). Chrome allows one offscreen document,
// and keeps it open until the browser closes (or the extension reloads):
// it would close one opened for audio alone after 30 s of silence, but not
// while another of its reasons holds (WORKERS). Firefox has no service
// worker here: its background page is host.html itself.

const HOST = 'host.html'
let opening = null

const hostIsOpen = async () =>
    (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }))
        .length > 0

// Refused as "a single offscreen document" means one is there: opened
// meanwhile by another request, or, as the extension restarts (/reset),
// the old one still closing. So a refusal is checked, and the opening tried
// again until one is open, for a few seconds.
async function openHost() {
    for (let tries = 0; tries < 20 && !(await hostIsOpen()); tries++) {
        opening ??= chrome.offscreen
            .createDocument({
                url: HOST,
                reasons: ['WORKERS', 'AUDIO_PLAYBACK', 'WEB_RTC'],
                justification:
                    'Runs the small language model that writes ghost text in text fields (in a Web Worker, once for every tab), and plays the radio, whose songs come from other listeners over WebRTC, so it goes on when the popup closes.'
            })
            .catch((err) => {
                if (!/single offscreen/i.test(err.message)) throw err
            })
            .finally(() => (opening = null))
        await opening
        if (await hostIsOpen()) return
        await new Promise((resolve) => setTimeout(resolve, 250))
    }
}

// The host starts with the browser, and as the extension is installed or
// updated, so the chat and the radio run before anyone opens the popup:
// whenever this worker starts (with the browser here; the events wake it
// where it would not be started otherwise), it opens the host if closed.
const open = () =>
    openHost().catch((err) =>
        console.warn('background: could not open the host:', err.message || err)
    )
chrome.runtime.onStartup.addListener(open)
chrome.runtime.onInstalled.addListener(open)
open()

// A development install (loaded unpacked) traces the ghost's steps in page
// fields, for bug reports (page.js, host.js); the offscreen document has
// no management API to ask with, so this worker says.
chrome.management
    .getSelf()
    .then(({ installType }) =>
        chrome.storage.local.set({ tracing: installType === 'development' })
    )
    .catch((err) => console.warn('background: no install type:', err.message))

chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type === 'host') {
        openHost().then(
            () => reply(true),
            (err) => {
                console.warn(
                    'background: could not open the model:',
                    err.message || err
                )
                reply(false)
            }
        )
        return true
    }
    // /reset: a fresh host, which forgets everything as it starts (an
    // offscreen document cannot reload itself).
    if (message?.type === 'restart') {
        chrome.offscreen
            .closeDocument()
            .catch((err) =>
                console.info('background: no host to close:', err.message)
            )
            .then(openHost)
            .then(
                () => reply(true),
                (err) => {
                    console.warn(
                        'background: could not reopen the host:',
                        err.message || err
                    )
                    reply(false)
                }
            )
        return true
    }
    if (message?.type === 'badge' && typeof message.text === 'string') {
        chrome.action.setBadgeText({ text: message.text.slice(0, 4) })
        chrome.action.setBadgeBackgroundColor({ color: '#000000' })
    }
})
