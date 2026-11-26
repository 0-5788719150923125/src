// Yet another streaming service. A station is a torrent: a folder the build
// hashes (scripts/torrent.js). Its .torrent comes from the web seed when
// there is one, else from the copy the build bundled into the site, so no
// server has to be public: the songs come from other listeners, found
// through the public trackers, the stack's seeder when it is up
// (compose.yaml), and the mirror. A web seed, when public, is one more
// source, and plays even when no peer can be reached.
// Its tracks come from the torrent's file list (station.js).
//
// The mirror (config.mirror, an R2 bucket the deploy fills: scripts/
// mirror.js) is the last resort, kept out of the way of the swarm: it joins
// a station as a web seed only when no peer turns up, when a song does not
// start, or when playback stalls, and leaves again once a song has arrived
// while real peers are around. What it sends is verified against the
// .torrent like anything from a peer, kept, and seeded on.
//
// Songs stay. Every song that starts playing is downloaded whole into the
// browser's private file system, where WebTorrent keeps its pieces. The
// station's .torrent is kept too. Every station joins the swarm when the
// page loads, played or not: what is held is verified, seeded to other
// listeners, and plays again without the network, even when no one else is
// around. A browser that holds fewer than a few songs of a station fetches
// some in the background (CACHE_SONGS), so every visitor has something to
// share, even right after /reset.
//
// Everyone hears the same thing: a station runs on UTC as a loop of its
// songs (onAir in station.js, from song lengths the build reads), so a
// listener joins mid-song at the point everyone else is at, and the next
// song is downloaded while this one plays.

import { config } from './config.js'
import { link, say } from './print.js'
import { shuffle } from './random.js'
import { state } from './state.js'
import {
    AUDIO,
    onAir,
    seedUrl,
    stationStats,
    tracksOf,
    webSeedUrl
} from './station.js'
import { html, t } from './text.js'
import { announce, getClient, getServer } from './torrent.js'

const CACHE = 'src-radio' // Cache Storage: each station's .torrent
const audio = new Audio()
// The page is cross-origin isolated (_headers), so a song played straight
// from the web seed must load as a CORS request, which the web seed allows.
audio.crossOrigin = 'anonymous'
const torrents = new Map() // frequency -> Promise<torrent>
// With no web seed, the songs come from peers: how long to wait for the
// first before calling in the mirror (sound came about 2 s after it
// joined, measured with R2), or with no mirror, before settling for the
// songs this browser holds.
const PEER_WAIT = config.mirror ? 2000 : 6000
// How long a song may take to start, or stall, before the mirror joins.
const START_WAIT = 5000
const STALL_WAIT = 3000
// Songs of each station a browser keeps without playing them, picked at
// random so the swarm's copies spread across the station; fetched a while
// after the page loads, so they do not slow its start (the writer's model).
// Not when the browser asks to save data.
const CACHE_SONGS = 5
const CACHE_DELAY = 20000
// A peer can be connected and send nothing (seen: a browser reached through
// its own router's public address). While background songs are missing and
// less than STARVED_BYTES arrived in STARVED_WAIT, the mirror joins.
const STARVED_WAIT = 10000
const STARVED_BYTES = 65536
// A schedule's start this close to a song's top starts it from the top.
const NEAR_TOP = 2
let session = 0
let objectUrl = null

// The browser extension plays the radio in its background page, which
// outlives its popup (extension/host.js); its terminal hands /radio there
// (extension/terminal.js), with { radio, restore }. Null on the site.
let elsewhere = null
export const playElsewhere = (radio) => (elsewhere = radio)

// /radio turns the radio on, or off when it is on. It plays the first
// station on the dial (there is one; more would need more of a command).
export function radio() {
    if (elsewhere) return elsewhere.radio()
    if (state.get('radio')) {
        stop()
        return say(t('radio.off'))
    }
    const [frequency] = Object.keys(config.stations).sort(
        (a, b) => parseFloat(a) - parseFloat(b)
    )
    if (!frequency) return say(t('radio.off-air'))
    listen(frequency)
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
    const station = config.stations[frequency]
    const sources = torrentUrls(frequency)
    say(
        html('radio.loading', {
            station: sources.length
                ? link(sources[0], station.name)
                : station.name
        })
    )
    // The streaming service worker starts while the torrent loads.
    getServer()
    state.set('radio.station', station.name)
    let torrent
    try {
        torrent = await tune(frequency)
    } catch (err) {
        console.warn(err)
        if (mine === session) state.delete('radio')
        return say(
            config.seed
                ? t('radio.unreachable', { seed: config.seed })
                : t('radio.off-air')
        )
    }
    // A page that started without the web seed checks again on every tune.
    if (config.seed && !torrent.webSeed) {
        torrent.webSeed = await fetch(seedTorrentUrl(frequency), {
            method: 'HEAD'
        }).then(
            (r) => r.ok,
            () => false
        )
    }
    if (mine !== session) return
    // Without a web seed the songs come from peers; give them a moment,
    // then call in the mirror.
    if (alone(torrent)) await firstPeer(torrent, PEER_WAIT)
    if (mine !== session) return
    if (alone(torrent)) callMirror(torrent)
    const tracks = tracksOf(
        torrent.files.map((f) => f.path),
        station
    )
    if (!tracks.length)
        return say(t('radio.unreachable', { seed: config.seed }))
    // With no one to get songs from, play what this browser holds, if
    // anything, in an order of its own; else wait on the schedule, and the
    // song plays when someone turns up.
    if (alone(torrent) && !torrent.mirror) {
        const held = tracks.filter(
            (track) => fileAt(torrent, track.path).progress === 1
        )
        if (held.length)
            return play(mine, torrent, ownOrder(held, station.mode), null)
        say(t('radio.searching'))
    }
    const scheduled = schedule(tracks, station, frequency)
    play(mine, torrent, scheduled || ownOrder(tracks, station.mode), null)
}

// The program: what to play, and what follows a song. On the station's
// schedule, the song on air now (and the point in it), and after a song,
// whatever is on air then; a song that ended a little early (clocks,
// decoders) is not played twice.
function schedule(tracks, station, frequency) {
    const options = { mode: station.mode, seed: frequency }
    if (!onAir(tracks, station.lengths, options)) return null
    const at = (now) => onAir(tracks, station.lengths, options, now)
    return {
        first: () => at(Date.now()),
        after: (played) => {
            const now = at(Date.now())
            return now.track === played.track
                ? { ...at(now.ends + 1), offset: 0 }
                : now
        },
        upNext: (playing) => at(playing.ends + 1).track
    }
}

// A program in this browser's own order, from the top of each song: for a
// station without song lengths, or only the songs this browser holds.
function ownOrder(tracks, mode) {
    const order = mode === 'shuffle' ? shuffle(tracks) : tracks
    const next = (track) => order[(order.indexOf(track) + 1) % order.length]
    return {
        first: () => ({ track: order[0], offset: 0 }),
        after: (played) => ({ track: next(played.track), offset: 0 }),
        upNext: (playing) => next(playing.track)
    }
}

const seedTorrentUrl = (frequency) =>
    `${config.seed}/radio/${frequency}.torrent`
// Where a station's .torrent is read from: the web seed first (the seeder
// writes it there, so it is never stale), then the site's bundled copy.
const torrentUrls = (frequency) =>
    [
        config.seed && seedTorrentUrl(frequency),
        config.stations[frequency]?.torrent
    ].filter(Boolean)
const fileAt = (torrent, path) => torrent.files.find((f) => f.path === path)
// Peers that are browsers or seeders, not web seeds.
const peers = (torrent) =>
    torrent.wires.filter((wire) => wire.type !== 'webSeed').length
// No web seed, and no peer to get songs from.
const alone = (torrent) => !torrent.webSeed && !peers(torrent)

// The mirror holds each version of a station under its info hash.
const mirrorBase = (torrent) => `${config.mirror}/${torrent.infoHash}/`
const mirrorUrl = (torrent, path) => webSeedUrl(mirrorBase(torrent), path)

function callMirror(torrent) {
    if (!config.mirror || torrent.mirror || torrent.destroyed) return
    torrent.mirror = mirrorBase(torrent)
    torrent.addWebSeed(torrent.mirror)
}

function dismissMirror(torrent) {
    if (!torrent.mirror || torrent.destroyed) return
    torrent.removePeer(torrent.mirror)
    torrent.mirror = null
}

// Download a whole song at `priority`. Once it is here, the swarm is enough
// again, if there is one.
function fetchSong(torrent, file, priority) {
    file.select(priority)
    if (file.progress < 1)
        file.once('done', () => peers(torrent) && dismissMirror(torrent))
}

// Resolves at the torrent's first peer, or after `ms`.
const firstPeer = (torrent, ms) =>
    new Promise((resolve) => {
        const done = () => {
            clearTimeout(timer)
            torrent.removeListener('wire', done)
            resolve()
        }
        const timer = setTimeout(done, ms)
        torrent.on('wire', done)
    })

// The .torrent: from the first source that answers (torrentUrls), else the
// copy kept last time. `webSeed` says whether the web seed answered.
async function fetchTorrent(frequency) {
    const cache = await caches.open(CACHE).catch(() => null)
    const key = new URL(`radio/${frequency}.torrent`, document.baseURI).href
    let error = new Error(`no source for station ${frequency}`)
    for (const url of torrentUrls(frequency)) {
        try {
            const response = await fetch(url, { cache: 'no-cache' })
            if (!response.ok) throw new Error(`${url}: ${response.status}`)
            const buf = new Uint8Array(await response.clone().arrayBuffer())
            // Kept, for when no source answers. (Cache Storage keeps only
            // web addresses; the browser extension's pages need not keep
            // theirs: the .torrent is in the extension.)
            if (cache && /^https?:/.test(key))
                await cache
                    .put(key, response)
                    .catch((err) =>
                        console.warn('radio: not kept:', err.message)
                    )
            return {
                buf,
                webSeed:
                    Boolean(config.seed) && url === seedTorrentUrl(frequency)
            }
        } catch (err) {
            error = err
        }
    }
    const kept = cache && (await cache.match(key).catch(() => null))
    if (!kept) throw error
    return { buf: new Uint8Array(await kept.arrayBuffer()), webSeed: false }
}

// Add the station's torrent once per page. WebTorrent verifies whatever is
// already stored for it before 'ready', so held songs count from the start.
function tune(frequency) {
    if (!torrents.has(frequency)) {
        const adding = (async () => {
            const { buf, webSeed } = await fetchTorrent(frequency)
            const client = await getClient()
            const urlList = config.seed ? [`${config.seed}/radio/`] : []
            const torrent = await new Promise((resolve, reject) => {
                const added = client.add(buf, {
                    deselect: true,
                    announce: announce(),
                    urlList
                })
                added.once('ready', () => resolve(added))
                added.once('error', reject)
            })
            torrent.webSeed = webSeed
            report(frequency, torrent)
            forgetOldVersions(torrent).catch((err) =>
                console.warn('radio: old versions stay:', err.message || err)
            )
            return torrent
        })()
        adding.catch(() => torrents.delete(frequency))
        torrents.set(frequency, adding)
    }
    return torrents.get(frequency)
}

// The ticker's line for the stations this browser takes part in: one with
// a song held or a connection open. One station is an object, several an
// array. Speeds are WebTorrent's, over its last few seconds.
const seeding = new Map() // frequency -> the station's numbers, or null

function report(frequency, torrent) {
    const update = () => {
        const held = torrent.files.some(
            (f) => AUDIO.test(f.name) && f.progress === 1
        )
        seeding.set(
            frequency,
            held || torrent.wires.length
                ? stationStats(frequency, torrent)
                : null
        )
        const shown = [...seeding.values()].filter(Boolean)
        if (!shown.length) state.delete('seeding')
        else state.set('seeding', shown.length === 1 ? shown[0] : shown)
    }
    update()
    setInterval(update, 2000)
}

// WebTorrent stores a torrent under "<name> - <first 8 of info hash>". When
// a station's folder changes, its info hash does too; drop the old copy,
// and any station that is no longer on the dial (59 became 59.1). Rooms
// are stored as "src-focus-<room>", never a bare number.
async function forgetOldVersions(torrent) {
    const root = await navigator.storage.getDirectory()
    const current = `${torrent.name} - ${torrent.infoHash.slice(0, 8)}`
    for await (const name of root.keys()) {
        const stored = /^(\d+(?:\.\d+)?) - [0-9a-f]{8}$/.exec(name)
        if (!stored || name === current) continue
        if (
            stored[1] === torrent.name ||
            !Object.hasOwn(config.stations, stored[1])
        )
            await root.removeEntry(name, { recursive: true })
    }
}

// At page load: join every station, so the songs this browser holds are
// served to other listeners without anyone typing /radio, then top up what
// it holds. Nothing plays.
export async function restore() {
    if (elsewhere) return elsewhere.restore()
    for (const frequency of Object.keys(config.stations)) {
        tune(frequency)
            .then((torrent) => setTimeout(() => cache(torrent), CACHE_DELAY))
            .catch((err) =>
                console.warn(`radio ${frequency}:`, err.message || err)
            )
    }
}

// Fetch songs in the background until this browser holds CACHE_SONGS of
// the station, from peers, or from the mirror when none turns up. They are
// selected below any song that plays.
async function cache(torrent) {
    if (navigator.connection?.saveData || torrent.destroyed) return
    const songs = torrent.files.filter((f) => AUDIO.test(f.name))
    const missing = CACHE_SONGS - songs.filter((f) => f.progress === 1).length
    const wanted = shuffle(songs.filter((f) => f.progress < 1)).slice(
        0,
        Math.max(0, missing)
    )
    if (!wanted.length) return
    if (alone(torrent)) await firstPeer(torrent, PEER_WAIT)
    if (alone(torrent)) callMirror(torrent)
    for (const file of wanted) fetchSong(torrent, file, 0)
    let last = torrent.downloaded
    const watch = setInterval(() => {
        if (torrent.destroyed || wanted.every((f) => f.progress === 1))
            return clearInterval(watch)
        if (torrent.downloaded - last < STARVED_BYTES) callMirror(torrent)
        last = torrent.downloaded
    }, STARVED_WAIT)
}

async function play(mine, torrent, program, played) {
    if (mine !== session) return
    const playing = played ? program.after(played) : program.first()
    const { track } = playing
    const file = fileAt(torrent, track.path)
    // Download the whole song, not just what the stream reads, so it stays;
    // ahead of any song fetched in the background. Once it is here, the
    // next song downloads, so the change of song has nothing to wait for.
    fetchSong(torrent, file, 1)
    const upNext = () =>
        mine === session &&
        fetchSong(torrent, fileAt(torrent, program.upNext(playing).path), 1)
    if (file.progress === 1) upNext()
    else file.once('done', upNext)
    const server = await getServer()
    if (mine !== session) return
    // Without streaming (no service worker): straight from the web seed or
    // the mirror over HTTP, which starts at once, while the torrent still
    // fetches the song to keep; else the whole song first, then play (a
    // blob: URL, which the CSP allows). The mirror is called in for it: a
    // whole song from peers can take long, or never come (a tab back from
    // suspension can hold connections that are dead).
    if (!server && !torrent.webSeed) callMirror(torrent)
    if (server) file.streamTo(audio)
    else if (torrent.webSeed) audio.src = seedUrl(config.seed, track.path)
    else if (torrent.mirror) audio.src = mirrorUrl(torrent, track.path)
    else {
        const blob = await file.blob()
        if (mine !== session) return
        if (objectUrl) URL.revokeObjectURL(objectUrl)
        audio.src = objectUrl = URL.createObjectURL(blob)
    }

    // Join the song where the station is.
    const offset = playing.offset > NEAR_TOP ? playing.offset : 0
    audio.onloadedmetadata = () => {
        if (offset && mine === session) audio.currentTime = offset
    }

    // A song that does not start, or stalls, calls in the mirror.
    const rescue = () => mine === session && callMirror(torrent)
    let stalled = setTimeout(rescue, START_WAIT)
    let announced = false
    audio.onplaying = () => {
        clearTimeout(stalled)
        if (announced) return
        announced = true
        say(nowPlaying(torrent, track, server))
    }
    audio.onwaiting = () => {
        clearTimeout(stalled)
        stalled = setTimeout(rescue, STALL_WAIT)
    }
    audio.onended = () => {
        clearTimeout(stalled)
        play(mine, torrent, program, playing)
    }
    audio.onerror = () => mine === session && say(t('radio.failed'))
    audio.play().catch((err) => {
        if (mine === session && err.name !== 'AbortError')
            say(t('radio.failed'))
    })
}

// Where a file of the station opens: the web seed, else this browser's own
// torrent client through the service worker, else the mirror, else nowhere.
function fileUrl(torrent, path, server) {
    if (torrent.webSeed) return seedUrl(config.seed, path)
    if (server) return fileAt(torrent, path).streamURL
    return config.mirror ? mirrorUrl(torrent, path) : null
}

function nowPlaying(torrent, { artist, title, path, extras }, server) {
    const url = fileUrl(torrent, path, server)
    const vars = { artist, title: url ? link(url, title) : title }
    const links = extras
        .map((extra) => [fileUrl(torrent, extra.path, server), extra.label])
        .filter(([href]) => href)
    if (!links.length) return html('radio.playing', vars)
    const extrasHtml = links
        .map(([href, label]) => link(href, label).html)
        .join(', ')
    return html('radio.playing-with-extras', {
        ...vars,
        extras: { html: extrasHtml }
    })
}
