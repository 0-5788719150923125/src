import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { ROOT } from '../scripts/build.js'
import { VENDOR, extensionConfig, extensionWorker, hostPage, locales, manifest, pack, terminalPage } from '../scripts/extension.js'
import { amoToken, listing, publish } from '../scripts/stores.js'
import { unzip, zip } from '../scripts/zip.js'

test('a zip holds what went in, and the same files make the same bytes', () => {
    const files = [
        ['a.txt', Buffer.from('hello hello hello hello hello hello')],
        ['dir/b.bin', crypto.randomBytes(1000)],
        ['empty', Buffer.alloc(0)],
        ['\u00fcn\u00efcode.md', Buffer.from('# hi\n')]
    ]
    const archive = zip(files)
    assert.deepEqual(
        unzip(archive).map(([name, data]) => [name, data.toString('hex')]),
        files.map(([name, data]) => [name, data.toString('hex')])
    )
    assert.ok(zip(files).equals(archive))
})

test('the manifests: Chrome on Manifest V3, Firefox on V2 with a persistent background', () => {
    const chrome = manifest('chromium', { version: '4.1.0' })
    assert.equal(chrome.manifest_version, 3)
    assert.equal(chrome.version, '4.1.0')
    assert.equal(chrome.background.service_worker, 'background.js')
    assert.ok(chrome.permissions.includes('offscreen'))
    assert.deepEqual(chrome.host_permissions, ['https://src.eco/*'])
    assert.equal(chrome.cross_origin_embedder_policy.value, 'require-corp')
    assert.equal(chrome.action.default_popup, 'popup.html')
    assert.equal(chrome.side_panel.default_path, 'panel.html')

    const firefox = manifest('firefox', { version: '4.1.0', site: 'https://dev.src.eco/', geckoId: 'x@y' })
    assert.equal(firefox.manifest_version, 2)
    assert.deepEqual(firefox.background, { page: 'host.html', persistent: true })
    assert.equal(firefox.browser_action.default_popup, 'popup.html')
    assert.ok(firefox.permissions.includes('https://dev.src.eco/*'))
    assert.equal(firefox.browser_specific_settings.gecko.id, 'x@y')
    assert.ok(firefox.browser_specific_settings.gecko.data_collection_permissions.required.length)

    for (const m of [chrome, firefox]) {
        const csp = m.content_security_policy.extension_pages ?? m.content_security_policy
        // Nothing but the extension's own scripts, and WebAssembly.
        assert.equal(csp, "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'")
        const [script] = m.content_scripts
        assert.deepEqual(script.matches, ['<all_urls>'])
        assert.equal(script.run_at, 'document_start')
        assert.equal(script.all_frames, true)
        assert.equal(m.name, '__MSG_name__')
    }
    assert.throws(() => manifest('safari', {}))
})

test('the browser lists it in words from extension.md, within the stores\' limits', () => {
    const { en } = locales()
    assert.equal(en.name.message, 'The Source')
    assert.ok(en.name.message.length <= 75)
    assert.ok(en.description.message.length <= 132, `${en.description.message.length} characters`)
    assert.ok(en.action.message)
    const { summary, description } = listing()
    assert.ok(summary['en-US'].length <= 250, `${summary['en-US'].length} characters`)
    assert.ok(description['en-US'].includes('Privacy'))
})

test('the content script packs into one classic script', () => {
    const script = pack(path.join(ROOT, 'extension', 'page.js'))
    assert.doesNotMatch(script, /^\s*(import|export)\s/m)
    assert.match(script, /function ahead\(/)
    new vm.Script(script) // it parses as a script
    // Run it with no extension around: it does nothing, and throws nothing.
    vm.runInNewContext(script, { globalThis: {} })

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-'))
    fs.writeFileSync(path.join(dir, 'leaf.js'), 'export const a = 1\nexport function b() { return a + 1 }\n')
    fs.writeFileSync(path.join(dir, 'deep.js'), "import { a } from './leaf.js'\nexport const c = a\n")
    fs.writeFileSync(path.join(dir, 'ok.js'), "import { b } from './leaf.js'\nglobalThis.out = b()\n")
    fs.writeFileSync(path.join(dir, 'bad.js'), "import { c } from './deep.js'\n")
    fs.writeFileSync(path.join(dir, 'missing.js'), "import { zz } from './leaf.js'\n")
    const context = { globalThis: {} }
    context.globalThis = context
    vm.runInNewContext(pack(path.join(dir, 'ok.js')), context)
    assert.equal(context.out, 2)
    assert.throws(() => pack(path.join(dir, 'bad.js')), /must import nothing/)
    assert.throws(() => pack(path.join(dir, 'missing.js')), /does not export zz/)
})

test('the terminal pages are the site\'s, with the extension\'s additions', () => {
    const index = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8')
    const popup = terminalPage(index, 'popup')
    assert.doesNotMatch(popup, /Content-Security-Policy/)
    assert.match(popup, /<html lang="en" class="popup">/)
    assert.match(popup, /<script type="module" src="terminal\.js"><\/script>/)
    assert.doesNotMatch(popup, /js\/main\.js/)
    assert.match(popup, /href="extension\.css"/)
    assert.match(terminalPage(index, 'panel'), /class="panel"/)
    assert.throws(() => terminalPage('<html></html>', 'popup'), /changed shape/)

    const html = '<head><script id="config" type="application/json">{"seed":"","stations":{"a":{"name":"<\\/x>"}}}</script></head>'
    const configured = extensionConfig(html, { site: 'https://src.eco/' })
    const json = JSON.parse(/<script id="config" type="application\/json">(.*?)<\/script>/.exec(configured)[1])
    assert.equal(json.turn, 'https://src.eco/api/turn')
    assert.equal(json.stations.a.name, '</x>')
    assert.doesNotMatch(configured, /"<\/x>"/)
})

test('the background page gets the site\'s configuration, for the radio', () => {
    const host = fs.readFileSync(path.join(ROOT, 'extension', 'host.html'), 'utf8')
    const index = '<head><script id="config" type="application/json">{"stations":{"59.1":{"name":"$& $1"}}}</script></head>'
    const page = hostPage(host, index)
    assert.match(page, /<script id="config" type="application\/json">\{"stations":\{"59\.1":\{"name":"\$& \$1"\}\}\}<\/script>\s*<script type="module" src="host\.js">/)
    assert.throws(() => hostPage(host, '<head></head>'), /changed shape/)
    assert.throws(() => hostPage('<html></html>', index), /changed shape/)
})

test('the worker loads the vendored runtime, and the vendored one is what the site loads', () => {
    const worker = fs.readFileSync(path.join(ROOT, 'src', 'js', 'writer.worker.js'), 'utf8')
    assert.ok(worker.includes(`from '${VENDOR[0][1]}'`), 'writer.worker.js imports the transformers.js in VENDOR')
    const out = extensionWorker(worker)
    assert.match(out, /from '\.\.\/vendor\/transformers\.min\.js'/)
    assert.match(out, /const RUNTIME = '\.\.\/vendor\/ort\/'/)
    assert.doesNotMatch(out, /cdn\.jsdelivr\.net/)
    for (const [file, url, hash] of VENDOR) {
        assert.match(file, /^vendor\//)
        assert.match(url, /^https:\/\/cdn\.jsdelivr\.net\//)
        assert.match(hash, /^[0-9a-f]{64}$/)
    }
})

test('a JWT for addons.mozilla.org is signed with the secret, and short-lived', () => {
    const token = amoToken('user:1:2', 'secret', 1000)
    const [header, payload, signature] = token.split('.')
    assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'HS256', typ: 'JWT' })
    const claims = JSON.parse(Buffer.from(payload, 'base64url'))
    assert.equal(claims.iss, 'user:1:2')
    assert.equal(claims.iat, 1000)
    assert.ok(claims.exp - claims.iat <= 300)
    assert.ok(claims.jti)
    assert.equal(signature, crypto.createHmac('sha256', 'secret').update(`${header}.${payload}`).digest('base64url'))
    assert.notEqual(amoToken('user:1:2', 'secret', 1000).split('.')[1], payload) // a fresh jti each time
})

// ------------------------------------------------------------ the stores

// A fake of both stores' APIs: `routes` maps "METHOD path" to a reply.
function fakeFetch(routes) {
    const calls = []
    const fetch = async (url, init = {}) => {
        const { pathname } = new URL(url)
        const method = init.method || 'GET'
        calls.push({ method, url, pathname, headers: init.headers || {}, body: init.body })
        const route = routes[`${method} ${pathname}`]
        if (!route) return new Response('not found', { status: 404 })
        const reply = typeof route === 'function' ? route(init, calls) : route
        return new Response(JSON.stringify(reply.body ?? reply), { status: reply.status ?? 200, headers: { 'Content-Type': 'application/json' } })
    }
    return { fetch, calls }
}

function fixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stores-'))
    const chromium = path.join(dir, 'src-chromium-1.0.0.zip')
    const firefox = path.join(dir, 'src-firefox-1.0.0.zip')
    const source = path.join(dir, 'src-source-1.0.0.zip')
    for (const file of [chromium, firefox, source]) fs.writeFileSync(file, zip([['manifest.json', Buffer.from('{}')]]))
    fs.mkdirSync(path.join(dir, 'firefox'))
    fs.writeFileSync(path.join(dir, 'firefox', 'manifest.json'), JSON.stringify(manifest('firefox', { version: '1.0.0', geckoId: 'test@src' })))
    return {
        version: '1.0.0',
        built: [
            { browser: 'chromium', dir: path.join(dir, 'chromium'), archive: chromium },
            { browser: 'firefox', dir: path.join(dir, 'firefox'), archive: firefox }
        ],
        source
    }
}

const CHROME_ENV = { CHROME_EXTENSION_ID: 'abc', CHROME_PUBLISHER_ID: 'me', CHROME_CLIENT_ID: 'id', CHROME_CLIENT_SECRET: 'shh', CHROME_REFRESH_TOKEN: 'refresh' }
const AMO_ENV = { AMO_JWT_ISSUER: 'user:1:2', AMO_JWT_SECRET: 'secret' }
const quiet = { log: () => {}, pollEvery: 1, chromeBase: { token: 'https://oauth.test/token', api: 'https://cws.test' }, amoBase: 'https://amo.test' }

test('Chrome: a token, the upload, waiting for it, then the submission', async () => {
    let polls = 0
    const { fetch, calls } = fakeFetch({
        'POST /token': (init) => {
            const form = new URLSearchParams(init.body)
            assert.equal(form.get('refresh_token'), 'refresh')
            assert.equal(form.get('grant_type'), 'refresh_token')
            return { access_token: 'tok' }
        },
        'POST /upload/v2/publishers/me/items/abc:upload': { uploadState: 'IN_PROGRESS', crxVersion: '1.0.0' },
        'GET /v2/publishers/me/items/abc:fetchStatus': () => ({ lastAsyncUploadState: ++polls < 2 ? 'IN_PROGRESS' : 'SUCCEEDED' }),
        'POST /v2/publishers/me/items/abc:publish': (init) => {
            assert.equal(JSON.parse(init.body).publishType, 'DEFAULT_PUBLISH')
            return { state: 'PENDING_REVIEW' }
        }
    })
    assert.equal(await publish('chrome', { ...fixture(), yes: true, env: CHROME_ENV, fetch, ...quiet }), true)
    assert.deepEqual(
        calls.map((c) => `${c.method} ${c.pathname}`),
        ['POST /token', 'POST /upload/v2/publishers/me/items/abc:upload', 'GET /v2/publishers/me/items/abc:fetchStatus', 'GET /v2/publishers/me/items/abc:fetchStatus', 'POST /v2/publishers/me/items/abc:publish']
    )
    assert.equal(calls[1].headers.Authorization, 'Bearer tok')
    assert.ok(Buffer.isBuffer(calls[1].body))
})

test('Chrome: a failed upload is not submitted', async () => {
    const { fetch, calls } = fakeFetch({
        'POST /token': { access_token: 'tok' },
        'POST /upload/v2/publishers/me/items/abc:upload': { uploadState: 'FAILED', itemError: [{ error_detail: 'bad zip' }] }
    })
    const said = []
    assert.equal(await publish('chrome', { ...fixture(), yes: true, env: CHROME_ENV, fetch, ...quiet, log: (line) => said.push(line) }), false)
    assert.ok(!calls.some((c) => c.pathname.endsWith(':publish')))
    assert.match(said.join('\n'), /bad zip/)
})

test('Firefox: a new version of a listed add-on, validated, with its source', async () => {
    let polls = 0
    const { fetch, calls } = fakeFetch({
        'GET /api/v5/addons/addon/test%40src/': { guid: 'test@src' },
        'POST /api/v5/addons/upload/': { uuid: 'u1', processed: false },
        'GET /api/v5/addons/upload/u1/': () => ({ uuid: 'u1', processed: ++polls > 1, valid: true, validation: { messages: [] } }),
        'POST /api/v5/addons/addon/test%40src/versions/': { id: 7, version: '1.0.0' }
    })
    assert.equal(await publish('firefox', { ...fixture(), yes: true, env: AMO_ENV, fetch, ...quiet }), true)
    assert.ok(calls.every((c) => /^JWT [\w-]+\.[\w-]+\.[\w-]+$/.test(c.headers.Authorization)))
    const upload = calls.find((c) => c.pathname === '/api/v5/addons/upload/').body
    assert.equal(upload.get('channel'), 'listed')
    assert.equal(upload.get('upload').name, 'src-firefox-1.0.0.zip')
    const version = calls.find((c) => c.method === 'POST' && c.pathname.endsWith('/versions/')).body
    assert.equal(version.get('upload'), 'u1')
    assert.equal(version.get('source').name, 'src-source-1.0.0.zip')
    assert.match(version.get('approval_notes'), /node main\.js --extension/)
})

test('Firefox: the first time, the listing is made, then the source is attached', async () => {
    const { fetch, calls } = fakeFetch({
        'GET /api/v5/addons/addon/test%40src/': { status: 404, body: { detail: 'Not found.' } },
        'POST /api/v5/addons/upload/': { uuid: 'u2', processed: true, valid: true },
        'PUT /api/v5/addons/addon/test%40src/': (init) => {
            const body = JSON.parse(init.body)
            assert.equal(body.version.upload, 'u2')
            assert.equal(body.version.license, 'MIT')
            assert.match(body.version.approval_notes, /SHA-256/)
            assert.ok(body.categories.length >= 1 && body.categories.length <= 3)
            assert.ok(body.summary['en-US'])
            return { guid: 'test@src', current_version: null }
        },
        'PATCH /api/v5/addons/addon/test%40src/versions/1.0.0/': { id: 8 }
    })
    assert.equal(await publish('firefox', { ...fixture(), yes: true, env: AMO_ENV, fetch, ...quiet }), true)
    assert.equal(calls.at(-1).body.get('source').name, 'src-source-1.0.0.zip')
})

test('Firefox: an upload that does not validate stops there', async () => {
    const { fetch, calls } = fakeFetch({
        'GET /api/v5/addons/addon/test%40src/': { guid: 'test@src' },
        'POST /api/v5/addons/upload/': { uuid: 'u3', processed: true, valid: false, validation: { errors: 1, messages: [{ type: 'error', message: 'remote code' }] } }
    })
    const said = []
    assert.equal(await publish('firefox', { ...fixture(), yes: true, env: AMO_ENV, fetch, ...quiet, log: (line) => said.push(line) }), false)
    assert.ok(!calls.some((c) => c.pathname.endsWith('/versions/')))
    assert.match(said.join('\n'), /remote code/)
})

test('nothing is sent without a yes, or without credentials', async () => {
    const { fetch, calls } = fakeFetch({})
    assert.equal(await publish('all', { ...fixture(), env: { ...CHROME_ENV, ...AMO_ENV }, fetch, ...quiet, ask: async () => false }), false)
    assert.equal(await publish('all', { ...fixture(), yes: true, env: {}, fetch, ...quiet }), false)
    assert.equal(await publish('edge', { ...fixture(), yes: true, env: CHROME_ENV, fetch, ...quiet }), false)
    assert.equal(calls.length, 0)
})
