// WebRTC for a peer on a public server: its UDP ports, and a guard that
// keeps a full range from crashing the process. Shared by the seeder
// (seed.js) and the library's peers (peers.js); one range per process.
//
// WEBRTC_PORTS pins libdatachannel's ports to a range ("51000-51999");
// unset, any port. Each connection holds one port of the range while it
// lives, and so does each offer still waiting for an answer (5 per
// announce, per tracker and torrent), so the range's size is how many peers
// the process can have at once. Browsers reach a peer with a public address
// from behind any NAT, so it needs no TURN relay; the range must be open in
// the server's firewall, and the cloud provider's.
//
// WEBRTC_PORTS may instead be one port ("34981"): every connection then
// shares it (libdatachannel's ICE UDP mux), and WEBRTC_MAX (default 500)
// caps how many there are. This is for a peer behind a VPN that forwards a
// single port, such as Proton VPN's NAT-PMP through gluetun (2026-11-23:
// 20 connections on one port locally; 5 from behind a symmetric NAT to a
// peer inside the VPN, by its public address alone). WEBRTC_PORT_FILE
// names a file that holds the port instead (gluetun's forwarded_port); the
// process waits for it, and exits when it changes, so its restart policy
// starts it again on the new port.
//
// libdatachannel aborts the whole process when it finds no free port in the
// range ("Failed to gather local ICE candidates"), so a full range, or a
// flood of offers, would crash it. Instead, a connection past the range's
// size (less a margin) is refused: RTCPeerConnection's constructor calls
// setConfiguration before it touches a port, and simple-peer catches a
// throw from the constructor and drops that one peer. webrtc-polyfill is
// WebTorrent's (and simple-peer's) own copy, pinned by the lockfile.

import dgram from 'node:dgram'
import fs from 'node:fs'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// The port in WEBRTC_PORT_FILE, once there is one; then watch it.
async function portFromFile(file) {
    const read = () => {
        try {
            const port = Number(fs.readFileSync(file, 'utf8').trim())
            return port >= 1 && port <= 65535 ? port : 0
        } catch {
            return 0
        }
    }
    let port = read()
    if (!port) console.log(`webrtc: waiting for a port in ${file}`)
    while (!port) {
        await sleep(2000)
        port = read()
    }
    setInterval(() => {
        const now = read()
        if (now && now !== port) {
            console.log(`webrtc: the forwarded port changed from ${port} to ${now}; restarting`)
            process.exit(0)
        }
    }, 10000).unref()
    return String(port)
}

export async function webrtc(env = process.env) {
    const value = env.WEBRTC_PORT_FILE ? await portFromFile(env.WEBRTC_PORT_FILE) : (env.WEBRTC_PORTS || '').trim()
    const ports = /^(\d+)(?:-(\d+))?$/.exec(value)
    const begin = ports ? Number(ports[1]) : 0
    const end = ports ? Number(ports[2] ?? ports[1]) : 0
    if (value && (!ports || end < begin || end > 65535)) {
        console.error(`WEBRTC_PORTS must be a UDP port or a range of them, like 51000-51999 (got "${value}")`)
        process.exit(1)
    }
    const portRange = ports ? { begin, end, shared: begin === end } : null
    const rtcConfig = portRange ? { portRangeBegin: begin, portRangeEnd: end, ...(portRange.shared ? { enableIceUdpMux: true } : {}) } : {}
    const connections = { live: 0, refused: 0, limit: 0 }
    if (!portRange) return { portRange, rtcConfig, connections }

    const first = await new Promise((resolve) => {
        const socket = dgram.createSocket('udp4')
        socket.once('error', () => resolve(false))
        socket.bind(begin, () => socket.close(() => resolve(true)))
    })
    if (!first) {
        console.error(`WEBRTC_PORTS: UDP port ${begin} is already in use; is another process using it on this host?`)
        process.exit(1)
    }
    connections.limit = portRange.shared ? Math.max(Number(env.WEBRTC_MAX) || 500, 1) : Math.max(end - begin + 1 - 2, 1)
    const { RTCPeerConnection } = await import('webrtc-polyfill')
    const { setConfiguration, close } = RTCPeerConnection.prototype
    const counted = new WeakMap() // connection -> still open
    RTCPeerConnection.prototype.setConfiguration = function (config) {
        if (!counted.has(this)) {
            if (connections.live >= connections.limit) {
                connections.refused++
                throw new Error('no free WebRTC port')
            }
            counted.set(this, true)
            connections.live++
        }
        return setConfiguration.call(this, config)
    }
    RTCPeerConnection.prototype.close = function () {
        if (counted.get(this)) {
            counted.set(this, false)
            connections.live--
        }
        return close.call(this)
    }
    return { portRange, rtcConfig, connections }
}

// How the ports read in a log line.
export const describePorts = (portRange, connections) =>
    !portRange
        ? 'any udp port'
        : portRange.shared
          ? `udp ${portRange.begin}, shared, at most ${connections.limit} connections`
          : `udp ${portRange.begin}-${portRange.end}, at most ${connections.limit} connections`
