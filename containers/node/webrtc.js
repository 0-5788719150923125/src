// WebRTC for a peer on a public server: its UDP ports, and a guard that
// keeps a full range from crashing the process. Shared by the seeder
// (seed.js) and the library's peers (peers.js); one range per process.
//
// WEBRTC_PORTS pins libdatachannel's ports to a range ("51000-51999");
// unset, any port. Each connection holds one port of the range while it
// lives, and so does each offer still waiting for an answer (5 per
// announce, per tracker and torrent), so the range's size is how many peers
// the process can have at once. (One shared port, libdatachannel's ICE UDP
// mux, served only the first connection when tried.) Browsers reach a peer
// with a public address from behind any NAT, so it needs no TURN relay; the
// range must be open in the server's firewall, and the cloud provider's.
//
// libdatachannel aborts the whole process when it finds no free port in the
// range ("Failed to gather local ICE candidates"), so a full range, or a
// flood of offers, would crash it. Instead, a connection past the range's
// size (less a margin) is refused: RTCPeerConnection's constructor calls
// setConfiguration before it touches a port, and simple-peer catches a
// throw from the constructor and drops that one peer. webrtc-polyfill is
// WebTorrent's (and simple-peer's) own copy, pinned by the lockfile.

import dgram from 'node:dgram'

export async function webrtc(env = process.env) {
    const value = (env.WEBRTC_PORTS || '').trim()
    const ports = /^(\d+)-(\d+)$/.exec(value)
    if (value && (!ports || Number(ports[2]) < Number(ports[1]))) {
        console.error(`WEBRTC_PORTS must be a range of UDP ports, like 51000-51999 (got "${value}")`)
        process.exit(1)
    }
    const portRange = ports ? { begin: Number(ports[1]), end: Number(ports[2]) } : null
    const rtcConfig = portRange ? { portRangeBegin: portRange.begin, portRangeEnd: portRange.end } : {}
    const connections = { live: 0, refused: 0, limit: 0 }
    if (!portRange) return { portRange, rtcConfig, connections }

    const first = await new Promise((resolve) => {
        const socket = dgram.createSocket('udp4')
        socket.once('error', () => resolve(false))
        socket.bind(portRange.begin, () => socket.close(() => resolve(true)))
    })
    if (!first) {
        console.error(`WEBRTC_PORTS: UDP port ${portRange.begin} is already in use; is another process using this range on this host?`)
        process.exit(1)
    }
    connections.limit = Math.max(portRange.end - portRange.begin + 1 - 2, 1)
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
