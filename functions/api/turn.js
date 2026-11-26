// GET /api/turn: short-lived credentials for Cloudflare's TURN relay, so two
// browsers that cannot reach each other directly (strict NAT on both sides,
// as a phone on a cellular network often is) can still chat through it. A
// Cloudflare Pages Function, deployed with the site (scripts/deploy.js sets
// its variables); the dev server runs it too (scripts/serve.js).
//
// TURN bills by the GB of egress past a monthly free allowance (1,000 GB,
// 2026-11-23), and Cloudflare offers alerts but no cap. So this is the cap:
// before minting, it reads the account's TURN egress over the last
// TURN_CAP_DAYS days (GraphQL analytics, which lag about 30 s) and, at
// TURN_CAP_GB or past it, mints nothing; browsers then connect directly or
// not at all. The window slides, so the relay comes back as old traffic
// leaves it: at the defaults, 90 GB in any 3 days, a month can never pass
// 930 GB, and a spike stops it within days rather than at the month's end.
// Credentials live TURN_TTL seconds (an hour), so relaying stops within
// about that long of reaching the cap. If the usage cannot be read, it
// mints nothing: a relay that cannot be counted is not handed out.
//
// With ALERT_WEBHOOK (a Discord webhook), it says so in a channel, as "The
// Source": at half the cap, at the cap, and when the usage cannot be read.
// Every copy of the function that sees it would send it, so each alert is
// sent at most once per window by each isolate and, through the Cache API,
// about once per data center (the cache is not shared between them, and is
// a no-op on *.pages.dev, so a few repeats can happen).
//
// Variables (Pages project settings):
//   TURN_KEY_ID, TURN_KEY_TOKEN  the TURN key (the token is a secret)
//   ACCOUNT_ID, TURN_USAGE_TOKEN the account, and a token that can only
//                                read its analytics (a secret)
//   TURN_CAP_GB, TURN_CAP_DAYS   egress over a sliding window of days at
//                                which minting stops (90 GB, 3 days)
//   TURN_TTL                     seconds each credential lives
//   ALERT_WEBHOOK                Discord webhook for alerts (a secret)

const MINT = (key) =>
    `https://rtc.live.cloudflare.com/v1/turn/keys/${key}/credentials/generate-ice-servers`
const GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql'
const USAGE_FRESH = 60000 // ms an isolate trusts the usage it read

let usage = { at: 0, bytes: 0 }
const alerted = {} // alert -> when this isolate last sent it

const reply = (body, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store'
        }
    })
const none = (reason, status) => reply({ iceServers: [], reason }, status)

// POST JSON, with a bearer token when there is one.
const post = (url, body, token) =>
    fetch(url, {
        method: 'POST',
        headers: {
            ...(token && { Authorization: `Bearer ${token}` }),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    })

// TURN egress over the last `days` days, in bytes, for the whole account.
export async function windowEgress(env, days, now = new Date()) {
    if (now.getTime() - usage.at < USAGE_FRESH) return usage.bytes
    const start = new Date(now.getTime() - days * 86400000).toISOString()
    const query = `query ($account: String!, $start: Time!, $end: Time!) {
        viewer { accounts(filter: { accountTag: $account }) {
            callsTurnUsageAdaptiveGroups(limit: 1, filter: { datetime_geq: $start, datetime_lt: $end }) { sum { egressBytes } }
        } }
    }`
    const response = await post(
        GRAPHQL,
        {
            query,
            variables: {
                account: env.ACCOUNT_ID,
                start,
                end: now.toISOString()
            }
        },
        env.TURN_USAGE_TOKEN
    )
    const payload = await response.json()
    if (!response.ok || payload.errors?.length)
        throw new Error(
            `usage: HTTP ${response.status} ${JSON.stringify(payload.errors || '')}`
        )
    const groups =
        payload.data?.viewer?.accounts?.[0]?.callsTurnUsageAdaptiveGroups
    if (!Array.isArray(groups)) throw new Error('usage: unexpected answer')
    usage = {
        at: now.getTime(),
        bytes: Number(groups[0]?.sum?.egressBytes) || 0
    }
    return usage.bytes
}

const gb = (bytes) => `${(bytes / 1e9).toFixed(1)} GB`

// What each alert says. `cap` and `days` are the settings, `bytes` the usage.
export function alertText(kind, { bytes, cap, days, error }) {
    const window = `the last ${days} day${days === 1 ? '' : 's'}`
    const said = {
        half: `The chat's TURN relay has used ${gb(bytes)} of its ${gb(cap)} cap over ${window}. It keeps running; at the cap it stops until older traffic leaves the window.`,
        cap: `The chat's TURN relay reached its cap: ${gb(bytes)} of ${gb(cap)} over ${window}. It hands out no credentials until older traffic leaves the window; until then, browsers that cannot reach each other directly cannot chat.`,
        unknown: `The chat's TURN relay cannot read its usage, so it hands out no credentials: ${error}`
    }
    return `**Cloudflare limits**\n${said[kind]}`
}

// Post an alert to the webhook, unless this isolate or this data center has
// sent the same one within `days`. Never throws: an alert is not worth a
// failed request.
export async function alert(env, kind, facts, now = Date.now()) {
    if (!env.ALERT_WEBHOOK) return
    const quiet = facts.days * 86400000
    if (now - (alerted[kind] || 0) < quiet) return
    alerted[kind] = now
    try {
        const cache = globalThis.caches?.default
        const mark = new Request(`https://alerts.invalid/turn/${kind}`)
        if (cache && (await cache.match(mark))) return
        const response = await post(env.ALERT_WEBHOOK, {
            username: 'The Source',
            content: alertText(kind, facts),
            allowed_mentions: { parse: [] }
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        if (cache)
            await cache.put(
                mark,
                new Response('sent', {
                    headers: {
                        'Cache-Control': `max-age=${Math.round(quiet / 1000)}`
                    }
                })
            )
    } catch (err) {
        console.log(`alert: ${err.message}`)
    }
}

export async function onRequestGet(context) {
    const { request, env } = context
    // Alerts go out after the reply; the dev server has no waitUntil.
    const later = (promise) =>
        context.waitUntil ? context.waitUntil(promise) : promise
    if (
        !env.TURN_KEY_ID ||
        !env.TURN_KEY_TOKEN ||
        !env.ACCOUNT_ID ||
        !env.TURN_USAGE_TOKEN
    )
        return none('off')
    // Only the site's own pages, and the browser extension's (Chrome says
    // "none" for an extension with access to the site, Firefox
    // "same-origin"). Scripts can lie about this; other sites' pages cannot.
    const site = request.headers.get('Sec-Fetch-Site')
    if (site && site !== 'same-origin' && site !== 'none')
        return none('forbidden', 403)
    const cap = Number(env.TURN_CAP_GB ?? 90) * 1e9
    const days = Number(env.TURN_CAP_DAYS) > 0 ? Number(env.TURN_CAP_DAYS) : 3
    const ttl = Math.min(Math.max(Number(env.TURN_TTL) || 3600, 300), 172800)
    try {
        const bytes = await windowEgress(env, days)
        if (bytes >= cap) {
            later(alert(env, 'cap', { bytes, cap, days }))
            return none('cap')
        }
        if (bytes >= cap / 2) later(alert(env, 'half', { bytes, cap, days }))
    } catch (err) {
        console.log(err.message)
        later(alert(env, 'unknown', { cap, days, error: err.message }))
        return none('usage unknown')
    }
    const response = await post(
        MINT(env.TURN_KEY_ID),
        { ttl },
        env.TURN_KEY_TOKEN
    )
    if (!response.ok) {
        console.log(`mint: HTTP ${response.status}`)
        return none('mint failed')
    }
    const { iceServers = [] } = await response.json()
    // The page does not trickle candidates (WebTorrent's trackers send an
    // offer once gathering is done), so every URL here delays every offer
    // until it answers or times out, and each is one more allocation per
    // offer. Kept: STUN, TURN over UDP on 3478, and TURN over TLS on 443 for
    // networks that let little else out. Never port 53, which Cloudflare
    // warns times out in browsers.
    const keep = (url) =>
        (/^stun:/.test(url) && !/:53$/.test(url)) ||
        /^turn:[^?]*:3478\?transport=udp$/.test(url) ||
        /^turns:[^?]*:443\?transport=tcp$/.test(url)
    const servers = iceServers
        .map((server) => ({
            ...server,
            urls: [].concat(server.urls).filter(keep)
        }))
        .filter((server) => server.urls.length)
    return reply({ iceServers: servers, ttl })
}
