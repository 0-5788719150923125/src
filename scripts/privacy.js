// The extension's privacy promises, checked in a real browser (PRIVACY.md):
// `node main.js --privacy chromium|firefox|all`. It loads the built
// extension into a fresh, headless profile, opens a page of text fields
// and a page that answers private questions from one line it holds, types
// into each field, and checks
//   - a plain text area gets ghost text, and Tab keeps a word of it,
//   - none shows in password, personal-detail, search, code-editor or
//     opted-out fields, or with text after the caret, and Tab is left to
//     the page there,
//   - typing the start of the held line, the ghost goes on with the
//     answering page's words, asked privately,
//   - nothing typed is kept in any storage the extension or the page has,
//   - nothing typed is sent in the clear: every HTTP request, WebSocket
//     frame and WebRTC message the extension sent meanwhile is searched.
// Chromium (or Chrome) is driven over the DevTools protocol, Firefox over
// WebDriver BiDi, with Node alone. Each run downloads the model (137 MB)
// into its fresh profile, as a new install does, and reaches the public
// trackers, as the extension does.

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { ROOT } from './build.js'
import { GECKO_ID } from './extension.js'

const MODEL_WAIT = 300000 // ms for the first ghost: the model downloads
const PEER_WAIT = 120000 // ms for a peer to answer private questions
const SETTLE = 4000 // ms a field is watched for a ghost after typing
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ------------------------------------------------------------ the pages

// Each field, what is typed in it, and what it is. Every text has a word
// of its own, searched for in storage and on the wire afterwards. Ghosts
// may show in the first and the last; the last is the held line's start.
// prettier-ignore
const FIELDS = [
    ['control', '<textarea id="control"></textarea>',
        'Dear Marguerite, thank you so much for the quokka marmalade. It was ',
        'a plain text area'],
    ['password', '<input id="password" type="password">',
        'Wexford gooseberry lantern', 'a password field'],
    ['card', '<input id="card" autocomplete="cc-number">',
        'I will pay the tamarillo invoice on ', 'a card number field'],
    ['email', '<input id="email" autocomplete="email">',
        'my address for the kumquat club is ', 'an email field (autocomplete)'],
    ['typed-email', '<input id="typed-email" type="email">',
        'write to the persimmon desk at ', 'an email field (type)'],
    ['address', '<textarea id="address" autocomplete="street-address"></textarea>',
        'Deliver the rambutan crates to ', 'a street address field'],
    ['code', '<input id="code" autocomplete="one-time-code">',
        'the jabuticaba code is ', 'a one-time code field'],
    ['search', '<input id="search" type="search">',
        'where can I buy feijoa jam in ', 'a search box'],
    ['combobox', '<input id="combobox" role="combobox">',
        'flights to the sapodilla islands in ', 'a combobox'],
    ['editor', '<div class="cm-editor"><textarea id="editor"></textarea></div>',
        'the mangosteen function returns ', 'a code editor'],
    ['opted-out', '<textarea id="opted-out" data-src-ghost="off"></textarea>',
        'Please ask the cherimoya team whether ', 'a field the page opted out'],
    ['middle', '<textarea id="middle">\n\nKind regards</textarea>',
        'I hope the soursop harvest went ', 'text after the caret'],
    ['memory', [1, 2, 3].map((i) => `<textarea id="memory-${i}"></textarea>`).join(''),
        'In his log the keeper Tregarthen wrote that the jam tasted of b',
        'a plain text area, the held line']
].map(([id, html, text, what]) => ({ id, html, text, what }))

// What the answering page holds: the last field's text goes on with it.
const HELD =
    '\nIn his log the keeper Tregarthen wrote that the jam tasted of burnt saffron and thunder\n'
const NEXT = 'urnt' // the held word's rest, after the typed b

// The words searched for: each field's own, and what the ghost takes from
// the answering page (once in the field, it is typed text like the rest).
// prettier-ignore
const MARKERS = [
    'Marguerite', 'quokka', 'gooseberry', 'tamarillo', 'kumquat',
    'persimmon', 'rambutan', 'jabuticaba', 'feijoa', 'sapodilla',
    'mangosteen', 'cherimoya', 'soursop', 'Tregarthen', 'saffron'
]

const FIELDS_PAGE = `<!doctype html><meta charset="utf-8"><title>Privacy check</title>
<style>body{font:16px sans-serif;width:640px}textarea,input{display:block;width:600px;margin:8px 0}textarea{height:80px}</style>
${FIELDS.map((f) => f.html).join('\n')}`

// A peer that answers private questions as every tab of the site does
// (src/js/answering.js), from HELD alone, with the site's own modules.
const ANSWER_PAGE = (
    trackers
) => `<!doctype html><meta charset="utf-8"><title>Answering peer</title>
<script type="module">
import WebTorrent from '/vendor/webtorrent.min.js'
import { ANSWERED, createAnswerer, privateExtension, swarmFile } from '/js/private.js'
const answerer = createAnswerer()
await answerer.load(${JSON.stringify(HELD)})
const Private = privateExtension((message, wire) => {
    if (ANSWERED.has(message.type)) answerer.handle(message, wire)
})
const torrent = new WebTorrent().seed(swarmFile(), { announce: ${JSON.stringify(trackers)} })
torrent.on('wire', (wire) => wire.use(Private))
window.answering = () => ({ peers: torrent.numPeers, questions: answerer.stats.questions })
</script>`

// The two pages, and the site's modules the answering page imports.
function serve(dir) {
    const trackers = JSON.parse(
        /"trackers":(\[[^\]]*\])/.exec(
            fs.readFileSync(path.join(dir, 'host.html'), 'utf8')
        )[1]
    )
    const pages = { '/': FIELDS_PAGE, '/answer': ANSWER_PAGE(trackers) }
    const server = http.createServer((req, res) => {
        const { pathname } = new URL(req.url, 'http://localhost')
        const module =
            /^\/(js|vendor)\/[\w.-]+\.js$/.test(pathname) &&
            path.join(ROOT, 'src', pathname)
        if (pages[pathname]) {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            res.end(pages[pathname])
        } else if (module && fs.existsSync(module)) {
            res.writeHead(200, { 'content-type': 'text/javascript' })
            res.end(fs.readFileSync(module))
        } else {
            res.writeHead(404)
            res.end()
        }
    })
    return new Promise((resolve) =>
        server.listen(0, '127.0.0.1', () =>
            resolve({
                server,
                url: `http://127.0.0.1:${server.address().port}/`
            })
        )
    )
}

// ------------------------------------------------------------ in the browser

// Wraps every way a context can send (fetch, XMLHttpRequest, sendBeacon,
// WebSocket, RTCDataChannel) to count what goes and look in it for the
// markers. Run in the extension's own contexts; `g` is the global to wrap
// (Firefox wraps the background page from the terminal's page).
const TAP = `((g = globalThis) => {
    if (g.__srcTap) return true
    const enc = new TextEncoder()
    const utf16 = (s) => new Uint8Array(Uint16Array.from(s, (c) => c.charCodeAt(0)).buffer)
    const forms = ${JSON.stringify(MARKERS)}
        .flatMap((m) => [m, m.toLowerCase()])
        .flatMap((m) => [[m, enc.encode(m)], [m, utf16(m)]])
    const tap = (g.__srcTap = { sent: {}, bytes: {}, hits: [] })
    const has = (hay, needle) => {
        outer: for (let i = 0; i + needle.length <= hay.length; i++) {
            for (let j = 0; j < needle.length; j++)
                if (hay[i + j] !== needle[j]) continue outer
            return true
        }
        return false
    }
    const look = (kind, bytes) => {
        tap.bytes[kind] = (tap.bytes[kind] || 0) + bytes.length
        for (const [m, form] of forms)
            if (has(bytes, form)) tap.hits.push(kind + ': ' + m)
    }
    const note = (kind, ...parts) => {
        tap.sent[kind] = (tap.sent[kind] || 0) + 1
        for (const data of parts) {
            if (data == null) continue
            if (typeof data === 'string') look(kind, enc.encode(data))
            else if (data instanceof ArrayBuffer) look(kind, new Uint8Array(data))
            else if (ArrayBuffer.isView(data))
                look(kind, new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
            else if (typeof data.arrayBuffer === 'function')
                data.arrayBuffer().then((b) => look(kind, new Uint8Array(b)))
            else look(kind, enc.encode(String(data)))
        }
    }
    const wrap = (proto, name, kind, parts) => {
        if (!proto?.[name]) return
        const original = proto[name]
        proto[name] = function (...args) {
            note(kind, ...parts.call(this, ...args))
            return original.apply(this, args)
        }
    }
    wrap(g, 'fetch', 'http', (input, init) => [
        input?.url ?? String(input),
        init?.body ?? (input?.clone ? input.clone() : null)
    ])
    const xhr = g.XMLHttpRequest?.prototype
    if (xhr) {
        const open = xhr.open
        xhr.open = function (method, url, ...rest) {
            this.__srcUrl = String(url)
            return open.call(this, method, url, ...rest)
        }
        wrap(xhr, 'send', 'http', function (body) {
            return [this.__srcUrl, body]
        })
    }
    wrap(g.navigator, 'sendBeacon', 'http', (url, data) => [String(url), data])
    wrap(g.WebSocket?.prototype, 'send', 'websocket', (data) => [data])
    wrap(g.RTCDataChannel?.prototype, 'send', 'webrtc', (data) => [data])
    return true
})`

// Everything a context keeps where pages and extensions keep things, as
// [place, text] pairs: Web Storage, IndexedDB, Cache Storage's addresses,
// the file system's names, the extension's storage areas, cookies.
const DUMP = `(async (g = globalThis) => {
    const found = []
    const text = (value) => {
        if (typeof value === 'string') return value
        if (value instanceof ArrayBuffer || ArrayBuffer.isView(value))
            return new TextDecoder().decode(value)
        if (typeof Blob !== 'undefined' && value instanceof Blob) return '(blob)'
        return JSON.stringify(value, (k, v) =>
            v instanceof ArrayBuffer || ArrayBuffer.isView(v)
                ? new TextDecoder().decode(v)
                : v)
    }
    const add = (place, value) => found.push([place, text(value) ?? ''])
    for (const name of ['localStorage', 'sessionStorage']) {
        const store = g[name] // none in a service worker
        for (let i = 0; i < (store?.length ?? 0); i++)
            add(name, store.key(i) + ' = ' + store.getItem(store.key(i)))
    }
    for (const { name } of await g.indexedDB.databases()) {
        const db = await new Promise((resolve, reject) => {
            const open = g.indexedDB.open(name)
            open.onsuccess = () => resolve(open.result)
            open.onerror = () => reject(open.error)
        })
        for (const store of db.objectStoreNames) {
            const all = db.transaction(store).objectStore(store).getAll()
            await new Promise((resolve) => (all.onsuccess = all.onerror = resolve))
            for (const value of all.result ?? []) add('IndexedDB ' + name, value)
        }
        db.close()
    }
    for (const key of await g.caches.keys())
        for (const request of await (await g.caches.open(key)).keys())
            add('Cache Storage ' + key, request.url)
    if (g.navigator.storage?.getDirectory) {
        const walk = async (dir, at) => {
            for await (const [name, entry] of dir.entries()) {
                add('file system', at + name)
                if (entry.kind === 'directory') await walk(entry, at + name + '/')
            }
        }
        await walk(await g.navigator.storage.getDirectory(), '/')
    }
    const storage = g.browser?.storage ?? g.chrome?.storage
    for (const area of ['local', 'session', 'sync'])
        if (storage?.[area]) add('storage.' + area, await storage[area].get(null))
    if (g.document) add('cookies', g.document.cookie)
    return found
})`

// The private questions' part of the terminal's ticker: { peers, ready,
// asked, answered... }, or null.
const STATUS = `(() => {
    const text = document.querySelector('#state span')?.textContent
    return text ? (JSON.parse(text).private ?? null) : null
})()`

// The markers found in [place, text] pairs, as "place: marker".
const hitsIn = (pairs) =>
    pairs.flatMap(([place, text]) =>
        MARKERS.filter((m) => text.toLowerCase().includes(m.toLowerCase())).map(
            (m) => `${place}: ${m}`
        )
    )

// The kind of place a dumped entry came from.
const placeOf = (place) =>
    /^(the page's )?(localStorage|sessionStorage|IndexedDB|Cache Storage|file system|storage\.\w+|cookies)/.exec(
        place
    )?.[0] ?? place

// ------------------------------------------------------------ browsers

function findBrowser(kind) {
    const variable = kind === 'firefox' ? 'FIREFOX' : 'CHROMIUM'
    if (process.env[variable]) return process.env[variable]
    const names =
        kind === 'firefox'
            ? ['firefox', '/Applications/Firefox.app/Contents/MacOS/firefox']
            : [
                  'chromium',
                  'chromium-browser',
                  'google-chrome-stable',
                  'google-chrome',
                  'chrome',
                  '/Applications/Chromium.app/Contents/MacOS/Chromium',
                  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
              ]
    const dirs = (process.env.PATH || '').split(path.delimiter)
    for (const name of names) {
        const found = path.isAbsolute(name)
            ? [name]
            : dirs.map((dir) => path.join(dir, name))
        const file = found.find((f) => fs.existsSync(f))
        if (file) return file
    }
    return null
}

// Chromium over the DevTools protocol, on a pipe (fds 3 and 4). The
// extension's background is its service worker and its offscreen document
// (host.html, with the model's worker); all are tapped and watched.
async function chromium(binary, dir, profile) {
    const child = spawn(
        binary,
        [
            '--headless=new',
            '--remote-debugging-pipe',
            '--enable-unsafe-extension-debugging',
            `--user-data-dir=${profile}`,
            '--mute-audio',
            '--no-first-run',
            '--no-default-browser-check',
            'about:blank'
        ],
        { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] }
    )
    let buffer = ''
    let next = 0
    const waiting = new Map()
    const network = {
        sent: { http: 0, websocket: 0 },
        bytes: { http: 0, websocket: 0 },
        texts: []
    }
    const watched = new Set() // sessions whose network is searched
    const tapped = [] // sessions whose taps are read
    const send = (method, params = {}, sessionId) =>
        new Promise((resolve, reject) => {
            const id = ++next
            waiting.set(id, { resolve, reject })
            child.stdio[3].write(
                `${JSON.stringify({ id, method, params, sessionId })}\0`
            )
        })
    const evaluate = async (session, expression) => {
        const { result, exceptionDetails } = await send(
            'Runtime.evaluate',
            { expression, awaitPromise: true, returnByValue: true },
            session
        )
        if (exceptionDetails)
            throw new Error(
                exceptionDetails.exception?.description ?? exceptionDetails.text
            )
        return result.value
    }
    const attach = async (targetId) =>
        (await send('Target.attachToTarget', { targetId, flatten: true }))
            .sessionId
    const watch = async (session) => {
        watched.add(session)
        await send('Network.enable', {}, session).catch((err) =>
            console.warn(
                `  (one context's network is not watched: ${err.message})`
            )
        )
    }
    const tap = async (session) => {
        await evaluate(session, `${TAP}()`)
        tapped.push(session)
    }
    const onEvent = async ({ method, params, sessionId }) => {
        if (!watched.has(sessionId) && method !== 'Target.attachedToTarget')
            return
        if (method === 'Network.requestWillBeSent') {
            let body = params.request.postData ?? ''
            if (params.request.hasPostData && !body)
                body = (
                    await send(
                        'Network.getRequestPostData',
                        { requestId: params.requestId },
                        sessionId
                    ).catch((err) => {
                        console.warn(
                            `  (a request's body was gone: ${err.message}; its address is still searched)`
                        )
                        return { postData: '' }
                    })
                ).postData
            network.sent.http++
            network.bytes.http += params.request.url.length + body.length
            network.texts.push(['HTTP', `${params.request.url}\n${body}`])
        } else if (method === 'Network.webSocketFrameSent') {
            network.sent.websocket++
            network.bytes.websocket += params.response.payloadData.length
            network.texts.push(['WebSocket', params.response.payloadData])
        } else if (method === 'Target.attachedToTarget') {
            // A worker of the offscreen document's: the model's among them.
            await watch(params.sessionId)
            await tap(params.sessionId).catch((err) =>
                console.warn(`  (a worker is not tapped: ${err.message})`)
            )
        }
    }
    child.stdio[4].on('data', (data) => {
        buffer += data
        for (let end; (end = buffer.indexOf('\0')) >= 0;) {
            const message = JSON.parse(buffer.slice(0, end))
            buffer = buffer.slice(end + 1)
            const call = waiting.get(message.id)
            if (!call) onEvent(message)
            else {
                waiting.delete(message.id)
                if (message.error) call.reject(new Error(message.error.message))
                else call.resolve(message.result)
            }
        }
    })
    const version = (await send('Browser.getVersion')).product.replace('/', ' ')
    const { id } = await send('Extensions.loadUnpacked', { path: dir })
    const stored = [] // the service worker's and host.html's sessions
    for (
        const end = Date.now() + 30000;
        !stored.length && Date.now() < end;
        await sleep(200)
    ) {
        const { targetInfos } = await send('Target.getTargets')
        const host = targetInfos.find((t) =>
            t.url.startsWith(`chrome-extension://${id}/host.html`)
        )
        const worker = targetInfos.find(
            (t) => t.url === `chrome-extension://${id}/background.js`
        )
        if (!host || !worker) continue
        for (const target of [worker, host]) {
            const session = await attach(target.targetId)
            await watch(session)
            await tap(session)
            stored.push(session)
        }
        await send(
            'Target.setAutoAttach',
            { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
            stored[1]
        )
    }
    if (!stored.length)
        throw new Error("the extension's background did not open")

    const open = async (url, { mine = false } = {}) => {
        const session = await attach(
            (await send('Target.createTarget', { url: 'about:blank' })).targetId
        )
        await send('Page.enable', {}, session)
        await send(
            'Emulation.setFocusEmulationEnabled',
            { enabled: true },
            session
        )
        if (mine) await watch(session)
        await send('Page.navigate', { url }, session)
        for (
            let i = 0;
            i < 100 &&
            !(await evaluate(session, 'document.readyState === "complete"'));
            i++
        )
            await sleep(100)
        const key = (type, key, extra = {}) =>
            send('Input.dispatchKeyEvent', { type, key, ...extra }, session)
        return {
            session,
            eval: (expression) => evaluate(session, expression),
            async type(text, pause = 15) {
                for (const ch of text) {
                    await key('keyDown', ch, { text: ch })
                    await key('keyUp', ch)
                    await sleep(pause)
                }
            },
            async tab() {
                const tab = { code: 'Tab', windowsVirtualKeyCode: 9 }
                await key('keyDown', 'Tab', tab)
                await key('keyUp', 'Tab', tab)
            }
        }
    }
    // The terminal, whose ticker shows how private questions go.
    const terminal = await open(`chrome-extension://${id}/popup.html`, {
        mine: true
    })
    await tap(terminal.session)
    return {
        version,
        open,
        status: () => terminal.eval(STATUS),
        async storage() {
            const pairs = []
            for (const session of stored)
                pairs.push(...(await evaluate(session, `${DUMP}()`)))
            return pairs
        },
        async wire() {
            const taps = []
            for (const session of tapped)
                taps.push(
                    await evaluate(session, 'globalThis.__srcTap').catch(
                        (err) => {
                            console.warn(
                                `  (a context had ended, its taps unread: ${err.message})`
                            )
                            return null
                        }
                    )
                )
            return { taps: taps.filter(Boolean), network }
        },
        notes: [],
        close: () => child.kill()
    }
}

// Firefox over WebDriver BiDi. The background page is reached from the
// terminal's page, opened in a tab (browser.runtime.getBackgroundPage);
// scripting extension pages needs MOZ_REMOTE_ALLOW_SYSTEM_ACCESS.
async function firefox(binary, dir, profile) {
    const uuid = randomUUID()
    fs.writeFileSync(
        path.join(profile, 'user.js'),
        [
            [
                'extensions.webextensions.uuids',
                JSON.stringify({ [GECKO_ID]: uuid })
            ],
            ['media.volume_scale', '0.0'],
            ['browser.shell.checkDefaultBrowser', false],
            ['datareporting.policy.dataSubmissionEnabled', false],
            ['toolkit.telemetry.reportingpolicy.firstRun', false]
        ]
            .map(
                ([k, v]) =>
                    `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`
            )
            .join('\n')
    )
    const child = spawn(
        binary,
        [
            '--headless',
            '--remote-debugging-port=0',
            '--profile',
            profile,
            '--no-remote',
            'about:blank'
        ],
        {
            stdio: ['ignore', 'ignore', 'pipe'],
            env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' }
        }
    )
    const address = await new Promise((resolve, reject) => {
        let seen = ''
        child.stderr.on('data', (data) => {
            seen += data
            const found = /WebDriver BiDi listening on (ws:\/\/\S+)/.exec(seen)
            if (found) resolve(found[1])
        })
        child.on('exit', () =>
            reject(new Error(`Firefox exited: ${seen.slice(-400)}`))
        )
    })
    const socket = new WebSocket(`${address}/session`)
    await new Promise((resolve, reject) => {
        socket.onopen = resolve
        socket.onerror = () => reject(new Error('no WebDriver BiDi connection'))
    })
    let next = 0
    const waiting = new Map()
    const network = { sent: { http: 0 }, bytes: { http: 0 }, texts: [] }
    const watched = new Set() // contexts whose requests are searched
    socket.onmessage = ({ data }) => {
        const message = JSON.parse(data)
        const call = waiting.get(message.id)
        if (call) {
            waiting.delete(message.id)
            if (message.type === 'error')
                call.reject(new Error(`${message.error}: ${message.message}`))
            else call.resolve(message.result)
        } else if (
            message.method === 'network.beforeRequestSent' &&
            watched.has(message.params.context)
        ) {
            network.sent.http++
            network.bytes.http += message.params.request.url.length
            network.texts.push(['HTTP', message.params.request.url])
        }
    }
    const send = (method, params = {}) =>
        new Promise((resolve, reject) => {
            const id = ++next
            waiting.set(id, { resolve, reject })
            socket.send(JSON.stringify({ id, method, params }))
        })
    const evaluate = async (context, expression) => {
        const result = await send('script.evaluate', {
            expression: `(async () => JSON.stringify(await (${expression})))()`,
            target: { context },
            awaitPromise: true,
            resultOwnership: 'none'
        })
        if (result.type === 'exception')
            throw new Error(result.exceptionDetails.text)
        const { value } = result.result
        return value === undefined ? undefined : JSON.parse(value)
    }
    const { capabilities } = await send('session.new', { capabilities: {} })
    await send('session.subscribe', { events: ['network.beforeRequestSent'] })
    await send('webExtension.install', {
        extensionData: { type: 'path', path: dir }
    })
    const open = async (url, { mine = false } = {}) => {
        const { context } = await send('browsingContext.create', {
            type: 'tab'
        })
        if (mine) watched.add(context)
        await send('browsingContext.navigate', {
            context,
            url,
            wait: 'complete'
        })
        const keys = async (values) => {
            await send('browsingContext.activate', { context })
            await send('input.performActions', {
                context,
                actions: [
                    {
                        type: 'key',
                        id: 'keyboard',
                        actions: values.flatMap((value) => [
                            { type: 'keyDown', value },
                            { type: 'keyUp', value }
                        ])
                    }
                ]
            })
        }
        return {
            eval: (expression) => evaluate(context, expression),
            async type(text, pause = 15) {
                for (const ch of text) {
                    await keys([ch])
                    await sleep(pause)
                }
            },
            tab: () => keys([''])
        }
    }
    const terminal = await open(`moz-extension://${uuid}/popup.html`, {
        mine: true
    })
    const BG = 'browser.runtime.getBackgroundPage()'
    await terminal.eval(`${BG}.then((bg) => ${TAP}(bg))`)
    await terminal.eval(`${TAP}()`)
    return {
        version: `Firefox ${capabilities.browserVersion}`,
        open,
        status: () => terminal.eval(STATUS),
        storage: async () => [
            ...(await terminal.eval(`${BG}.then((bg) => ${DUMP}(bg))`)),
            ...(await terminal.eval(`${DUMP}()`))
        ],
        wire: async () => ({
            taps: [
                await terminal.eval(`${BG}.then((bg) => bg.__srcTap)`),
                await terminal.eval('globalThis.__srcTap')
            ],
            network
        }),
        notes: [
            "the model's worker is not tapped in Firefox (it fetches only the model's files)"
        ],
        close: () => {
            socket.close()
            child.kill()
        }
    }
}

// ------------------------------------------------------------ the checks

export async function checkPrivacy(kind, dir) {
    const binary = findBrowser(kind)
    if (!binary) {
        console.log(
            `[privacy] ${kind}: no browser found (set ${kind === 'firefox' ? 'FIREFOX' : 'CHROMIUM'} to its path)`
        )
        return null
    }
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'src-privacy-'))
    const { server, url } = await serve(dir)
    const results = []
    const check = (ok, what) => {
        results.push(ok)
        console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`)
    }
    const until = async (ok, ms) => {
        for (const end = Date.now() + ms; Date.now() < end; await sleep(250))
            if (await ok()) return true
        return false
    }
    let browser = null
    try {
        browser = await (kind === 'firefox' ? firefox : chromium)(
            binary,
            dir,
            profile
        )
        console.log(
            `[privacy] ${browser.version}, the extension in ${path.relative(ROOT, dir)}`
        )
        const answering = await browser.open(`${url}answer`)
        const page = await browser.open(url, { mine: true })
        const id = (field) => JSON.stringify(field.id)
        const value = (field) =>
            page.eval(`document.getElementById(${id(field)}).value`)
        const ghost = () =>
            page.eval(
                `[...document.querySelectorAll('src-ghost')].some((h) => h.matches(':popover-open'))`
            )
        const typeInto = async (field, pause) => {
            await page.eval(`(() => {
                const el = document.getElementById(${id(field)})
                el.focus()
                if (el.value) el.setSelectionRange(0, 0) // text after the caret
                return true
            })()`)
            await page.type(field.text, pause)
        }
        // A field where a ghost may show: whether one shows (and how soon),
        // and the field's text before and after a Tab.
        const shows = async (field, wait, { pause, settle } = {}) => {
            await typeInto(field, pause)
            const started = Date.now()
            let seen = await until(ghost, wait)
            const took = ` (${((Date.now() - started) / 1000).toFixed(1)} s)`
            if (seen && settle) {
                await settle()
                await sleep(1500) // for a rewrite the answers set off
                seen = await until(ghost, 10000)
            }
            const before = await value(field)
            if (seen) await page.tab()
            await sleep(300)
            const after = await value(field)
            return { seen, took, kept: after.slice(before.length) }
        }
        const keeps = ({ seen, took, kept }, field) =>
            check(
                seen && kept.length > 0,
                `${field.what} gets ghost text, and Tab keeps it` +
                    (seen ? took : '')
            )
        const [first, ...rest] = FIELDS
        const last = rest.pop()
        console.log(
            '  (the first ghost waits for the model to download and start)'
        )
        keeps(await shows(first, MODEL_WAIT), first)
        for (const field of rest) {
            await typeInto(field)
            await sleep(SETTLE)
            const seen = await ghost()
            const before = await value(field)
            await page.tab()
            await sleep(300)
            const taken = (await value(field)) !== before
            check(
                !seen && !taken,
                `no ghost text in ${field.what}, and Tab is left to the page`
            )
        }

        // The held line: once a peer can answer privately, its words go
        // out as private questions, and the ghost goes on with its line.
        console.log('  (waiting for a peer to answer private questions)')
        const status = () => browser.status()
        const ready = await until(
            async () => (await status())?.ready > 0,
            PEER_WAIT
        )
        const asked = (await status())?.asked ?? 0
        const questions = async () =>
            (await answering.eval('window.answering?.()'))?.questions ?? 0
        const heard = await questions()
        // At a typist's pace: a peer answers 4 questions a second at most
        // from one connection, and each word start is one. Tab once the
        // questions are answered (nothing new for 2 s): browsers without
        // threads (Firefox's extension pages) make them more slowly.
        const settle = async () => {
            let then = null
            let since = Date.now()
            for (
                let end = Date.now() + 20000;
                Date.now() < end;
                await sleep(250)
            ) {
                const now = JSON.stringify(await status())
                if (now !== then) [then, since] = [now, Date.now()]
                else if (Date.now() - since >= 2000) return
            }
        }
        // Tokens are drawn, and the memory weighs on each draw without
        // deciding it, so the model may stray now and then: up to three
        // fields, for the held word.
        let got = null
        for (let i = 1; i <= 3 && !got?.kept.startsWith(NEXT); i++)
            got = await shows({ ...last, id: `${last.id}-${i}` }, 60000, {
                pause: 90,
                settle
            })
        keeps(got, last)
        if (ready) {
            const now = await status()
            const answered = (await questions()) - heard
            check(
                got.kept.startsWith(NEXT) && answered > 0,
                `the ghost goes on with what another peer holds ("${got.kept}"), ` +
                    `asked privately: ${now.asked - asked} question(s) to ${now.ready} peer(s), ` +
                    `${answered} to the answering page`
            )
        } else {
            console.log(
                '  skip no peer could answer private questions within 2 minutes (are the trackers reachable?); ' +
                    'tests/privacy.test.js checks what a question carries'
            )
        }
        await sleep(3000) // for anything the typing set off

        const pairs = [
            ...(await browser.storage()),
            ...(await page.eval(`${DUMP}()`)).map(([place, text]) => [
                `the page's ${place}`,
                text
            ])
        ]
        const kept = hitsIn(pairs)
        const places = {}
        for (const [place] of pairs)
            places[placeOf(place)] = (places[placeOf(place)] || 0) + 1
        check(
            !kept.length,
            `nothing typed is kept: searched ${pairs.length} entries (` +
                Object.entries(places)
                    .map(([place, n]) => `${place} ${n}`)
                    .join(', ') +
                ')' +
                (kept.length ? `; found ${kept.join('; ')}` : '')
        )

        const { taps, network } = await browser.wire()
        const sent = { ...network.sent }
        const bytes = { ...network.bytes }
        const hits = hitsIn(network.texts)
        for (const tap of taps) {
            for (const [kind, n] of Object.entries(tap.sent))
                sent[kind] = (sent[kind] || 0) + n
            for (const [kind, n] of Object.entries(tap.bytes))
                bytes[kind] = (bytes[kind] || 0) + n
            hits.push(...tap.hits)
        }
        const counted = Object.entries(sent)
            .map(
                ([kind, n]) =>
                    `${n} ${kind} (${((bytes[kind] || 0) / 1e3).toFixed(0)} kB)`
            )
            .join(', ')
        check(
            !hits.length,
            `nothing typed is sent in the clear: searched ${counted}` +
                (hits.length ? `; found ${[...new Set(hits)].join('; ')}` : '')
        )
        for (const note of browser.notes) console.log(`  note: ${note}`)
    } catch (err) {
        check(false, `the check could not finish: ${err.message}`)
    } finally {
        browser?.close()
        server.close()
        await sleep(1500) // for the browser to let go of its profile
        fs.rmSync(profile, { recursive: true, force: true })
    }
    return results.every(Boolean)
}
