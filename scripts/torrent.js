// Station torrents, made and read without dependencies.
//
// The build makes each station's .torrent from its folder (STATION_59_1 in
// .env), byte for byte the info dictionary WebTorrent's create-torrent
// makes for a folder (the stack's seeder made them until 2026-11-22), so a
// station keeps its info hash: the mirror's files and what listeners hold
// stay valid. Hashing 1.1 GB takes a while, so the result is kept under
// build/torrents/ and made again only when a file's name, size or time
// changes.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { mp3Duration } from './mp3.js'

// Bencode, decoded: strings stay bytes (Buffer), since `pieces` is binary.
// `spans` receives where each top-level value starts and ends, since the
// info hash is taken of the info dictionary's own bytes.
export function bdecode(buf, spans = {}) {
    let i = 0
    const next = (depth) => {
        const c = buf[i]
        if (c === 0x69) {
            const end = buf.indexOf(0x65, i)
            const n = Number(buf.toString('latin1', i + 1, end))
            i = end + 1
            return n
        }
        if (c === 0x6c || c === 0x64) {
            i++
            const items = []
            while (buf[i] !== 0x65) {
                const start = i
                items.push(next(depth + 1))
                if (c === 0x64 && depth === 0 && items.length % 2 === 0)
                    spans[items.at(-2).toString()] = [start, i]
            }
            i++
            if (c === 0x6c) return items
            const dict = {}
            for (let k = 0; k < items.length; k += 2)
                dict[items[k].toString()] = items[k + 1]
            return dict
        }
        const colon = buf.indexOf(0x3a, i)
        if (colon < 0) throw new Error('not bencode')
        const length = Number(buf.toString('latin1', i, colon))
        i = colon + 1 + length
        return buf.subarray(colon + 1, i)
    }
    return next(0)
}

// What a mirror needs of a .torrent: its name, info hash, pieces and files
// (paths inside the torrent, with their byte offsets in it).
export function readTorrent(buf) {
    const spans = {}
    const { info } = bdecode(buf, spans)
    if (!info || !spans.info)
        throw new Error('not a .torrent (no info dictionary)')
    const name = info.name.toString()
    let offset = 0
    const files = (info.files || [{ length: info.length, path: [] }]).map(
        (file) => {
            const inner = file.path.map(String).join('/')
            const entry = {
                path: inner ? `${name}/${inner}` : name,
                inner,
                length: file.length,
                offset
            }
            offset += file.length
            return entry
        }
    )
    return {
        name,
        infoHash: crypto
            .createHash('sha1')
            .update(buf.subarray(...spans.info))
            .digest('hex'),
        pieceLength: info['piece length'],
        pieces: info.pieces,
        length: offset,
        files
    }
}

// The SHA-1 of each piece of `files` (in `folder`), read in order as one
// stream, with the file each piece ends in.
async function* hashPieces(folder, files, pieceLength) {
    let hash = crypto.createHash('sha1')
    let filled = 0
    for (const file of files) {
        for await (const chunk of fs.createReadStream(
            path.join(folder, file.inner),
            { highWaterMark: 1 << 20 }
        )) {
            for (let at = 0; at < chunk.length;) {
                const take = Math.min(pieceLength - filled, chunk.length - at)
                hash.update(chunk.subarray(at, at + take))
                filled += take
                at += take
                if (filled === pieceLength) {
                    yield { digest: hash.digest(), file }
                    hash = crypto.createHash('sha1')
                    filled = 0
                }
            }
        }
    }
    if (filled) yield { digest: hash.digest(), file: files.at(-1) }
}

// Read the station's folder once, checking every piece against the
// .torrent. Throws at the first file that is missing, of another size, or
// whose bytes hash differently.
export async function verifyFolder(folder, torrent) {
    for (const file of torrent.files) {
        const stat = fs.statSync(path.join(folder, file.inner), {
            throwIfNoEntry: false
        })
        if (!stat) throw new Error(`${file.inner}: missing from ${folder}`)
        if (stat.size !== file.length)
            throw new Error(
                `${file.inner}: ${stat.size} bytes here, ${file.length} in the .torrent`
            )
    }
    let piece = 0
    for await (const { digest, file } of hashPieces(
        folder,
        torrent.files,
        torrent.pieceLength
    )) {
        if (
            !digest.equals(torrent.pieces.subarray(piece * 20, piece * 20 + 20))
        )
            throw new Error(
                `${file.inner}: piece ${piece} differs from the .torrent`
            )
        piece++
    }
    if (piece * 20 !== torrent.pieces.length)
        throw new Error(
            `${folder}: ${piece} pieces here, ${torrent.pieces.length / 20} in the .torrent`
        )
}

// The variable naming a station's folder on this machine (a dot becomes an
// underscore): STATION_59_1, STATION_88_5.
export const stationVariable = (frequency) =>
    `STATION_${frequency.replace(/\W/g, '_')}`
export const stationFolder = (frequency, env = process.env) =>
    env[stationVariable(frequency)]

// Bencode, encoded: dictionary keys sorted, as the format requires.
export function bencode(value) {
    if (Buffer.isBuffer(value))
        return Buffer.concat([Buffer.from(`${value.length}:`), value])
    if (typeof value === 'string') return bencode(Buffer.from(value))
    if (typeof value === 'number') return Buffer.from(`i${Math.trunc(value)}e`)
    if (Array.isArray(value))
        return Buffer.concat([
            Buffer.from('l'),
            ...value.map(bencode),
            Buffer.from('e')
        ])
    const keys = Object.keys(value)
        .filter((k) => value[k] !== undefined)
        .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
    return Buffer.concat([
        Buffer.from('d'),
        ...keys.flatMap((k) => [bencode(k), bencode(value[k])]),
        Buffer.from('e')
    ])
}

// create-torrent leaves out hidden files and the junk operating systems
// leave in folders.
const JUNK =
    /^(\..*|Thumbs\.db|ehthumbs\.db|Desktop\.ini|desktop\.ini|Icon\r|npm-debug\.log)$/

// A station folder's files: paths inside it, sorted as create-torrent
// sorts them, with their sizes and times.
export function listFolder(folder) {
    const walk = (dir, prefix) =>
        fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
            if (JUNK.test(entry.name)) return []
            const inner = prefix ? `${prefix}/${entry.name}` : entry.name
            if (entry.isDirectory())
                return walk(path.join(dir, entry.name), inner)
            if (!entry.isFile()) return []
            const stat = fs.statSync(path.join(dir, entry.name))
            return [{ inner, length: stat.size, mtime: stat.mtimeMs }]
        })
    return walk(folder, '').sort((a, b) =>
        a.inner < b.inner ? -1 : a.inner > b.inner ? 1 : 0
    )
}

// create-torrent's piece length (the piece-length package): 1 MiB for a
// station of 1.1 GB.
export const pieceLength = (bytes) =>
    Math.max(
        16384,
        1 << ((Math.log2(bytes < 1024 ? 1 : bytes / 1024) + 0.5) | 0)
    )

// The .torrent of a folder, named `name`, announcing to `announce`.
export async function makeTorrent(folder, name, announce = []) {
    const files = listFolder(folder)
    if (!files.length) throw new Error(`${folder}: no files`)
    const size = pieceLength(files.reduce((n, f) => n + f.length, 0))
    const pieces = []
    for await (const { digest } of hashPieces(folder, files, size))
        pieces.push(digest)
    const info = {
        files: files.map((f) => ({
            length: f.length,
            path: f.inner.split('/')
        })),
        name,
        'piece length': size,
        pieces: Buffer.concat(pieces)
    }
    return bencode({
        announce: announce[0],
        'announce-list': announce.length
            ? announce.map((url) => [url])
            : undefined,
        'created by': 'The Source',
        info
    })
}

// Each song's length in seconds, by its path in the torrent ("59.1/01 -
// Fantasy.mp3"), for the radio's schedule. MP3 only, for now; a song of
// another kind has none, and the schedule leaves it out.
export function songLengths(folder, name) {
    const lengths = {}
    for (const { inner } of listFolder(folder)) {
        if (!/\.mp3$/i.test(inner)) continue
        const seconds = mp3Duration(path.join(folder, inner))
        if (seconds > 0)
            lengths[`${name}/${inner}`] = Math.round(seconds * 1000) / 1000
    }
    return lengths
}

// makeTorrent and songLengths, kept in `cache` (a folder) until the
// station's files change. Returns them, and whether they were made now.
export async function stationTorrent(folder, name, announce, cache) {
    const listing = JSON.stringify([name, announce, listFolder(folder)])
    const key = crypto
        .createHash('sha256')
        .update(listing)
        .digest('hex')
        .slice(0, 16)
    const file = path.join(cache, `${name}-${key}.torrent`)
    const lengthsFile = path.join(cache, `${name}-${key}.json`)
    if (fs.existsSync(file) && fs.existsSync(lengthsFile)) {
        return {
            buf: fs.readFileSync(file),
            lengths: JSON.parse(fs.readFileSync(lengthsFile, 'utf8')),
            made: false
        }
    }
    const buf = await makeTorrent(folder, name, announce)
    const lengths = songLengths(folder, name)
    fs.mkdirSync(cache, { recursive: true })
    for (const old of fs.readdirSync(cache))
        if (old.startsWith(`${name}-`)) fs.rmSync(path.join(cache, old))
    fs.writeFileSync(file, buf)
    fs.writeFileSync(lengthsFile, JSON.stringify(lengths))
    return { buf, lengths, made: true }
}
