// Load KEY=VALUE lines from the repo's .env into process.env. Variables
// already set in the environment win.

import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './build.js'

export function loadEnv(file = path.join(ROOT, '.env')) {
    if (!fs.existsSync(file)) return
    for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
        const line = raw.trim()
        const at = line.indexOf('=')
        if (line.startsWith('#') || at < 1) continue
        const key = line.slice(0, at).trim()
        const value = line
            .slice(at + 1)
            .trim()
            .replace(/^(['"])(.*)\1$/, '$2')
        if (process.env[key] === undefined) process.env[key] = value
    }
}
