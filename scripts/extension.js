// The browser extension: a second build of the site (next/extension.md).
// The terminal, exactly as on the site, opens from the toolbar button (and
// in the side panel); the same model writes ahead of you in other sites'
// text fields too (extension/page.js), running once for the whole browser
// (extension/host.js). One build per browser, from the deploy build of the
// site plus extension/:
//
//   build/extension/chromium/            load unpacked in Chrome, Edge...
//   build/extension/firefox/             about:debugging, "This Firefox"
//   build/extension/src-<browser>-<version>.zip   what the stores take
//
// Stores refuse code fetched at runtime, so what the site loads from
// jsdelivr (transformers.js, and ONNX Runtime's files it fetches in turn)
// ships inside: downloaded once at build time, checked against the hashes
// below, and kept in build/vendor/. Each is byte for byte the published
// file, so a reviewer can check it against npm. The model's weights are
// data, fetched from Hugging Face on first use, as on the site.
//
// The words the browser shows (name, description, the button's tooltip)
// come from src/text/<language>/extension.md, as _locales/.

import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, build, readText } from './build.js'
import { filesIn, zip } from './zip.js'
import { source, use } from '../src/js/text.js'

export const EXTENSION_DIR = path.join(ROOT, 'extension')
export const DEFAULT_OUT = path.join(ROOT, 'build', 'extension')
const VENDOR_CACHE = path.join(ROOT, 'build', 'vendor')
export const BROWSERS = ['chromium', 'firefox']

// Firefox knows an add-on by this id, for good: the store's listing, and
// every update, hang on it. FIREFOX_EXTENSION_ID overrides it.
export const GECKO_ID = 'src@src.eco'

// ONNX Runtime's web build that transformers.js 4.3.2 expects (its bundle
// names the version), in its CPU-only flavor: the writer never uses the
// GPU, and the default flavor's glue code calls `new Function`, which an
// extension's pages may not.
const ORT =
    'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0'
const ORT_COMMIT = '8d85527a010e294a26b274749f74294b2a32cec5'

// Code the extension ships that the site loads at runtime, and the
// licenses that go with it: [path in the extension, URL, SHA-256].
export const VENDOR = [
    [
        'vendor/transformers.min.js',
        'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js',
        '8b5a3171f8876bab2b1820a7d65eb87628e3d30bb5ea85b9dd398e76eb34decb'
    ],
    [
        'vendor/transformers.LICENSE',
        'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/LICENSE',
        'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30'
    ],
    [
        'vendor/ort/ort-wasm-simd-threaded.mjs',
        `${ORT}/dist/ort-wasm-simd-threaded.mjs`,
        'c57ca56328877353a575e51bbca6f18450027d6c9bf2307a2cb2c41363b4de9f'
    ],
    [
        'vendor/ort/ort-wasm-simd-threaded.wasm',
        `${ORT}/dist/ort-wasm-simd-threaded.wasm`,
        '06ba057753da3847e4c24f02d91ab133455b0817c69a44993a9a53a2146df9e3'
    ],
    [
        'vendor/ort/LICENSE',
        `https://cdn.jsdelivr.net/gh/microsoft/onnxruntime@${ORT_COMMIT}/LICENSE`,
        '2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c'
    ],
    // The site's copy lost its sourceMappingURL comment (scripts/vendor.js);
    // the stores get the file as published.
    [
        'vendor/webtorrent.min.js',
        'https://cdn.jsdelivr.net/npm/webtorrent@3.0.21/dist/webtorrent.min.js',
        'db4dca98cd135c732eeffdede3cf5f8febd0585a0eba4dc4d1effa1b901f4c3d'
    ],
    [
        'vendor/webtorrent.LICENSE',
        'https://cdn.jsdelivr.net/npm/webtorrent@3.0.21/LICENSE',
        '821ea8b64b4994190b94bd629bbd897ba39cd25f7fb9747b70eec61f73dee44a'
    ]
]

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

// Each vendored file, from build/vendor/ or downloaded into it. A file
// whose hash is not the one above is refused, cached or not.
export async function fetchVendor(cache = VENDOR_CACHE) {
    const files = {}
    for (const [file, url, hash] of VENDOR) {
        const kept = path.join(cache, hash)
        let buf = fs.existsSync(kept) ? fs.readFileSync(kept) : null
        if (!buf || sha256(buf) !== hash) {
            const response = await fetch(url, {
                signal: AbortSignal.timeout(120000)
            })
            if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
            buf = Buffer.from(await response.arrayBuffer())
            if (sha256(buf) !== hash)
                throw new Error(
                    `${url}: SHA-256 ${sha256(buf)}, expected ${hash}`
                )
            fs.mkdirSync(cache, { recursive: true })
            fs.writeFileSync(kept, buf)
            console.log(
                `[extension] fetched ${file} (${(buf.length / 1e6).toFixed(1)} MB)`
            )
        }
        files[file] = buf
    }
    // The site's worker must import the transformers.js vendored here, and
    // that must expect this ONNX Runtime; after an upgrade, update VENDOR.
    const worker = fs.readFileSync(
        path.join(ROOT, 'src', 'js', 'writer.worker.js'),
        'utf8'
    )
    const imported =
        /from '(https:\/\/cdn\.jsdelivr\.net\/[^']+transformers[^']*)'/.exec(
            worker
        )?.[1]
    if (imported !== VENDOR[0][1])
        throw new Error(
            `writer.worker.js imports ${imported}; VENDOR in scripts/extension.js has ${VENDOR[0][1]}`
        )
    const ortVersion = /onnxruntime-web@([^/]+)/.exec(ORT)[1]
    if (!files['vendor/transformers.min.js'].includes(`"${ortVersion}"`))
        throw new Error(
            `transformers.js does not expect onnxruntime-web ${ortVersion}; update ORT in scripts/extension.js`
        )
    return files
}

// The site the extension belongs to: its homepage, and where the chat's
// relay hands out credentials (functions/api/turn.js). SRC_SITE_URL
// overrides it.
export const SITE = 'https://src.eco'

// The manifest, per browser. Chrome's background is a service worker that
// opens the model's offscreen document; Firefox's is that document itself.
// Firefox gets Manifest V2, which it still takes: its V3 background is an
// event page, unloaded after 30 s without an extension event (an open port
// does not count, and neither does a Worker), and the model would have to
// start again after every pause in typing; a V2 background can stay.
export function manifest(
    browser,
    { version, site = SITE, geckoId = GECKO_ID } = {}
) {
    const icons = {
        16: 'icons/16.png',
        32: 'icons/32.png',
        48: 'icons/48.png',
        128: 'icons/128.png'
    }
    const button = {
        default_popup: 'popup.html',
        default_title: '__MSG_action__',
        default_icon: { 16: icons[16], 32: icons[32] }
    }
    const csp = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
    const common = {
        name: '__MSG_name__',
        description: '__MSG_description__',
        default_locale: 'en',
        version,
        homepage_url: site,
        icons,
        content_scripts: [
            {
                matches: ['<all_urls>'],
                js: ['page.js'],
                // At the start, so its key handlers come before the page's.
                run_at: 'document_start',
                all_frames: true,
                match_about_blank: true
            }
        ]
    }
    // unlimitedStorage: the model's weights (137 MB) and the radio's songs
    // stay put. notifications: /alert (chat.js). The site: the chat's relay
    // answers the extension only with access to it.
    const permissions = ['storage', 'unlimitedStorage', 'notifications']
    const relay = `${new URL(site).origin}/*`
    if (browser === 'chromium') {
        return {
            manifest_version: 3,
            ...common,
            minimum_chrome_version: '116',
            action: button,
            background: { service_worker: 'background.js', type: 'module' },
            side_panel: { default_path: 'panel.html' },
            permissions: ['offscreen', 'sidePanel', ...permissions],
            host_permissions: [relay],
            content_security_policy: { extension_pages: csp },
            // Cross-origin isolated, as the site is (src/_headers): the
            // model runs on threads. (Firefox has no such thing for
            // extensions; there it runs on one.)
            cross_origin_embedder_policy: { value: 'require-corp' },
            cross_origin_opener_policy: { value: 'same-origin' }
        }
    }
    if (browser === 'firefox') {
        return {
            manifest_version: 2,
            ...common,
            browser_action: { ...button, default_area: 'navbar' },
            sidebar_action: {
                default_panel: 'panel.html',
                default_title: '__MSG_action__',
                default_icon: { 16: icons[16], 32: icons[32] },
                open_at_install: false
            },
            background: { page: 'host.html', persistent: true },
            permissions: [...permissions, relay],
            content_security_policy: csp,
            browser_specific_settings: {
                // The first with Firefox's own consent for data collection
                // (below), on the desktop and on Android.
                gecko_android: { strict_min_version: '142.0' },
                gecko: {
                    id: geckoId,
                    strict_min_version: '140.0',
                    // What leaves the device, by Mozilla's categories. Chat
                    // messages go to the other people in the chat, which
                    // Mozilla counts as personal communications, whoever
                    // sends them. What is typed in other sites' fields
                    // leaves only as encrypted queries that no one can
                    // read (src/js/private.js); whether Mozilla counts
                    // that is an open question (next/private-memory.md).
                    data_collection_permissions: {
                        required: ['personalCommunications']
                    }
                }
            }
        }
    }
    throw new Error(`unknown browser: ${browser}`)
}

// _locales/<language>/messages.json, from each language's extension.md.
export function locales(languages = readText()) {
    const out = {}
    for (const [language, files] of Object.entries(languages)) {
        if (!files.extension) continue
        use(files)
        out[language] = {
            name: { message: source('extension.name') },
            description: { message: source('extension.description') },
            action: { message: source('extension.action') }
        }
    }
    use(languages.en)
    return out
}

// A module and what it imports, as one classic script: content scripts
// cannot be modules. Each imported module must import nothing itself and
// export only named declarations; it runs in a scope of its own.
export function pack(entry) {
    const code = fs.readFileSync(entry, 'utf8')
    const parts = []
    const body = code.replace(
        /^import\s*\{([^}]*)\}\s*from\s*'([^']+)'\s*;?[ \t]*$/gm,
        (line, names, spec) => {
            const file = path.resolve(path.dirname(entry), spec)
            const module = fs.readFileSync(file, 'utf8')
            if (/^\s*import\s/m.test(module))
                throw new Error(
                    `${spec}: a module packed into a content script must import nothing`
                )
            if (/^export\s+(default|\{|\*)/m.test(module))
                throw new Error(
                    `${spec}: only named declarations can be packed`
                )
            const exported = [
                ...module.matchAll(
                    /^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm
                )
            ].map((m) => m[1])
            const wanted = names
                .split(',')
                .map((name) => name.trim())
                .filter(Boolean)
            for (const name of wanted)
                if (!exported.includes(name))
                    throw new Error(`${spec} does not export ${name}`)
            const rel = path.relative(ROOT, file).split(path.sep).join('/')
            parts.push(
                `// ${rel}\nconst { ${wanted.join(', ')} } = (() => {\n${module.replace(/^export\s+/gm, '')}\nreturn { ${exported.join(', ')} }\n})()\n`
            )
            return ''
        }
    )
    const rel = path.relative(ROOT, entry).split(path.sep).join('/')
    return `// Built from ${rel} by scripts/extension.js.\n;(() => {\n'use strict'\n${parts.join('\n')}\n${body.trimStart()}\n})()\n`
}

// The site's index.html as the extension's terminal: the manifest's CSP
// governs extension pages, and the extension's own entry
// (extension/terminal.js) starts the site's terminal in place of
// js/main.js. `kind` is 'popup' or 'panel'.
export function terminalPage(index, kind) {
    const html = index
        .replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
        .replace('<html lang="en">', `<html lang="en" class="${kind}">`)
        .replace(
            '<link rel="stylesheet" href="style.css">',
            '<link rel="stylesheet" href="style.css">\n        <link rel="stylesheet" href="extension.css">'
        )
        .replace(
            '<script type="module" src="js/main.js"></script>',
            '<script type="module" src="terminal.js"></script>'
        )
    if (
        !html.includes('terminal.js') ||
        html.includes('js/main.js') ||
        !html.includes('extension.css') ||
        html.includes('Content-Security-Policy')
    )
        throw new Error(
            'index.html changed shape; update terminalPage in scripts/extension.js'
        )
    return html
}

// The configuration's tag in index.html: its opening, JSON and closing.
const CONFIG =
    /(<script id="config" type="application\/json">)(.*?)(<\/script>)/s

// The background page (extension/host.html), with the site's configuration
// from the terminal's page: the radio plays there.
export function hostPage(host, index) {
    const config = CONFIG.exec(index)
    const anchor = '<script type="module" src="host.js"></script>'
    if (!config || !host.includes(anchor))
        throw new Error(
            'host.html or index.html changed shape; update hostPage in scripts/extension.js'
        )
    return host.replace(anchor, () => `${config[0]}\n        ${anchor}`)
}

// The site's worker, pointed at the vendored transformers.js and ONNX
// Runtime (src/js/writer.worker.js, RUNTIME).
export function extensionWorker(code) {
    const out = code
        .replace(VENDOR[0][1], '../vendor/transformers.min.js')
        .replace('const RUNTIME = null', "const RUNTIME = '../vendor/ort/'")
    if (
        out.includes('cdn.jsdelivr.net/npm/@huggingface') ||
        !out.includes("RUNTIME = '../vendor/ort/'")
    )
        throw new Error(
            'writer.worker.js changed shape; update extensionWorker in scripts/extension.js'
        )
    return out
}

// The site's configuration (src/js/config.js), as the extension needs it:
// the chat's relay is the site's, not a path beside the page.
export function extensionConfig(index, { site = SITE } = {}) {
    const found = CONFIG.exec(index)
    if (!found)
        throw new Error(
            'index.html has no configuration; update extensionConfig in scripts/extension.js'
        )
    const config = {
        ...JSON.parse(found[2]),
        turn: `${new URL(site).origin}/api/turn`
    }
    return index.replace(
        CONFIG,
        (all, open, json, close) =>
            `${open}${JSON.stringify(config).replaceAll('</', '<\\/')}${close}`
    )
}

// Left out of the extension: the site's service worker (extension pages
// cannot register one; the radio plays over HTTP instead, src/js/torrent.js),
// Cloudflare's headers file, and the site's own entry page.
const SITE_ONLY = new Set([
    'index.html',
    'sw.js',
    'vendor/webtorrent-sw.js',
    '_headers'
])

const versionOf = () =>
    JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version

export async function buildExtension({
    out = DEFAULT_OUT,
    browsers = BROWSERS,
    env = process.env
} = {}) {
    const version = versionOf()
    const site = path.join(out, 'site')
    await build(site, { deploy: true })
    const vendor = await fetchVendor()
    const siteUrl = (env.SRC_SITE_URL || SITE).replace(/\/+$/, '')
    const index = extensionConfig(
        fs.readFileSync(path.join(site, 'index.html'), 'utf8'),
        { site: siteUrl }
    )
    const messages = locales()
    const packed = pack(path.join(EXTENSION_DIR, 'page.js'))
    const built = []
    for (const browser of browsers) {
        const dir = path.join(out, browser)
        fs.rmSync(dir, { recursive: true, force: true })
        const put = (file, data) => {
            fs.mkdirSync(path.dirname(path.join(dir, file)), {
                recursive: true
            })
            fs.writeFileSync(path.join(dir, file), data)
        }
        for (const [file, data] of filesIn(site))
            if (!SITE_ONLY.has(file)) put(file, data)
        put('popup.html', terminalPage(index, 'popup'))
        put('panel.html', terminalPage(index, 'panel'))
        put(
            'js/writer.worker.js',
            extensionWorker(
                fs.readFileSync(
                    path.join(site, 'js', 'writer.worker.js'),
                    'utf8'
                )
            )
        )
        for (const [file, data] of Object.entries(vendor)) put(file, data)
        put(
            'host.html',
            hostPage(
                fs.readFileSync(path.join(EXTENSION_DIR, 'host.html'), 'utf8'),
                index
            )
        )
        for (const file of [
            'host.js',
            'terminal.js',
            'extension.css',
            ...(browser === 'chromium' ? ['background.js'] : [])
        ]) {
            put(file, fs.readFileSync(path.join(EXTENSION_DIR, file)))
        }
        for (const [icon, data] of filesIn(path.join(EXTENSION_DIR, 'icons')))
            put(`icons/${icon}`, data)
        put('page.js', packed)
        for (const [language, entries] of Object.entries(messages))
            put(
                `_locales/${language}/messages.json`,
                `${JSON.stringify(entries, null, 2)}\n`
            )
        put(
            'manifest.json',
            `${JSON.stringify(manifest(browser, { version, site: siteUrl, geckoId: env.FIREFOX_EXTENSION_ID || GECKO_ID }), null, 2)}\n`
        )
        const archive = path.join(out, `src-${browser}-${version}.zip`)
        fs.writeFileSync(archive, zip(filesIn(dir)))
        built.push({ browser, dir, archive })
        console.log(
            `[extension] ${browser}: ${path.relative(ROOT, dir)}, ${path.relative(ROOT, archive)} (${(fs.statSync(archive).size / 1e6).toFixed(1)} MB)`
        )
    }
    fs.rmSync(site, { recursive: true, force: true })
    return { version, built }
}

// The source, for Firefox's reviewers: every file git knows of or would
// (tracked, and untracked but not ignored), so .env and build/ stay out.
export function sourceArchive(out = DEFAULT_OUT, { git = gitFiles } = {}) {
    const version = versionOf()
    const files = git().filter((file) =>
        fs.statSync(path.join(ROOT, file), { throwIfNoEntry: false })?.isFile()
    )
    const archive = path.join(out, `src-source-${version}.zip`)
    fs.mkdirSync(out, { recursive: true })
    fs.writeFileSync(
        archive,
        zip(
            files
                .sort()
                .map((file) => [file, fs.readFileSync(path.join(ROOT, file))])
        )
    )
    return archive
}

function gitFiles() {
    const result = spawnSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
        { cwd: ROOT, encoding: 'utf8' }
    )
    if (result.status !== 0)
        throw new Error(`git ls-files failed: ${result.stderr}`)
    return result.stdout.split('\0').filter(Boolean)
}
