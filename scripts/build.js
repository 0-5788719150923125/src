// Build the static site: src/ plus stations.js in, a deployable directory
// out.
//
// The browser loads ES modules natively, so building is mostly copying.
// index.html receives the site configuration (where the stack's web seed
// and tracker live, which trackers to announce to, and the radio stations)
// as a JSON script tag, plus a fingerprint of the build. Each language's
// text (src/text/<language>/*.md) is bundled into one module,
// text/<language>.js, which the browser reads and renders.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const SRC_DIR = path.join(ROOT, 'src')
export const TEXT_DIR = path.join(SRC_DIR, 'text')
export const STATIONS = path.join(ROOT, 'stations.js')
export const DEFAULT_OUT = path.join(ROOT, 'build', 'site')

const CONFIG_MARKER = '<!--SRC_CONFIG-->'
const BUILD_MARKER = '<!--SRC_BUILD-->'

// Public WebTorrent trackers that answered in November 2026. Lists like
// this rot; the stack's own tracker comes first so the swarm never depends
// on them.
export const PUBLIC_TRACKERS = [
    'wss://tracker.openwebtorrent.com',
    'wss://open.ftorrent.com',
    'wss://tracker.novage.com.ua',
    'wss://tracker.webtorrent.dev'
]

export async function loadStations(file = STATIONS) {
    // A fresh URL each time, so the dev server sees edits.
    const { default: data } = await import(`${pathToFileURL(file)}?t=${fs.statSync(file).mtimeMs}`)
    const stations = {}
    for (const [frequency, station] of Object.entries(data || {})) {
        if (!station || !station.name) throw new Error(`${file}: station ${frequency} needs at least a name`)
        stations[String(frequency)] = {
            name: String(station.name),
            artist: String(station.artist || 'Various Artists'),
            mode: String(station.mode || 'normal')
        }
    }
    return stations
}

const isLocal = (url) => /^\w+:\/\/(localhost|127\.|\[::1\])/.test(url)

// Read from the environment (or .env). The defaults point at the stack
// running on this machine. The public trackers alone are enough to connect
// peers; the stack's tracker only adds one that does not depend on
// strangers. Set SRC_TRACKER_URL empty to leave it out.
//
// A deploy build drops addresses only this machine can reach.
export function siteConfig(stations, env = process.env, { deploy = false } = {}) {
    const seed = (env.SRC_SEED_URL || 'http://localhost:8001').replace(/\/+$/, '')
    const tracker = (env.SRC_TRACKER_URL ?? 'ws://localhost:8002').trim()
    const extra = (env.SRC_TRACKERS || '').split(',').map((t) => t.trim())
    let trackers = [...new Set([tracker, ...extra, ...PUBLIC_TRACKERS].filter(Boolean))]
    if (deploy) {
        if (trackers.some(isLocal)) console.log('[build] leaving the local tracker out of a deploy build')
        trackers = trackers.filter((url) => !isLocal(url))
        if (isLocal(seed)) console.log(`[build] WARNING: SRC_SEED_URL is ${seed}; visitors' radios will not reach it`)
    }
    return { seed, trackers, stations }
}

const walk = (dir) =>
    fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap((entry) => {
            const full = path.join(dir, entry.name)
            return entry.isDirectory() ? walk(full) : [full]
        })
        .sort()

// A short digest of everything the build contains, stamped into index.html
// as <meta name="src-build">. The deploy uses it to tell a fresh edge from
// a cached one.
export function fingerprint(dir, payload) {
    const hash = crypto.createHash('sha256').update(payload)
    for (const file of walk(dir)) {
        hash.update(path.relative(dir, file).split(path.sep).join('/'))
        hash.update(fs.readFileSync(file))
    }
    return hash.digest('hex').slice(0, 12)
}

// { language: { file: contents } } for every language in src/text/.
export function readText(dir = TEXT_DIR) {
    const languages = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    return Object.fromEntries(
        languages.map(({ name }) => {
            const files = fs.readdirSync(path.join(dir, name)).filter((file) => file.endsWith('.md')).sort()
            return [name, Object.fromEntries(files.map((file) => [file.slice(0, -3), fs.readFileSync(path.join(dir, name, file), 'utf8')]))]
        })
    )
}

export const newestInput = () =>
    Math.max(...[STATIONS, ...walk(SRC_DIR)].map((file) => fs.statSync(file).mtimeMs))

export async function build(out = DEFAULT_OUT, { deploy = false } = {}) {
    const config = siteConfig(await loadStations(), process.env, { deploy })
    fs.rmSync(out, { recursive: true, force: true })
    const copied = (src) => src !== path.join(SRC_DIR, 'index.html') && src !== TEXT_DIR && !src.startsWith(TEXT_DIR + path.sep)
    fs.cpSync(SRC_DIR, out, { recursive: true, filter: copied })
    fs.mkdirSync(path.join(out, 'text'))
    for (const [language, files] of Object.entries(readText())) {
        const bundle = `// Built from src/text/${language}/ by scripts/build.js.\nexport default ${JSON.stringify(files, null, 2)}\n`
        fs.writeFileSync(path.join(out, 'text', `${language}.js`), bundle)
    }

    // "</" would end the script tag early; JSON allows "<\/" in its place.
    const payload = JSON.stringify(config).replaceAll('</', '<\\/')
    const id = fingerprint(out, payload)
    const html = fs
        .readFileSync(path.join(SRC_DIR, 'index.html'), 'utf8')
        .replace(BUILD_MARKER, `<meta name="src-build" content="${id}">`)
        .replace(CONFIG_MARKER, `<script id="config" type="application/json">${payload}</script>`)
    fs.writeFileSync(path.join(out, 'index.html'), html)
    console.log(`[build] site assembled at ${out} (build ${id}, seed ${config.seed})`)
    return out
}
