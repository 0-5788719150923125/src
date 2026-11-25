// The web seed: every station folder, and its .torrent, over plain HTTP.
// WebTorrent fetches pieces from here with range requests whenever no peer
// has them (BEP 19), so a station plays even when nobody else is online.
// Browsers need CORS for that, with the range headers exposed. WebTorrent
// also sends its own User-Agent; Firefox lets a page set that header, so
// the preflight must allow it, while Chromium drops it silently.
//
//   /radio/59.1.torrent  the station's torrent, written by the seeder
//   /radio/59.1/<file>   the station's files: from its folder, else from
//                        what the seeder fetched into CACHE_DIR, once the
//                        station is whole (when it writes the .torrent)

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const PORT = Number(process.env.PORT || 8001)
const RADIO_DIR = path.resolve(process.env.RADIO_DIR || '/radio')
const TORRENTS_DIR = path.resolve(process.env.TORRENTS_DIR || '/torrents')
const CACHE_DIR = path.resolve(process.env.CACHE_DIR || '/cache')
const log = (...args) => console.log(new Date().toISOString(), ...args)

const TYPES = {
    '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg',
    '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
    '.tif': 'image/tiff', '.tiff': 'image/tiff', '.pdf': 'application/pdf', '.txt': 'text/plain',
    '.torrent': 'application/x-bittorrent'
}

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Cache-Control, Pragma, User-Agent',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges'
}

// Map a URL path to a file on disk, or null. Nothing outside the two
// directories can be reached.
function locate(urlPath) {
    let rel
    try {
        rel = decodeURIComponent(urlPath)
    } catch {
        return null
    }
    const torrent = /^\/radio\/([^/]+\.torrent)$/.exec(rel)
    if (torrent) return { file: path.join(TORRENTS_DIR, torrent[1]), cache: 'no-cache' }
    if (!rel.startsWith('/radio/')) return null
    const file = path.join(RADIO_DIR, rel.slice('/radio/'.length))
    if (!file.startsWith(RADIO_DIR + path.sep)) return null
    const cached = path.join(CACHE_DIR, path.relative(RADIO_DIR, file))
    const station = path.relative(RADIO_DIR, file).split(path.sep)[0]
    const fetched = !fs.existsSync(file) && fs.existsSync(path.join(TORRENTS_DIR, `${station}.torrent`))
    return { file: fetched ? cached : file, cache: 'public, max-age=3600' }
}

function respond(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost')
    if (pathname === '/health') return res.writeHead(200, CORS).end('ok\n')
    if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end()
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405, CORS).end()

    const target = locate(pathname)
    let stat = null
    try {
        stat = target && fs.statSync(target.file)
    } catch {}
    if (!stat || !stat.isFile()) return res.writeHead(404, CORS).end()

    const headers = {
        ...CORS,
        'Accept-Ranges': 'bytes',
        'Cache-Control': target.cache,
        'Content-Type': TYPES[path.extname(target.file).toLowerCase()] || 'application/octet-stream',
        'Last-Modified': stat.mtime.toUTCString()
    }
    let start = 0
    let end = stat.size - 1
    let status = 200
    const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range)
    if (range && (range[1] || range[2])) {
        if (range[1]) {
            start = Number(range[1])
            if (range[2]) end = Math.min(Number(range[2]), end)
        } else start = Math.max(stat.size - Number(range[2]), 0)
        if (start > end) {
            return res.writeHead(416, { ...headers, 'Content-Range': `bytes */${stat.size}` }).end()
        }
        status = 206
        headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`
    }
    headers['Content-Length'] = end - start + 1
    res.writeHead(status, headers)
    if (req.method === 'HEAD') return res.end()
    fs.createReadStream(target.file, { start, end })
        .on('error', () => res.destroy())
        .pipe(res)
}

const server = http.createServer(respond)
server.listen(PORT, '0.0.0.0', () => log(`web seed on http://0.0.0.0:${PORT}/radio/`))

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)))
}
