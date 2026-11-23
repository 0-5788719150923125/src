// GET /api/turn: short-lived credentials for Cloudflare's TURN relay, so two
// browsers that cannot reach each other directly (strict NAT on both sides,
// as a phone on a cellular network often is) can still chat through it. A
// Cloudflare Pages Function, deployed with the site (scripts/deploy.js sets
// its variables); the dev server runs it too (scripts/serve.js).
//
// TURN bills by the GB of egress past a monthly free allowance (1,000 GB,
// 2026-11-23), and Cloudflare offers alerts but no cap. So this is the cap:
// before minting, it reads the account's TURN egress so far this month
// (GraphQL analytics, which lag about 30 s) and, at TURN_CAP_GB or past it,
// mints nothing; browsers then connect directly or not at all. Credentials
// live TURN_TTL seconds (an hour), so relaying stops within about that long
// of reaching the cap. If the usage cannot be read, it mints nothing: a
// relay that cannot be counted is not handed out.
//
// Variables (Pages project settings):
//   TURN_KEY_ID, TURN_KEY_TOKEN  the TURN key (the token is a secret)
//   ACCOUNT_ID, TURN_USAGE_TOKEN the account, and a token that can only
//                                read its analytics (a secret)
//   TURN_CAP_GB                  monthly egress at which minting stops
//   TURN_TTL                     seconds each credential lives

const MINT = (key) => `https://rtc.live.cloudflare.com/v1/turn/keys/${key}/credentials/generate-ice-servers`
const GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql'
const USAGE_FRESH = 60000 // ms an isolate trusts the usage it read

let usage = { at: 0, bytes: 0 }

const reply = (body, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    })

// TURN egress this calendar month (UTC), in bytes, for the whole account.
export async function monthEgress(env, now = new Date()) {
    if (now.getTime() - usage.at < USAGE_FRESH) return usage.bytes
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
    const query = `query ($account: String!, $start: Time!, $end: Time!) {
        viewer { accounts(filter: { accountTag: $account }) {
            callsTurnUsageAdaptiveGroups(limit: 1, filter: { datetime_geq: $start, datetime_lt: $end }) { sum { egressBytes } }
        } }
    }`
    const response = await fetch(GRAPHQL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.TURN_USAGE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { account: env.ACCOUNT_ID, start, end: now.toISOString() } })
    })
    const payload = await response.json()
    if (!response.ok || payload.errors?.length) throw new Error(`usage: HTTP ${response.status} ${JSON.stringify(payload.errors || '')}`)
    const groups = payload.data?.viewer?.accounts?.[0]?.callsTurnUsageAdaptiveGroups
    if (!Array.isArray(groups)) throw new Error('usage: unexpected answer')
    usage = { at: now.getTime(), bytes: Number(groups[0]?.sum?.egressBytes) || 0 }
    return usage.bytes
}

export async function onRequestGet({ request, env }) {
    if (!env.TURN_KEY_ID || !env.TURN_KEY_TOKEN || !env.ACCOUNT_ID || !env.TURN_USAGE_TOKEN) return reply({ iceServers: [], reason: 'off' })
    // Only the site's own pages. Scripts can lie about this; other sites'
    // pages cannot.
    const site = request.headers.get('Sec-Fetch-Site')
    if (site && site !== 'same-origin') return reply({ iceServers: [], reason: 'forbidden' }, 403)
    const cap = Number(env.TURN_CAP_GB ?? 800) * 1e9
    const ttl = Math.min(Math.max(Number(env.TURN_TTL) || 3600, 300), 172800)
    try {
        if ((await monthEgress(env)) >= cap) return reply({ iceServers: [], reason: 'cap' })
    } catch (err) {
        console.log(err.message)
        return reply({ iceServers: [], reason: 'usage unknown' })
    }
    const response = await fetch(MINT(env.TURN_KEY_ID), {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.TURN_KEY_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl })
    })
    if (!response.ok) {
        console.log(`mint: HTTP ${response.status}`)
        return reply({ iceServers: [], reason: 'mint failed' })
    }
    const { iceServers = [] } = await response.json()
    // The page does not trickle candidates (WebTorrent's trackers send an
    // offer once gathering is done), so every URL here delays every offer
    // until it answers or times out, and each is one more allocation per
    // offer. Kept: STUN, TURN over UDP on 3478, and TURN over TLS on 443 for
    // networks that let little else out. Never port 53, which Cloudflare
    // warns times out in browsers.
    const keep = (url) => (/^stun:/.test(url) && !/:53$/.test(url)) || /^turn:[^?]*:3478\?transport=udp$/.test(url) || /^turns:[^?]*:443\?transport=tcp$/.test(url)
    const servers = iceServers
        .map((server) => ({ ...server, urls: [].concat(server.urls).filter(keep) }))
        .filter((server) => server.urls.length)
    return reply({ iceServers: servers, ttl })
}
