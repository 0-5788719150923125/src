// The browser extension's latest trace, read from the Firefox profiles on
// this machine (`node main.js --trace`). A development install keeps it in
// its background page's localStorage (extension/host.js), which Firefox
// stores in an SQLite file per origin, its larger values compressed with
// Snappy. Written to build/traces/, a step to a line. (Chrome keeps
// extension storage in LevelDB, which this does not read.)

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ROOT } from './build.js'

const ID = process.env.FIREFOX_EXTENSION_ID || 'src@src.eco'
const HOME = os.homedir()
const PROFILES = [
    path.join(HOME, '.mozilla', 'firefox'),
    path.join(HOME, '.config', 'mozilla', 'firefox'),
    path.join(HOME, 'Library', 'Application Support', 'Firefox', 'Profiles'),
    path.join(process.env.APPDATA ?? HOME, 'Mozilla', 'Firefox', 'Profiles')
]

// Raw Snappy (no framing): a varint length, then literals and copies.
function unsnappy(data) {
    let at = 0
    let size = 0
    for (let shift = 0, byte = 0x80; byte & 0x80; shift += 7) {
        byte = data[at++]
        size += (byte & 0x7f) * 2 ** shift
    }
    const out = Buffer.alloc(size)
    let o = 0
    while (at < data.length) {
        const tag = data[at++]
        const kind = tag & 3
        let length = (tag >> 2) + 1
        let offset
        if (kind === 0) {
            if (length > 60) {
                const bytes = length - 60
                length = data.readUIntLE(at, bytes) + 1
                at += bytes
            }
            data.copy(out, o, at, at + length)
            at += length
            o += length
            continue
        }
        if (kind === 1) {
            length = ((tag >> 2) & 7) + 4
            offset = ((tag >> 5) << 8) | data[at++]
        } else if (kind === 2) {
            offset = data.readUInt16LE(at)
            at += 2
        } else {
            offset = data.readUInt32LE(at)
            at += 4
        }
        for (let i = 0; i < length; i++, o++) out[o] = out[o - offset]
    }
    return out
}

// The trace a profile's copy of the extension keeps, or null. The database
// is copied first: Firefox may hold it locked while it runs.
function traceIn(profile) {
    const prefs = path.join(profile, 'prefs.js')
    if (!fs.existsSync(prefs)) return null
    const id = ID.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const uuid = new RegExp(`\\\\"${id}\\\\":\\\\"([0-9a-f-]+)`).exec(
        fs.readFileSync(prefs, 'utf8')
    )?.[1]
    const origin = `moz-extension+++${uuid}`
    const file = path.join(profile, 'storage', 'default', origin, 'ls')
    if (!uuid || !fs.existsSync(path.join(file, 'data.sqlite'))) return null
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'src-trace-'))
    try {
        for (const name of ['data.sqlite', 'data.sqlite-wal'])
            if (fs.existsSync(path.join(file, name)))
                fs.copyFileSync(path.join(file, name), path.join(copy, name))
        const db = new DatabaseSync(path.join(copy, 'data.sqlite'))
        const row = db
            .prepare(
                "SELECT value, conversion_type, compression_type FROM data WHERE key = 'trace'"
            )
            .get()
        db.close()
        if (!row) return null
        let value = Buffer.from(row.value)
        if (row.compression_type === 1) value = unsnappy(value)
        // Stored as UTF-8 when converted, else as UTF-16.
        const text = value.toString(
            row.conversion_type === 1 ? 'utf8' : 'utf16le'
        )
        return { profile: path.basename(profile), ...JSON.parse(text) }
    } finally {
        fs.rmSync(copy, { recursive: true, force: true })
    }
}

export function readTrace(roots = PROFILES) {
    const found = roots
        .filter((root) => fs.existsSync(root))
        .flatMap((root) =>
            fs.readdirSync(root).map((name) => path.join(root, name))
        )
        .map(traceIn)
        .filter(Boolean)
        .sort((a, b) => b.at - a.at)
    if (!found.length) {
        console.log(
            '[trace] none found: is a development copy of the extension loaded in Firefox, and Tab used in a page field since?'
        )
        return false
    }
    const { steps = [], ...about } = found[0]
    const dir = path.join(ROOT, 'build', 'traces')
    const file = path.join(
        dir,
        `${new Date(about.at).toISOString().replace(/[:.]/g, '-')}.json`
    )
    const lines = steps.map((step) => JSON.stringify(step)).join(',\n')
    const head = JSON.stringify(about).slice(0, -1)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(file, `${head},"steps":[\n${lines}\n]}\n`)
    const age = Math.round((Date.now() - about.at) / 1000)
    console.log(
        `[trace] ${path.relative(ROOT, file)}: ${steps.length} steps on ${about.site}, ${age} s ago, from ${about.profile}`
    )
    return true
}
