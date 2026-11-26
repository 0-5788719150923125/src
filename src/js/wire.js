// BitTorrent wire extensions (BEP 10): each carries one kind of message
// between two peers on a torrent's wire, as chat (room.js), the memory's
// questions (memory.js) and private questions (private.js) do. Imports
// nothing; shared by the browser and the stack's peers.

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// An extension named `name`: each message, as `read(bytes)` makes it (null,
// or a throw: dropped), goes to onMessage(message, wire); with `opened`,
// so does { type: 'open' } once the other side is known to speak it.
export function extension(name, read, onMessage, { opened = false } = {}) {
    function Extension(wire) {
        this.wire = wire
    }
    Extension.prototype.name = name
    if (opened) {
        Extension.prototype.onExtendedHandshake = function (handshake) {
            if (handshake?.m?.[name]) onMessage({ type: 'open' }, this.wire)
        }
    }
    Extension.prototype.onMessage = function (bytes) {
        const message = parse(read, bytes)
        if (message) onMessage(message, this.wire)
    }
    return Extension
}

// What a peer sent, or null: a stranger's malformed bytes are dropped,
// never thrown.
function parse(read, bytes) {
    try {
        return read(bytes)
    } catch {
        return null
    }
}

export const speaks = (wire, name) =>
    !wire.destroyed && Boolean(wire.peerExtendedMapping?.[name])

// Bytes to the peer on `wire`, if it speaks `name`; false if they went
// nowhere.
export function send(wire, name, bytes) {
    if (!speaks(wire, name)) return false
    wire.extended(name, bytes)
    return true
}

// JSON messages: objects, of at most `most` bytes.
export const readJson = (most) => (bytes) => {
    if (bytes.length > most) return null
    const value = JSON.parse(decoder.decode(bytes))
    return value && typeof value === 'object' ? value : null
}

export const json = (value) => encoder.encode(JSON.stringify(value))
