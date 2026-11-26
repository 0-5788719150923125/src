import assert from 'node:assert/strict'
import test from 'node:test'
import { turnSettings } from '../scripts/turn.js'

const ENV = {
    TURN_KEY_ID: 'key',
    TURN_KEY_TOKEN: 'secret',
    ACCOUNT_ID: 'acct',
    TURN_USAGE_TOKEN: 'usage',
    TURN_CAP_GB: '90',
    TURN_CAP_DAYS: '3',
    TURN_TTL: '3600'
}
const HOOK = 'https://discord.test/api/webhooks/1/x'
const MINTED = {
    iceServers: [
        {
            urls: [
                'stun:stun.cloudflare.com:3478',
                'stun:stun.cloudflare.com:53'
            ]
        },
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
// Alerts go to `hook`; `fn` reuses a module, to see its isolate's memory.
async function call(
    env,
    { egress = 0, usage = 'ok', mint = 'ok', headers = {}, fn } = {}
) {
    const { onRequestGet } =
        fn || (await import(`../functions/api/turn.js?${Math.random()}`))
    const seen = []
    const hooks = []
    const original = globalThis.fetch
    globalThis.fetch = async (url, init) => {
        if (String(url) === HOOK) {
            hooks.push(JSON.parse(init.body))
            return new Response(null, { status: 204 })
        }
        seen.push({
            url: String(url),
            body: init.body && JSON.parse(init.body),
            auth: init.headers.Authorization
        })
        if (String(url).includes('graphql')) {
            if (usage !== 'ok')
                return new Response(
                    JSON.stringify({ errors: [{ message: 'no' }] }),
                    { status: 400 }
                )
            return Response.json({
                data: {
                    viewer: {
                        accounts: [
                            {
                                callsTurnUsageAdaptiveGroups:
                                    egress === null
                                        ? []
                                        : [{ sum: { egressBytes: egress } }]
                            }
                        ]
                    }
                }
            })
        }
        if (mint !== 'ok') return new Response('', { status: 500 })
        return Response.json(MINTED, { status: 201 })
    }
    const pending = []
    try {
        const response = await onRequestGet({
            request: new Request('https://src.eco/api/turn', { headers }),
            env,
            waitUntil: (p) => pending.push(p)
        })
        await Promise.all(pending)
        return {
            status: response.status,
            cache: response.headers.get('cache-control'),
            body: await response.json(),
            seen,
            hooks
        }
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
        {
            urls: [
                'turn:turn.cloudflare.com:3478?transport=udp',
                'turns:turn.cloudflare.com:443?transport=tcp'
            ],
            username: 'u',
            credential: 'c'
        }
    ])
    // The usage with the read-only token, then the mint with the key's.
    assert.equal(seen[0].auth, 'Bearer usage')
    assert.equal(seen[0].body.variables.account, 'acct')
    const { start, end } = seen[0].body.variables
    assert.equal(
        Date.parse(end) - Date.parse(start),
        3 * 86400000,
        'a 3-day window ending now'
    )
    assert.ok(Math.abs(Date.parse(end) - Date.now()) < 5000)
    assert.equal(
        seen[1].url,
        'https://rtc.live.cloudflare.com/v1/turn/keys/key/credentials/generate-ice-servers'
    )
    assert.equal(seen[1].auth, 'Bearer secret')
    assert.deepEqual(seen[1].body, { ttl: 3600 })
})

test('the window is TURN_CAP_DAYS long, 3 days when unset or nonsense', async () => {
    const span = async (env) => {
        const { start, end } = (await call(env)).seen[0].body.variables
        return (Date.parse(end) - Date.parse(start)) / 86400000
    }
    assert.equal(await span({ ...ENV, TURN_CAP_DAYS: '7' }), 7)
    assert.equal(await span({ ...ENV, TURN_CAP_DAYS: '' }), 3)
    assert.equal(await span({ ...ENV, TURN_CAP_DAYS: '-2' }), 3)
})

test('a window with no TURN use still mints', async () => {
    assert.equal((await call(ENV, { egress: null })).body.iceServers.length, 2)
})

test('mints nothing at the cap, or when the usage cannot be read', async () => {
    assert.equal(
        (await call(ENV, { egress: 89.9e9 })).body.iceServers.length,
        2,
        'just under'
    )
    const capped = await call(ENV, { egress: 90e9 })
    assert.deepEqual(capped.body, { iceServers: [], reason: 'cap' })
    assert.equal(capped.seen.length, 1, 'no mint call')
    assert.equal((await call({ ...ENV, TURN_CAP_GB: '0' })).body.reason, 'cap')
    assert.equal(
        (await call(ENV, { usage: 'broken' })).body.reason,
        'usage unknown'
    )
})

test('mints nothing without its variables, for other sites, or when minting fails', async () => {
    for (const name of Object.keys(ENV).filter(
        (k) => !k.startsWith('TURN_CAP') && k !== 'TURN_TTL'
    )) {
        const { body, seen } = await call({ ...ENV, [name]: '' })
        assert.equal(body.reason, 'off', name)
        assert.equal(seen.length, 0, name)
    }
    const cross = await call(ENV, {
        headers: { 'Sec-Fetch-Site': 'cross-site' }
    })
    assert.equal(cross.status, 403)
    assert.equal(cross.seen.length, 0)
    assert.equal(
        (await call(ENV, { headers: { 'Sec-Fetch-Site': 'same-site' } }))
            .status,
        403
    )
    assert.equal(
        (await call(ENV, { headers: { 'Sec-Fetch-Site': 'same-origin' } })).body
            .iceServers.length,
        2
    )
    // The browser extension, in Chrome.
    assert.equal(
        (await call(ENV, { headers: { 'Sec-Fetch-Site': 'none' } })).body
            .iceServers.length,
        2
    )
    assert.equal(
        (await call(ENV, { mint: 'broken' })).body.reason,
        'mint failed'
    )
})

test('the credential lifetime is kept between 5 minutes and 48 hours', async () => {
    assert.equal((await call({ ...ENV, TURN_TTL: '10' })).seen[1].body.ttl, 300)
    assert.equal(
        (await call({ ...ENV, TURN_TTL: '999999' })).seen[1].body.ttl,
        172800
    )
})

test('alerts the webhook as The Source at half the cap, at the cap, and when usage is unreadable', async () => {
    const hooked = { ...ENV, ALERT_WEBHOOK: HOOK }
    assert.equal(
        (await call(hooked, { egress: 44e9 })).hooks.length,
        0,
        'under half: quiet'
    )
    const half = (await call(hooked, { egress: 45e9 })).hooks
    assert.equal(half.length, 1)
    assert.equal(half[0].username, 'The Source')
    assert.deepEqual(half[0].allowed_mentions, { parse: [] })
    assert.match(
        half[0].content,
        /^\*\*Cloudflare limits\*\*\n.*45\.0 GB of its 90\.0 GB cap over the last 3 days/
    )
    const cap = await call(hooked, { egress: 91e9 })
    assert.equal(cap.body.reason, 'cap')
    assert.match(cap.hooks[0].content, /reached its cap: 91\.0 GB of 90\.0 GB/)
    assert.match(
        (await call(hooked, { usage: 'broken' })).hooks[0].content,
        /cannot read its usage/
    )
    assert.equal(
        (await call(ENV, { egress: 91e9 })).hooks.length,
        0,
        'no webhook, no alert'
    )
})

test('an isolate sends each alert once per window, and a failing webhook fails nothing', async () => {
    const fn = await import(`../functions/api/turn.js?${Math.random()}`)
    const hooked = { ...ENV, ALERT_WEBHOOK: HOOK }
    assert.equal((await call(hooked, { egress: 91e9, fn })).hooks.length, 1)
    assert.equal(
        (await call(hooked, { egress: 91e9, fn })).hooks.length,
        0,
        'not again'
    )
    const original = globalThis.fetch
    globalThis.fetch = async () => {
        throw new Error('down')
    }
    try {
        await fn.alert({ ALERT_WEBHOOK: HOOK }, 'half', {
            bytes: 1,
            cap: 2,
            days: 3
        })
    } finally {
        globalThis.fetch = original
    }
})

test('deploy settings: on by default, a cap over a window, and a lifetime', () => {
    assert.deepEqual(turnSettings({}), {
        cap: 90,
        days: 3,
        ttl: 3600,
        webhook: null
    })
    assert.deepEqual(
        turnSettings({
            CLOUDFLARE_TURN_CAP_GB: '100',
            CLOUDFLARE_TURN_CAP_DAYS: '7',
            CLOUDFLARE_TURN_TTL: '7200'
        }),
        { cap: 100, days: 7, ttl: 7200, webhook: null }
    )
    assert.deepEqual(
        turnSettings({
            CLOUDFLARE_TURN_CAP_GB: '-1',
            CLOUDFLARE_TURN_CAP_DAYS: '0',
            CLOUDFLARE_TURN_TTL: '5'
        }),
        { cap: 90, days: 3, ttl: 3600, webhook: null }
    )
    assert.equal(
        turnSettings({ CLOUDFLARE_ALERT_WEBHOOK: ` ${HOOK} ` }).webhook,
        HOOK
    )
    assert.throws(() =>
        turnSettings({ CLOUDFLARE_ALERT_WEBHOOK: 'http://example.com' })
    )
    for (const off of ['off', 'false', '0', 'no', 'OFF'])
        assert.equal(turnSettings({ CLOUDFLARE_TURN: off }), null)
})
