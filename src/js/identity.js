// Who you are: a key pair this browser makes for itself the first time it
// connects, and keeps, so everything it says in a room is signed by the same
// key. What is kept (localStorage) is a random secret, which always becomes
// the same Ed25519 key pair (crypto.js keysFor). There is nothing to choose
// and nothing to type; a browser that loses the secret becomes someone new.

import { keysFor, randomHex } from './crypto.js'
import { SPEAKERS, say } from './print.js'
import { t } from './text.js'

const STORED = 'identity' // localStorage: the secret

let keys = null

// A random hex secret kept in this browser under `key`, made the first
// time. A browser may refuse storage outright (some privacy settings throw
// on any use of it): then a new secret each visit.
export function keptSecret(key, length) {
    try {
        const kept = localStorage.getItem(key)
        if (kept) return kept
        const secret = randomHex(length)
        localStorage.setItem(key, secret)
        return secret
    } catch {
        return randomHex(length)
    }
}

// At start: this browser's keys, made the first time. Null when the browser
// cannot sign (no Ed25519), which keeps it out of the rooms: every message
// must be signed.
export async function signIn() {
    if (keys) return keys
    try {
        keys = await keysFor(keptSecret(STORED, 128))
    } catch (err) {
        console.error(err)
        say(t('id.unsupported'))
    }
    return keys
}

export const signedIn = () => keys

export const you = () => SPEAKERS.ink
