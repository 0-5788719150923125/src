// A station is a folder, seeded as one torrent. Its track list is read from
// the torrent's own file list, so nothing has to be kept in sync by hand:
//
//   01 - Leviathan Hunter.mp3            a track, titled "Leviathan Hunter"
//   01 - Leviathan Hunter - cover.png    an extra of that track, "cover"
//   01 - Leviathan Hunter - lyrics 1.jpg another, "lyrics 1"
//
// Audio files are tracks, in path order. Any other file whose name starts
// with a track's name and " - " belongs to that track.

import { seededShuffle } from './random.js'

export const AUDIO = /\.(mp3|ogg|oga|opus|flac|m4a|aac|wav)$/i

const base = (path) => path.split('/').pop()
const stem = (name) => name.replace(/\.[^.]+$/, '')

export function tracksOf(paths, { artist = 'Various Artists' } = {}) {
    const files = paths.map((path) => ({ path, name: base(path) }))
    const audio = files.filter((f) => AUDIO.test(f.name))
    const others = files.filter((f) => !AUDIO.test(f.name))
    return audio
        .sort((a, b) => (a.path < b.path ? -1 : 1))
        .map((track) => {
            const prefix = `${stem(track.name)} - `
            const extras = others
                .filter((f) => f.name.startsWith(prefix))
                .map((f) => ({
                    label: stem(f.name.slice(prefix.length)),
                    path: f.path
                }))
                .sort((a, b) => (a.label < b.label ? -1 : 1))
            return {
                path: track.path,
                title: stem(track.name).replace(/^\d+\s*-\s*/, ''),
                artist,
                extras
            }
        })
}

// A file's URL under a web seed's address (one ending in "/").
export const webSeedUrl = (base, path) =>
    base + path.split('/').map(encodeURIComponent).join('/')

// The web seed URL of a file inside a station's torrent.
export const seedUrl = (seed, path) => webSeedUrl(`${seed}/radio/`, path)

// A frequency as the dial reads it: 59 -> "59.0", 59.1 -> "59.1".
export const dial = (frequency) =>
    Number.isInteger(Number(frequency))
        ? Number(frequency).toFixed(1)
        : String(frequency)

// Bytes a second, in the ticker's units (decimal, like the writer's MB).
export function rate(bytes) {
    const n = Math.max(0, bytes || 0)
    if (n < 1e3) return `${Math.round(n)} B/s`
    if (n < 1e6) return `${(n / 1e3).toFixed(1)} kB/s`
    return `${(n / 1e6).toFixed(1)} MB/s`
}

// A station's numbers for the ticker. Seeders hold the whole station (the
// stack's seeder, the mirror while it is called in, a listener who kept
// every song); peers are every other connection.
export function stationStats(frequency, { wires, uploadSpeed, downloadSpeed }) {
    const seeders = wires.filter((wire) => wire.isSeeder).length
    return {
        frequency: dial(frequency),
        seeders,
        peers: wires.length - seeders,
        up: rate(uploadSpeed),
        down: rate(downloadSpeed)
    }
}

// A loop's order in shuffle mode: every song once, drawn anew each loop from
// the station and the loop's number, with none of the previous loop's last
// SPREAD songs among its first SPREAD, so no song comes back soon across the
// seam (with 59 songs, at least 10 others play between two plays of one).
// Only a loop's first SPREAD places change, by swaps with its middle, and
// SPREAD is at most a third of the songs (always enough to swap with), so a
// loop's last SPREAD are its plain shuffle: no chain back through earlier
// loops.
const SPREAD = 10
export function shuffledLoop(tracks, seed, round) {
    const order = seededShuffle(tracks, `${seed}/${round}`)
    const spread = Math.min(SPREAD, Math.floor(tracks.length / 3))
    if (!spread) return order
    const tail = new Set(
        seededShuffle(tracks, `${seed}/${round - 1}`).slice(-spread)
    )
    let j = spread
    for (let i = 0; i < spread; i++) {
        if (!tail.has(order[i])) continue
        while (tail.has(order[j])) j++
        ;[order[i], order[j]] = [order[j], order[i]]
        j++
    }
    return order
}

// What a station is playing at a moment, the same for every listener: the
// station runs on UTC since 1970 as a loop of its songs, end to end, in
// file order or, in shuffle mode, in an order drawn anew each time around
// (shuffledLoop). Returns the song, how far into it (seconds), and when it
// ends (ms), or null without song lengths.
export function onAir(
    tracks,
    lengths = {},
    { mode = 'normal', seed = '' } = {},
    now = Date.now()
) {
    const timed = tracks.filter((track) => lengths[track.path] > 0)
    if (!timed.length) return null
    const loop = timed.reduce((n, track) => n + lengths[track.path], 0)
    const seconds = now / 1000
    const round = Math.floor(seconds / loop)
    const order = mode === 'shuffle' ? shuffledLoop(timed, seed, round) : timed
    let into = seconds - round * loop
    for (const track of order) {
        const length = lengths[track.path]
        if (into < length)
            return { track, offset: into, ends: now + (length - into) * 1000 }
        into -= length
    }
    // Rounding at the very end of a loop: the next loop's first song.
    return onAir(tracks, lengths, { mode, seed }, (round + 1) * loop * 1000 + 1)
}
