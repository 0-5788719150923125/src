// Keep the copyright year in LICENSE current, as praxis does: the year is
// written with its progress as a fraction (2026.889... late in November).
// Only the timestamp is rewritten; the holder after it stays as written.

import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './build.js'

const COPYRIGHT = /^(Copyright \(c\) )\d+(?:\.\d+)?/m

export function stamp(text, now = new Date()) {
    const year = now.getFullYear()
    const start = new Date(year, 0, 1)
    const end = new Date(year + 1, 0, 1)
    const fraction = String((now - start) / (end - start)).split('.')[1] ?? '0'
    return text.replace(COPYRIGHT, `$1${year}.${fraction}`)
}

export function updateLicense(file = path.join(ROOT, 'LICENSE')) {
    if (!fs.existsSync(file)) return
    const text = fs.readFileSync(file, 'utf8')
    const stamped = stamp(text)
    if (stamped !== text) fs.writeFileSync(file, stamped)
}
