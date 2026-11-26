// The stack's tracker: where browsers (and the stack's peer) find each
// other. WebSocket announces carry WebRTC offers between browsers, so this
// is also the signaling server. Statistics are at /stats.

import { Server } from 'bittorrent-tracker'

const PORT = Number(process.env.PORT || 8002)
const log = (...args) => console.log(new Date().toISOString(), ...args)

const server = new Server({
    udp: false,
    http: true,
    ws: true,
    stats: true,
    trustProxy: true
})
server.on('error', (err) => log('error:', err.message || err))
server.on('warning', (err) => log('warning:', err.message || err))
server.listen(PORT, '0.0.0.0', () =>
    log(`tracker listening on ws://0.0.0.0:${PORT}`)
)

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)))
}
