// Yet another streaming service. A station is a torrent seeded by the stack
// (compose.yaml), backed by a web seed so it plays even when no peer can be
// reached. Its tracks come from the torrent's file list (station.js).
//
// Songs stay. Every song that starts playing is downloaded whole into the
// browser's private file system, where WebTorrent keeps its pieces. The
// station's .torrent is kept too, and every station this browser has tuned
// is added back when the page loads: what was heard is verified, seeded to
// other listeners, and plays again without the network, even when the seed
// is down.

import { config } from './config.js'
import { link, say } from './print.js'
import { shuffle } from './random.js'
import { bookIsOpen, state } from './state.js'
import { AUDIO, seedUrl, tracksOf } from './station.js'
import { html, t } from './text.js'
import { announce, getClient, getServer } from './torrent.js'

const FALLBACK = 'assets/six.mp3'
const CACHE = 'src-radio' // Cache Storage: each station's .torrent
const TUNED = 'radio' // localStorage: the frequencies this browser has tuned
const audio = new Audio()
const torrents = new Map() // frequency -> Promise<torrent>
let session = 0

// /radio, /radio [frequency], /radio stop
export function radio([arg]) {
    if (arg === undefined) list()
    else if (arg === 'stop') stop()
    else listen(arg)
}

function list() {
    const stations = Object.entries(config.stations)
        .sort(([a], [b]) => parseFloat(a) - parseFloat(b))
        .map(([frequency, { name }]) => html('radio.station', { frequency, name }).html)
    say(html('radio.usage', { stations: { html: stations.join('<br>') } }))
}

function stop() {
    session++
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    state.delete('radio')
}

async function listen(frequency) {
    stop()
    const mine = session
    state.set('radio.frequency', `${frequency}FM`)
    const station = Object.hasOwn(config.stations, frequency) ? config.stations[frequency] : null
    if (!station) {
        say(t('radio.missing'))
        state.set('frequency', bookIsOpen() ? '1' : '0')
        audio.src = FALLBACK
        return audio.play().catch(() => say(t('radio.failed')))
    }
    say(html('radio.loading', { station: link(torrentUrl(frequency), station.name) }))
    // The streaming service worker starts while the torrent loads.
    getServer()
    state.set('radio.station', station.name)
    let torrent
    try {
        torrent = await tune(frequency)
    } catch (err) {
        console.warn(err)
        return say(t('radio.unreachable', { seed: config.seed }))
    }
    // A page that started without the seed checks again on every tune.
    if (torrent.offline) {
        torrent.offline = !(await fetch(torrentUrl(frequency), { method: 'HEAD' }).then((r) => r.ok, () => false))
    }
    if (mine !== session) return
    let tracks = tracksOf(
        torrent.files.map((f) => f.path),
        station
    )
    // Without the seed, play what this browser already holds.
    if (torrent.offline) tracks = tracks.filter((track) => fileAt(torrent, track.path).progress === 1)
    if (!tracks.length) return say(t('radio.unreachable', { seed: config.seed }))
    if (station.mode === 'shuffle') tracks = shuffle(tracks)
    play(mine, torrent, tracks, 0)
}

const torrentUrl = (frequency) => `${config.seed}/radio/${frequency}.torrent`
const fileAt = (torrent, path) => torrent.files.find((f) => f.path === path)

const tuned = () => {
    try {
        return JSON.parse(localStorage.getItem(TUNED)) || []
    } catch {
        return []
    }
}

// The .torrent: from the seed when it answers, else the copy kept last time.
async function fetchTorrent(url) {
    const cache = await caches.open(CACHE).catch(() => null)
    try {
        const response = await fetch(url, { cache: 'no-cache' })
        if (!response.ok) throw new Error(`${url}: ${response.status}`)
        if (cache) await cache.put(url, response.clone())
        return { buf: new Uint8Array(await response.arrayBuffer()), offline: false }
    } catch (err) {
        const kept = cache && (await cache.match(url))
        if (!kept) throw err
        return { buf: new Uint8Array(await kept.arrayBuffer()), offline: true }
    }
}

// Add the station's torrent once per page. WebTorrent verifies whatever is
// already stored for it before 'ready', so held songs count from the start.
function tune(frequency) {
    if (!torrents.has(frequency)) {
        const adding = (async () => {
            const { buf, offline } = await fetchTorrent(torrentUrl(frequency))
            const client = await getClient()
            const torrent = await new Promise((resolve, reject) => {
                const t = client.add(buf, { deselect: true, announce: announce(), urlList: [`${config.seed}/radio/`] })
                t.once('ready', () => resolve(t))
                t.once('error', reject)
            })
            torrent.offline = offline
            localStorage.setItem(TUNED, JSON.stringify([...new Set([...tuned(), frequency])]))
            report(frequency, torrent)
            forgetOldVersions(torrent)
            return torrent
        })()
        adding.catch(() => torrents.delete(frequency))
        torrents.set(frequency, adding)
    }
    return torrents.get(frequency)
}

// The ticker shows how many whole songs this browser holds and seeds.
function report(frequency, torrent) {
    const update = () => {
        const songs = torrent.files.filter((f) => AUDIO.test(f.name) && f.progress === 1).length
        if (songs) state.set(`seeding.${frequency}FM`, songs)
        else state.delete(`seeding.${frequency}FM`)
    }
    update()
    setInterval(update, 5000)
}

// WebTorrent stores a torrent under "<name> - <first 8 of info hash>". When
// a station's folder changes, its info hash does too; drop the old copy.
async function forgetOldVersions(torrent) {
    try {
        const root = await navigator.storage.getDirectory()
        const current = `${torrent.name} - ${torrent.infoHash.slice(0, 8)}`
        for await (const name of root.keys()) {
            if (name !== current && name.startsWith(`${torrent.name} - `) && /^[0-9a-f]{8}$/.test(name.slice(-8))) {
                await root.removeEntry(name, { recursive: true })
            }
        }
    } catch {}
}

// At page load: add back every station this browser has tuned, so the songs
// it holds are served to other listeners without anyone typing /radio.
export async function restore() {
    for (const frequency of tuned()) {
        if (!config.stations[frequency]) continue
        tune(frequency).catch((err) => console.warn(`radio ${frequency}:`, err.message || err))
    }
}

async function play(mine, torrent, tracks, i) {
    if (mine !== session || !tracks.length) return
    const track = tracks[i]
    const file = fileAt(torrent, track.path)
    // Download the whole song, not just what the stream reads, so it stays.
    file.select()
    const server = await getServer()
    if (mine !== session) return
    if (server) file.streamTo(audio)
    else audio.src = seedUrl(config.seed, track.path)

    audio.onplaying = () => {
        audio.onplaying = null
        say(nowPlaying(track))
    }
    audio.onended = () => play(mine, torrent, tracks, (i + 1) % tracks.length)
    audio.onerror = () => mine === session && say(t('radio.failed'))
    audio.play().catch((err) => {
        if (mine === session && err.name !== 'AbortError') say(t('radio.failed'))
    })
}

function nowPlaying({ artist, title, path, extras }) {
    const vars = { artist, title: link(seedUrl(config.seed, path), title) }
    if (!extras.length) return html('radio.playing', vars)
    const links = extras.map((extra) => link(seedUrl(config.seed, extra.path), extra.label).html)
    return html('radio.playing-with-extras', { ...vars, extras: { html: links.join(', ') } })
}
