import assert from 'node:assert/strict'
import test from 'node:test'
import { turnSettings } from '../scripts/turn.js'

const ENV = { TURN_KEY_ID: 'key', TURN_KEY_TOKEN: 'secret', ACCOUNT_ID: 'acct', TURN_USAGE_TOKEN: 'usage', TURN_CAP_GB: '800', TURN_TTL: '3600' }
const MINTED = {
    iceServers: [
        { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
        {
            urls: [
                'turn:turn.cloudflare.com:3478?transport=udp',
                'turn:turn.cloudflare.com:53?transport=udp',
                'turn:turn.cloudflare.com:3478?transport=tcp',
                'turns:turn.cloudflare.com:5349?transport=tcp',
                'turns:turn.cloudflare.com:443?transport=tcp'
            ],
            username: 'u',
            credential: 'c'
        }
    ]
}

// The function, fresh (its usage cache is per module), with fetch answering
// the analytics with `egress` bytes and the mint with MINTED.
async function call(env, { egress = 0, usage = 'ok', mint = 'ok', headers = {} } = {}) {
    const { onRequestGet } = await import(`../functions/api/turn.js?${Math.random()}`)
    const seen = []
    const original = globalThis.fetch
    globalThis.fetch = async (url, init) => {
        seen.push({ url: String(url), body: init.body && JSON.parse(init.body), auth: init.headers.Authorization })
        if (String(url).includes('graphql')) {
            if (usage !== 'ok') return new Response(JSON.stringify({ errors: [{ message: 'no' }] }), { status: 400 })
            return Response.json({ data: { viewer: { accounts: [{ callsTurnUsageAdaptiveGroups: egress === null ? [] : [{ sum: { egressBytes: egress } }] }] } } })
        }
        if (mint !== 'ok') return new Response('', { status: 500 })
        return Response.json(MINTED, { status: 201 })
    }
    try {
        const response = await onRequestGet({ request: new Request('https://src.eco/api/turn', { headers }), env })
        return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json(), seen }
    } finally {
        globalThis.fetch = original
    }
}

test('mints credentials, keeping STUN, TURN over UDP 3478 and TLS 443, never port 53', async () => {
    const { status, cache, body, seen } = await call(ENV, { egress: 5e9 })
    assert.equal(status, 200)
    assert.equal(cache, 'no-store')
    assert.equal(body.ttl, 3600)
    assert.deepEqual(body.iceServers, [
        { urls: ['stun:stun.cloudflare.com:3478'] },
        { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' }
    ])
    // The usage with the read-only token, then the mint with the key's.
    assert.equal(seen[0].auth, 'Bearer usage')
    assert.equal(seen[0].body.variables.account, 'acct')
    assert.match(seen[0].body.variables.start, /^\d{4}-\d\d-01T00:00:00\.000Z$/)
    assert.equal(seen[1].url, 'https://rtc.live.cloudflare.com/v1/turn/keys/key/credentials/generate-ice-servers')
    assert.equal(seen[1].auth, 'Bearer secret')
    assert.deepEqual(seen[1].body, { ttl: 3600 })
})

test('a month with no TURN use yet still mints', async () => {
    assert.equal((await call(ENV, { egress: null })).body.iceServers.length, 2)
})

test('mints nothing at the cap, or when the usage cannot be read', async () => {
    const capped = await call(ENV, { egress: 800e9 })
    assert.deepEqual(capped.body, { iceServers: [], reason: 'cap' })
    assert.equal(capped.seen.length, 1, 'no mint call')
    assert.equal((await call({ ...ENV, TURN_CAP_GB: '0' })).body.reason, 'cap')
    assert.equal((await call(ENV, { usage: 'broken' })).body.reason, 'usage unknown')
})

test('mints nothing without its variables, for other sites, or when minting fails', async () => {
    for (const name of Object.keys(ENV).filter((k) => !k.startsWith('TURN_CAP') && k !== 'TURN_TTL')) {
        const { body, seen } = await call({ ...ENV, [name]: '' })
        assert.equal(body.reason, 'off', name)
        assert.equal(seen.length, 0, name)
    }
    const cross = await call(ENV, { headers: { 'Sec-Fetch-Site': 'cross-site' } })
    assert.equal(cross.status, 403)
    assert.equal(cross.seen.length, 0)
    assert.equal((await call(ENV, { headers: { 'Sec-Fetch-Site': 'same-origin' } })).body.iceServers.length, 2)
    assert.equal((await call(ENV, { mint: 'broken' })).body.reason, 'mint failed')
})

test('the credential lifetime is kept between 5 minutes and 48 hours', async () => {
    assert.equal((await call({ ...ENV, TURN_TTL: '10' })).seen[1].body.ttl, 300)
    assert.equal((await call({ ...ENV, TURN_TTL: '999999' })).seen[1].body.ttl, 172800)
})

test('deploy settings: on by default, a cap and a lifetime', () => {
    assert.deepEqual(turnSettings({}), { cap: 800, ttl: 3600 })
    assert.deepEqual(turnSettings({ CLOUDFLARE_TURN_CAP_GB: '100', CLOUDFLARE_TURN_TTL: '7200' }), { cap: 100, ttl: 7200 })
    assert.deepEqual(turnSettings({ CLOUDFLARE_TURN_CAP_GB: '-1', CLOUDFLARE_TURN_TTL: '5' }), { cap: 800, ttl: 3600 })
    for (const off of ['off', 'false', '0', 'no', 'OFF']) assert.equal(turnSettings({ CLOUDFLARE_TURN: off }), null)
})
