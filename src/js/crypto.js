// Cryptography, all Web Crypto, so it runs the same in the browser and
// under Node: random keys, and Ed25519 for signed identities.

const bytes = (text) => new TextEncoder().encode(text)
const toBase64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
const toBase64Url = (buf) =>
    toBase64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromBase64Url = (text) =>
    fromBase64(text.replace(/-/g, '+').replace(/_/g, '/'))

// A random hex string, `length` characters long.
export function randomHex(length = 40) {
    const array = crypto.getRandomValues(new Uint8Array(length / 2))
    return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join(
        ''
    )
}

// ------------------------------------------------------------ Ed25519

// An Ed25519 private key in PKCS #8 is this prefix, then the 32-byte seed.
const PKCS8_ED25519 = [
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70,
    0x04, 0x22, 0x04, 0x20
]

// The same secret always gives the same key pair: its seed is
// SHA-256(secret). `pub` is the public key, base64url.
export async function keysFor(secret) {
    const seed = new Uint8Array(
        await crypto.subtle.digest('SHA-256', bytes(secret))
    )
    const pkcs8 = new Uint8Array([...PKCS8_ED25519, ...seed])
    const privateKey = await crypto.subtle.importKey(
        'pkcs8',
        pkcs8,
        { name: 'Ed25519' },
        true,
        ['sign']
    )
    const { x } = await crypto.subtle.exportKey('jwk', privateKey)
    return { privateKey, pub: x }
}

export const sign = async (keys, message) =>
    toBase64Url(
        await crypto.subtle.sign('Ed25519', keys.privateKey, bytes(message))
    )

export async function verify(pub, signature, message) {
    try {
        const key = await crypto.subtle.importKey(
            'jwk',
            { kty: 'OKP', crv: 'Ed25519', x: pub },
            { name: 'Ed25519' },
            false,
            ['verify']
        )
        return await crypto.subtle.verify(
            'Ed25519',
            key,
            fromBase64Url(signature),
            bytes(message)
        )
    } catch {
        return false
    }
}
