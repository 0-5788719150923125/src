// Development server: rebuilds the site when its inputs change, and reloads
// the browser.
//
// Before each request it checks whether anything in src/ or stations.js is
// newer than the build (a few stat calls). The served index.html, never the
// built file, gets one extra script that polls /__live__ once a second and
// reloads the page when the build changes. It is an external script so the
// page's Content-Security-Policy (script-src 'self') still holds. A failed
// rebuild keeps serving the last good build and prints the error. Every
// response carries the headers in the build's _headers file, as it would
// on Cloudflare Pages. Pages Functions (functions/, so far /api/turn) run
// here too, with their variables from the environment (TURN_KEY_ID and the
// rest; unset, the relay is off, as on a deploy without it).

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, build, newestInput } from './build.js'

const FUNCTIONS = { '/api/turn': 'functions/api/turn.js' }

// A Pages Function's GET handler, called with a Request and the environment.
async function runFunction(file, req, res) {
    const { onRequestGet } = await import(
        pathToFileURL(path.join(ROOT, file)).href
    )
    const request = new Request(
        new URL(req.url, `http://${req.headers.host}`),
        { headers: req.headers }
    )
    const response = await onRequestGet({ request, env: process.env })
    res.writeHead(response.status, Object.fromEntries(response.headers)).end(
        Buffer.from(await response.arrayBuffer())
    )
}

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf'
}

const LIVE_SCRIPT = `(async () => {
  let seen = null
  for (;;) {
    // No answer while the server restarts: ask again in a second.
    const version = await fetch('/__live__', { cache: 'no-store' }).then((r) => r.text(), () => null)
    if (version !== null && seen !== null && version !== seen) location.reload()
    if (version !== null) seen = version
    await new Promise((r) => setTimeout(r, 1000))
  }
})()
`
const LIVE_TAG = '<script src="/__live__.js"></script>'

// The headers the built _headers file (Cloudflare Pages' format) gives a
// path: a line starting with "/" is a path pattern ("*" matches anything,
// ":name" one segment), and the indented "Name: value" lines under it are
// its headers. Read on every request, like the build.
export function headersFor(out, pathname) {
    const file = path.join(out, '_headers')
    if (!fs.existsSync(file)) return []
    const headers = []
    let matches = false
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim() || line.trim().startsWith('#')) continue
        if (!/^\s/.test(line)) {
            const pattern = line
                .trim()
                .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
                .replace(/\*/g, '.*')
                .replace(/:\w+/g, '[^/]+')
            matches = new RegExp(`^${pattern}$`).test(pathname)
        } else if (matches && line.includes(':')) {
            const at = line.indexOf(':')
            headers.push([line.slice(0, at).trim(), line.slice(at + 1).trim()])
        }
    }
    return headers
}

export function serve(out, { host = '127.0.0.1', port = 8000 } = {}) {
    const index = path.join(out, 'index.html')
    let building = null

    async function maybeRebuild() {
        try {
            if (
                !fs.existsSync(index) ||
                newestInput() > fs.statSync(index).mtimeMs
            ) {
                building =
                    building || build(out).finally(() => (building = null))
                await building
            }
        } catch (err) {
            console.log(
                `[serve] rebuild failed, serving last good build: ${err.message}`
            )
        }
    }

    const head = (res, status, type) =>
        res.writeHead(status, {
            'Content-Type': type,
            'Cache-Control': 'no-cache'
        })
    const send = (res, status, body, type = 'text/plain') =>
        head(res, status, type).end(body)

    const server = http.createServer(async (req, res) => {
        await maybeRebuild()
        const { pathname } = new URL(req.url, 'http://localhost')
        for (const [name, value] of headersFor(out, pathname))
            res.setHeader(name, value)
        if (pathname === '/__live__')
            return send(res, 200, String(fs.statSync(index).mtimeMs))
        if (pathname === '/__live__.js')
            return send(res, 200, LIVE_SCRIPT, TYPES['.js'])
        if (FUNCTIONS[pathname]) {
            if (req.method !== 'GET')
                return send(res, 405, 'method not allowed')
            return runFunction(FUNCTIONS[pathname], req, res).catch((err) =>
                send(res, 500, err.message)
            )
        }
        if (pathname === '/' || pathname === '/index.html') {
            const html = fs
                .readFileSync(index, 'utf8')
                .replace('</body>', `${LIVE_TAG}\n</body>`)
            return send(res, 200, html, TYPES['.html'])
        }
        let file
        try {
            file = path.join(out, decodeURIComponent(pathname))
        } catch {
            return send(res, 400, 'bad request')
        }
        if (
            !file.startsWith(out + path.sep) ||
            !fs.existsSync(file) ||
            !fs.statSync(file).isFile()
        ) {
            console.log(`[serve] 404 ${pathname}`)
            return send(res, 404, 'not found')
        }
        fs.createReadStream(file).pipe(
            head(
                res,
                200,
                TYPES[path.extname(file).toLowerCase()] ||
                    'application/octet-stream'
            )
        )
    })

    server.listen(port, host, () =>
        console.log(
            `[serve] http://localhost:${port} (rebuilds on refresh; ctrl-c to stop)`
        )
    )
    return server
}
