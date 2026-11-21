// Who you are. An identity is a secret of 96 characters or more, and it
// deterministically becomes an Ed25519 key pair (crypto.js), so the same
// identity signs as the same sender on any device. /id chooses one;
// /connect signs in with it, and the tab remembers it until it closes.

import { keysFor, randomHex } from './crypto.js'
import { SPEAKERS, say } from './print.js'
import { randomBetween } from './random.js'
import { html, t } from './text.js'

const MIN_LENGTH = 96
const STORED = 'identity' // sessionStorage

let chosen = null
let keys = null

// /id [identity], or /id auto for a new one.
export async function choose([identity]) {
    if (identity === undefined) return say(html('id.usage'))
    if (identity === 'auto') {
        sessionStorage.removeItem(STORED)
        chosen = randomHex(randomBetween(MIN_LENGTH, 128))
        const { pub } = await keysFor(chosen)
        return say(html('id.created', { identity: chosen, identifier: pub }), { block: true })
    }
    if (identity.length < MIN_LENGTH) return say(t('id.short', { min: MIN_LENGTH }))
    chosen = identity
    say(t('id.accepted'))
}

// At /connect: the keys of the chosen identity, or of the one this tab used
// last. Null when there is none, or when the browser cannot sign.
export async function signIn() {
    const identity = chosen || sessionStorage.getItem(STORED)
    if (!identity) return null
    try {
        keys = await keysFor(identity)
        sessionStorage.setItem(STORED, identity)
    } catch (err) {
        console.error(err)
        say(t('id.unsupported'))
    }
    return keys
}

export const signedIn = () => keys

export const you = () => (keys ? SPEAKERS.one : SPEAKERS.ink)
