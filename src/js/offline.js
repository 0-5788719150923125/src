// Messages for later. Typed while offline, a message is sealed under a new
// random key, and both are printed; /decrypt opens it again.

import { decrypt, encrypt, randomHex } from './crypto.js'
import { say } from './print.js'
import { randomBetween } from './random.js'
import { html, t } from './text.js'

export async function seal(message) {
    const key = randomHex(randomBetween(72, 96))
    say(html('offline.sealed', { message: await encrypt(message, key), key }), { block: true })
}

// /decrypt [message] [key]
export async function open([message, key]) {
    if (!message || !key) return say(html('offline.usage'))
    try {
        say(await decrypt(message, key))
    } catch {
        say(t('offline.failed'))
    }
}
