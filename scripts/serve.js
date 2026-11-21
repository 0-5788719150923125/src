// Development server: rebuilds the site when its inputs change, and reloads
// the browser.
//
// Before each request it checks whether anything in src/ or stations.js is
// newer than the build (a few stat calls). The served index.html, never the
// built file, gets one extra script that polls /__live__ once a second and
// reloads the page when the build changes. It is an external script so the
// page's Content-Security-Policy (script-src 'self') still holds. A failed
// rebuild keeps serving the last good build and prints the error.

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { build, newestInput } from './build.js'

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
    try {
      const version = await (await fetch('/__live__', { cache: 'no-store' })).text()
      if (seen !== null && version !== seen) location.reload()
      seen = version
    } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
})()
`
const LIVE_TAG = '<script src="/__live__.js"></script>'

export function serve(out, { host = '127.0.0.1', port = 8000 } = {}) {
    const index = path.join(out, 'index.html')
    let building = null

    async function maybeRebuild() {
        try {
            if (!fs.existsSync(index) || newestInput() > fs.statSync(index).mtimeMs) {
                building = building || build(out).finally(() => (building = null))
                await building
            }
        } catch (err) {
            console.log(`[serve] rebuild failed, serving last good build: ${err.message}`)
        }
    }

    const send = (res, status, body, type) =>
        res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache' }).end(body)

    const server = http.createServer(async (req, res) => {
        await maybeRebuild()
        const { pathname } = new URL(req.url, 'http://localhost')
        if (pathname === '/__live__') return send(res, 200, String(fs.statSync(index).mtimeMs), 'text/plain')
        if (pathname === '/__live__.js') return send(res, 200, LIVE_SCRIPT, TYPES['.js'])
        if (pathname === '/' || pathname === '/index.html') {
            const html = fs.readFileSync(index, 'utf8').replace('</body>', `${LIVE_TAG}\n</body>`)
            return send(res, 200, html, TYPES['.html'])
        }
        let file
        try {
            file = path.join(out, decodeURIComponent(pathname))
        } catch {
            return send(res, 400, 'bad request', 'text/plain')
        }
        if (!file.startsWith(out + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            console.log(`[serve] 404 ${pathname}`)
            return send(res, 404, 'not found', 'text/plain')
        }
        res.writeHead(200, {
            'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-cache'
        })
        fs.createReadStream(file).pipe(res)
    })

    server.listen(port, host, () =>
        console.log(`[serve] http://localhost:${port} (rebuilds on refresh; ctrl-c to stop)`)
    )
    return server
}
