// The chat's relay: Cloudflare's TURN service, provisioned by the deploy
// for its Pages project and taken down with it. The site's function
// (functions/api/turn.js) mints short-lived credentials from a TURN key and
// stops at a cap over a sliding window of days, read from the account's
// analytics.
//
// The deploy makes (once; idempotent after):
// - a TURN key named "The Source: <project>",
// - an account API token named "The Source: <project> TURN usage" that can
//   only read the account's analytics (Account Analytics Read), for the
//   cap, so the deploy's own token never sits in the function,
// and stores both secrets in the project's variables, never on this
// machine: a secret Cloudflare shows only once, so a key or token whose
// secret the project lost is replaced. Undeploy deletes both (the
// variables go with the project).
//
//   CLOUDFLARE_TURN=off          no relay (the default is on)
//   CLOUDFLARE_TURN_CAP_GB=90    TURN egress over the window at which
//   CLOUDFLARE_TURN_CAP_DAYS=3   minting stops: 930 GB at most in a month
//                                (the account's free allowance is 1,000 GB,
//                                shared with Cloudflare's SFU)
//   CLOUDFLARE_TURN_TTL=3600     seconds each credential lives
//   CLOUDFLARE_ALERT_WEBHOOK=... a Discord webhook the function alerts
//                                (half the cap, the cap, usage unreadable);
//                                kept as a secret, with a hash of it in
//                                plain text so a change is seen; unset, the
//                                project's is removed
//
// The deploy token needs Realtime (or Calls) Admin, to make and delete the
// key, and Account API Tokens: Edit, to make and delete the usage token.

import crypto from 'node:crypto'
import { cf } from './cloudflare.js'

const MARK = 'The Source'
const ANALYTICS_READ = 'Account Analytics Read'
const log = (message) => console.log(`[relay] ${message}`)

const keyName = (project) => `${MARK}: ${project}`
const tokenName = (project) => `${MARK}: ${project} TURN usage`

export function turnSettings(env = process.env) {
    if (/^(off|false|0|no)$/i.test((env.CLOUDFLARE_TURN || '').trim()))
        return null
    const cap = Number(env.CLOUDFLARE_TURN_CAP_GB ?? 90)
    const days = Number(env.CLOUDFLARE_TURN_CAP_DAYS ?? 3)
    const ttl = Number(env.CLOUDFLARE_TURN_TTL ?? 3600)
    const webhook = (env.CLOUDFLARE_ALERT_WEBHOOK || '').trim()
    if (webhook && !/^https:\/\//.test(webhook))
        throw new Error('CLOUDFLARE_ALERT_WEBHOOK must be an https URL')
    return {
        cap: cap >= 0 ? cap : 90,
        days: days > 0 ? days : 3,
        ttl: ttl >= 300 && ttl <= 172800 ? ttl : 3600,
        webhook: webhook || null
    }
}

const findKey = async (account, project, token) =>
    (
        (await cf('GET', `/accounts/${account}/calls/turn_keys`, token))
            .result || []
    ).find((k) => k.name === keyName(project))

const findToken = async (account, project, token) =>
    (
        (await cf('GET', `/accounts/${account}/tokens?per_page=100`, token))
            .result || []
    ).find((t) => t.name === tokenName(project))

const deleteKey = (account, key, token) =>
    cf('DELETE', `/accounts/${account}/calls/turn_keys/${key.uid}`, token)
const deleteToken = (account, usage, token) =>
    cf('DELETE', `/accounts/${account}/tokens/${usage.id}`, token)

// Make sure the project has a TURN key, a usage token and the settings, in
// its variables (production and preview). Throws on trouble; the deploy
// reports it and goes on without the relay.
export async function ensureTurn(account, project, token, settings) {
    const info = (
        await cf('GET', `/accounts/${account}/pages/projects/${project}`, token)
    ).result
    const vars = info.deployment_configs?.production?.env_vars || {}
    const update = {}
    const plain = (value) => ({ type: 'plain_text', value: String(value) })
    const secret = (value) => ({ type: 'secret_text', value })

    let key = await findKey(account, project, token)
    if (!key || vars.TURN_KEY_ID?.value !== key.uid || !vars.TURN_KEY_TOKEN) {
        if (key) await deleteKey(account, key, token)
        key = (
            await cf('POST', `/accounts/${account}/calls/turn_keys`, token, {
                name: keyName(project)
            })
        ).result
        update.TURN_KEY_ID = plain(key.uid)
        update.TURN_KEY_TOKEN = secret(key.secret)
        log(`made the TURN key '${keyName(project)}'`)
    }

    let usage = await findToken(account, project, token)
    if (
        !usage ||
        vars.TURN_USAGE_TOKEN_ID?.value !== usage.id ||
        !vars.TURN_USAGE_TOKEN
    ) {
        if (usage) await deleteToken(account, usage, token)
        const groups =
            (
                await cf(
                    'GET',
                    `/accounts/${account}/tokens/permission_groups?name=${encodeURIComponent(ANALYTICS_READ)}`,
                    token
                )
            ).result || []
        const group = groups.find((g) => g.name === ANALYTICS_READ)
        if (!group) throw new Error(`no '${ANALYTICS_READ}' permission group`)
        usage = (
            await cf('POST', `/accounts/${account}/tokens`, token, {
                name: tokenName(project),
                policies: [
                    {
                        effect: 'allow',
                        resources: {
                            [`com.cloudflare.api.account.${account}`]: '*'
                        },
                        permission_groups: [{ id: group.id }]
                    }
                ]
            })
        ).result
        update.TURN_USAGE_TOKEN_ID = plain(usage.id)
        update.TURN_USAGE_TOKEN = secret(usage.value)
        log(`made the read-only usage token '${tokenName(project)}'`)
    }

    for (const [name, value] of [
        ['ACCOUNT_ID', account],
        ['TURN_CAP_GB', settings.cap],
        ['TURN_CAP_DAYS', settings.days],
        ['TURN_TTL', settings.ttl]
    ]) {
        if (vars[name]?.value !== String(value)) update[name] = plain(value)
    }
    // The webhook is a secret, which the API never shows again, so a short
    // hash of it beside it tells whether it changed. null removes a variable.
    const hook =
        settings.webhook &&
        crypto
            .createHash('sha256')
            .update(settings.webhook)
            .digest('hex')
            .slice(0, 16)
    if (
        hook &&
        (vars.ALERT_WEBHOOK_ID?.value !== hook || !vars.ALERT_WEBHOOK)
    ) {
        update.ALERT_WEBHOOK = secret(settings.webhook)
        update.ALERT_WEBHOOK_ID = plain(hook)
    } else if (!hook && (vars.ALERT_WEBHOOK || vars.ALERT_WEBHOOK_ID)) {
        update.ALERT_WEBHOOK = null
        update.ALERT_WEBHOOK_ID = null
    }
    if (Object.keys(update).length) {
        await cf(
            'PATCH',
            `/accounts/${account}/pages/projects/${project}`,
            token,
            {
                deployment_configs: {
                    production: { env_vars: update },
                    preview: { env_vars: update }
                }
            }
        )
        log(`set the project's ${Object.keys(update).sort().join(', ')}`)
    }
    log(
        `on: credentials for ${settings.ttl / 60} minutes, minting stops at ${settings.cap} GB of TURN egress in ${settings.days} days, ${hook ? 'alerts to Discord' : 'no alerts (CLOUDFLARE_ALERT_WEBHOOK)'}`
    )
}

// Turn the relay off for a project that has it (CLOUDFLARE_TURN=off): its
// key goes, so no credential can be minted.
export async function disableTurn(account, project, token) {
    const key = await findKey(account, project, token)
    if (!key) return
    await deleteKey(account, key, token)
    log(`off: deleted the TURN key '${keyName(project)}'`)
}

// What undeploy removes, as a plan and a step to run.
export async function turnTeardown(account, project, token) {
    const read = (find, what) =>
        find(account, project, token).catch((err) => {
            log(`could not read ${what} (${err.message}); leaving them alone`)
            return null
        })
    const key = await read(findKey, 'the TURN keys')
    const usage = await read(findToken, "the account's tokens")
    const plan = [
        ...(key ? [`delete the TURN key '${key.name}'`] : []),
        ...(usage ? [`delete the API token '${usage.name}'`] : [])
    ]
    const run = async () => {
        if (key) {
            await deleteKey(account, key, token)
            log(`deleted the TURN key '${key.name}'`)
        }
        if (usage) {
            await deleteToken(account, usage, token)
            log(`deleted the API token '${usage.name}'`)
        }
    }
    return { plan, run }
}
