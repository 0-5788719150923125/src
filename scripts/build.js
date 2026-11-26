// Build the static site: src/ plus stations.js in, a deployable directory
// out.
//
// The browser loads ES modules natively, so building is mostly copying.
// index.html receives the site configuration (where the stack's web seed
// and tracker live, which trackers to announce to, and the radio stations)
// as a JSON script tag, plus a fingerprint of the build. Each station's
// .torrent is fetched from the stack and bundled into the site. Each language's
// text (src/text/<language>/*.md) is bundled into one module,
// text/<language>.js, which the browser reads and renders.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { stationFolder, stationTorrent } from './torrent.js'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const SRC_DIR = path.join(ROOT, 'src')
export const TEXT_DIR = path.join(SRC_DIR, 'text')
export const STATIONS = path.join(ROOT, 'stations.js')
export const DEFAULT_OUT = path.join(ROOT, 'build', 'site')
const TORRENT_CACHE = path.join(ROOT, 'build', 'torrents')

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

// Read from the environment (or .env). Nothing points at the stack unless
// asked to (it is optional since 2026-11-22): SRC_SEED_URL names its web
// seed, SRC_TRACKER_URL its tracker (for the stack on this machine,
// http://localhost:8001 and ws://localhost:8002). The public trackers alone
// connect peers.
export const seedSource = (env = process.env) => (env.SRC_SEED_URL || '').trim().replace(/\/+$/, '')

// A deploy build drops addresses only this machine can reach. Without a
// public web seed, the deployed radio still plays: its .torrent files are
// bundled into the site (bundleTorrents), and the songs come from other
// listeners, found through the public trackers, and the mirror.
export function siteConfig(stations, env = process.env, { deploy = false } = {}) {
    let seed = seedSource(env)
    let trackers = trackerList(env)
    if (deploy) {
        if (trackers.some(isLocal)) console.log('[build] leaving the local tracker out of a deploy build')
        trackers = trackers.filter((url) => !isLocal(url))
        if (isLocal(seed)) {
            console.log(`[build] SRC_SEED_URL is ${seed}; deploying without a web seed (the radio plays from peers)`)
            seed = ''
        }
    }
    let mirror = mirrorUrl(env)
    if (deploy && isLocal(mirror)) mirror = ''
    return { seed, trackers, mirror, stations, pinned: pinnedKeys(env) }
}

// The public keys of the library peers whose private answers the browser
// extension's page fields take (SRC_PINNED_KEYS, comma-separated; each
// peer logs its own at start). None: any peer that answers privately
// (src/js/private.js).
export const pinnedKeys = (env = process.env) =>
    (env.SRC_PINNED_KEYS || '')
        .split(',')
        .map((key) => key.trim())
        .filter((key) => /^[A-Za-z0-9_-]{43}$/.test(key))

// The radio's mirror (scripts/mirror.js), where browsers fall back to when
// no peer has a song: SRC_MIRROR_URL, else the R2 domain the deploy fills.
// Files are at <mirror>/<info hash>/<station>/<path>.
export const mirrorUrl = (env = process.env) =>
    (env.SRC_MIRROR_URL || (env.CLOUDFLARE_R2_BUCKET && env.CLOUDFLARE_R2_DOMAIN ? `https://${env.CLOUDFLARE_R2_DOMAIN.trim()}` : '')).replace(/\/+$/, '')

// The trackers a local build announces to (the test peers use the same).
export function trackerList(env = process.env) {
    const tracker = (env.SRC_TRACKER_URL || '').trim()
    const extra = (env.SRC_TRACKERS || '').split(',').map((t) => t.trim())
    return [...new Set([tracker, ...extra, ...PUBLIC_TRACKERS].filter(Boolean))]
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

// The last time an input changed. Folders count: deleting or renaming a
// file changes only the folder that held it.
const folders = (dir) => [
    dir,
    ...fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => folders(path.join(dir, entry.name)))
]
export const newestInput = () =>
    Math.max(...[STATIONS, ...folders(SRC_DIR), ...walk(SRC_DIR)].map((file) => fs.statSync(file).mtimeMs))

// Each station's .torrent, into the site as radio/<frequency>.torrent, and
// named in the station's configuration (`torrent`): Pages answers a missing
// file with the home page, so the browser only asks for what the build
// bundled. Made from the station's folder (STATION_59_1 in .env; torrent.js,
// kept in build/torrents/), with each song's length, else fetched from a web
// seed (with no lengths: that station plays unscheduled). Without it no
// browser can tune in. A dev build is quiet about a missing one; a deploy
// warns.
export async function bundleTorrents(out, stations, seed, { deploy = false, env = process.env } = {}) {
    for (const frequency of Object.keys(stations)) {
        const folder = stationFolder(frequency, env)
        try {
            let buf
            if (folder && fs.existsSync(folder)) {
                const made = await stationTorrent(folder, frequency, PUBLIC_TRACKERS, TORRENT_CACHE)
                if (made.made) console.log(`[build] hashed station ${frequency} from ${folder}`)
                buf = made.buf
                // Song lengths, for the schedule every listener shares.
                stations[frequency].lengths = made.lengths
            } else {
                if (!seed) throw new Error('no web seed')
                const response = await fetch(`${seed}/radio/${frequency}.torrent`, { signal: AbortSignal.timeout(3000) })
                if (!response.ok) throw new Error(`HTTP ${response.status}`)
                buf = Buffer.from(await response.arrayBuffer())
            }
            const file = path.join(out, 'radio', `${frequency}.torrent`)
            fs.mkdirSync(path.dirname(file), { recursive: true })
            fs.writeFileSync(file, buf)
            stations[frequency].torrent = `radio/${frequency}.torrent`
        } catch (err) {
            if (deploy) {
                const where = folder ? `from ${folder} (${err.message})` : `(STATION_${frequency.replace(/\W/g, '_')} is not set; ${seed ? `${seed} answered ${err.cause?.code || err.message}` : 'no web seed either'})`
                console.log(`[build] WARNING: no .torrent for station ${frequency} ${where}`)
                console.log(`[build] without it, the deployed station ${frequency} is off the air`)
            }
        }
    }
}

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
    await bundleTorrents(out, config.stations, seedSource(), { deploy })

    // "</" would end the script tag early; JSON allows "<\/" in its place.
    const payload = JSON.stringify(config).replaceAll('</', '<\\/')
    const id = fingerprint(out, payload)
    const html = fs
        .readFileSync(path.join(SRC_DIR, 'index.html'), 'utf8')
        .replace(BUILD_MARKER, `<meta name="src-build" content="${id}">`)
        .replace(CONFIG_MARKER, `<script id="config" type="application/json">${payload}</script>`)
    fs.writeFileSync(path.join(out, 'index.html'), html)
    const bundled = Object.keys(config.stations).filter((frequency) => config.stations[frequency].torrent)
    console.log(`[build] site assembled at ${out} (build ${id}, seed ${config.seed || 'none'}, mirror ${config.mirror || 'none'}, stations bundled: ${bundled.join(', ') || 'none'})`)
    return out
}
