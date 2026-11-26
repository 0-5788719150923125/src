// A zip archive, written with nothing but Node: the extension's packages
// (scripts/extension.js) and the source archive Firefox's reviewers read.
//
// Entries are deflated when that makes them smaller, else stored, and every
// entry gets the same timestamp, so the same files always make the same
// bytes: a reviewer who builds from the source gets an identical package.
// No zip64: an archive and each file stay under 4 GiB (the extension is
// about 20 MB).

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

// 1980-01-01 00:00, the earliest time a zip can say.
const DOS_TIME = 0
const DOS_DATE = (0 << 9) | (1 << 5) | 1

// `files` is [name, Buffer] pairs, names with forward slashes. Returns the
// archive as a Buffer.
export function zip(files) {
    const locals = []
    const centrals = []
    let offset = 0
    for (const [name, data] of files) {
        const nameBuf = Buffer.from(name, 'utf8')
        const deflated = zlib.deflateRawSync(data, { level: 9 })
        const stored = deflated.length >= data.length
        const body = stored ? data : deflated
        const crc = zlib.crc32(data)
        const local = Buffer.alloc(30)
        local.writeUInt32LE(0x04034b50, 0)
        local.writeUInt16LE(20, 4) // version needed: 2.0
        local.writeUInt16LE(0x0800, 6) // names are UTF-8
        local.writeUInt16LE(stored ? 0 : 8, 8)
        local.writeUInt16LE(DOS_TIME, 10)
        local.writeUInt16LE(DOS_DATE, 12)
        local.writeUInt32LE(crc, 14)
        local.writeUInt32LE(body.length, 18)
        local.writeUInt32LE(data.length, 22)
        local.writeUInt16LE(nameBuf.length, 26)
        local.writeUInt16LE(0, 28)
        const central = Buffer.alloc(46)
        central.writeUInt32LE(0x02014b50, 0)
        central.writeUInt16LE((3 << 8) | 20, 4) // made by: Unix, 2.0
        central.writeUInt16LE(20, 6)
        central.writeUInt16LE(0x0800, 8)
        central.writeUInt16LE(stored ? 0 : 8, 10)
        central.writeUInt16LE(DOS_TIME, 12)
        central.writeUInt16LE(DOS_DATE, 14)
        central.writeUInt32LE(crc, 16)
        central.writeUInt32LE(body.length, 20)
        central.writeUInt32LE(data.length, 24)
        central.writeUInt16LE(nameBuf.length, 28)
        central.writeUInt32LE((0o100644 << 16) >>> 0, 38) // a plain file, rw-r--r--
        central.writeUInt32LE(offset, 42)
        locals.push(local, nameBuf, body)
        centrals.push(central, nameBuf)
        offset += local.length + nameBuf.length + body.length
    }
    const directory = Buffer.concat(centrals)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(files.length, 8)
    end.writeUInt16LE(files.length, 10)
    end.writeUInt32LE(directory.length, 12)
    end.writeUInt32LE(offset, 16)
    return Buffer.concat([...locals, directory, end])
}

// Every file under `dir`, as [relative name, Buffer], in name order.
export function filesIn(dir) {
    const out = []
    const walk = (sub) => {
        for (const entry of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
            const rel = sub ? `${sub}/${entry.name}` : entry.name
            if (entry.isDirectory()) walk(rel)
            else if (entry.isFile()) out.push(rel)
        }
    }
    walk('')
    return out.sort().map((name) => [name, fs.readFileSync(path.join(dir, name))])
}

// The entries of an archive this module wrote (or any zip without zip64
// or data descriptors): [name, Buffer] pairs. For the tests.
export function unzip(buf) {
    const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    const count = buf.readUInt16LE(end + 10)
    let at = buf.readUInt32LE(end + 16)
    const out = []
    for (let i = 0; i < count; i++) {
        const method = buf.readUInt16LE(at + 10)
        const size = buf.readUInt32LE(at + 20)
        const nameLength = buf.readUInt16LE(at + 28)
        const extra = buf.readUInt16LE(at + 30)
        const comment = buf.readUInt16LE(at + 32)
        const local = buf.readUInt32LE(at + 42)
        const name = buf.toString('utf8', at + 46, at + 46 + nameLength)
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
        const body = buf.subarray(start, start + size)
        out.push([name, method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body)])
        at += 46 + nameLength + extra + comment
    }
    return out
}
