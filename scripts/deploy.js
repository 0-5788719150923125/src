// Deploy the built site to Cloudflare Pages, and take a deploy down again.
//
// Adapted from the cv project (itself from praxis/integrations/cloudflare):
// REST-only, fail-loud provisioning first (project, custom domain, proxied
// CNAME, re-validation), then a wrangler upload, then a cache purge that
// waits until the edge really serves the new build. Two gotchas inherited
// from there:
//
// - A project's pages.dev subdomain is NOT <project>.pages.dev; names are
//   globally unique, so a taken name gets a random suffix. Always fetch the
//   canonical subdomain from the API.
// - Cloudflare does not reliably create the DNS record for a Pages custom
//   domain. We create the proxied CNAME ourselves and re-validate.
//
// Credentials come from the environment or the repo's .env (gitignored):
//
//   CLOUDFLARE_API_TOKEN=...       Pages: Edit, plus DNS: Edit, Cache
//                                  Purge and Cache Rules: Edit on the zone
//                                  for a custom domain
//   CLOUDFLARE_ACCOUNT_ID=...
//   CLOUDFLARE_PAGES_DOMAIN=src.eco          optional custom domain
//   CLOUDFLARE_PAGES_PROJECT=src-eco         optional project name
//   CLOUDFLARE_PAGES_PRODUCTION_BRANCH=main  optional
//   CLOUDFLARE_R2_BUCKET=src-radio           optional: the radio's mirror
//   CLOUDFLARE_R2_DOMAIN=radio.src.eco       (both, or neither; mirror.js)
//   CLOUDFLARE_TURN=off                      optional: no chat relay (turn.js)
//   CLOUDFLARE_TURN_CAP_GB=90                the relay's cap, over
//   CLOUDFLARE_TURN_CAP_DAYS=3               a sliding window of days
//   CLOUDFLARE_ALERT_WEBHOOK=https://...     optional: Discord alerts
//
// Careful with the project: a deploy replaces everything a project serves.
// Both directions refuse a project that serves a custom domain other than
// the configured one (src-eco serves src.eco), so testing on dev.src.eco
// cannot replace or delete src.eco.
//
// With a custom domain, an existing CNAME at that name is pointed at Pages,
// and undeploy deletes it (it used to put the old target back; the user's
// call, 2026-11-22: a taken-down site leaves no record behind). Any other
// record at that name (A, AAAA) stops the deploy.
//
// Cache: Pages serves every file with max-age=0 and an ETag, so browsers
// ask again on each load (a 304 when nothing changed); with no hashed file
// names, anything longer mixes old and new modules. But a zone's Browser
// Cache TTL overrides that on a custom domain (4 hours on src.eco: the first
// deploy reached a phone hours late), so the deploy adds a cache rule for
// its domain alone that lets Pages' headers through, and leaves the zone's
// setting to its other sites. The zone's edge cache is purged after each
// upload.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import readline from 'node:readline/promises'
import { ROOT, filesUnder } from './build.js'
import { cf, findZone, found } from './cloudflare.js'
import { mirrorSettings, mirrorTeardown, syncMirror } from './mirror.js'
import { disableTurn, ensureTurn, turnSettings, turnTeardown } from './turn.js'

export const DEFAULT_PROJECT = 'src-eco'

const MARK = 'The Source'
const log = (message) => console.log(`[deploy] ${message}`)
const sleep = (seconds) =>
    new Promise((resolve) => setTimeout(resolve, seconds * 1000))
const branch = () =>
    (process.env.CLOUDFLARE_PAGES_PRODUCTION_BRANCH || 'main').trim()
const domainOf = (domain) =>
    (domain || process.env.CLOUDFLARE_PAGES_DOMAIN || '').trim()

// The project, or null if there is none.
const getProject = (account, project, token) =>
    found(`/accounts/${account}/pages/projects/${project}`, token)

// Refuse a project that serves custom domains besides the given one.
function refuseShared(info, domain, action) {
    const others = (info.domains || []).filter(
        (name) => name !== domain && name !== info.subdomain
    )
    if (!others.length) return
    throw new Error(
        `project '${info.name}' also serves ${others.join(', ')}; ${action} would take that site with it. ` +
            'Give this deploy a project of its own (CLOUDFLARE_PAGES_PROJECT in .env, or --project)'
    )
}

const dnsRecords = async (zone, domain, token) =>
    (await cf('GET', `/zones/${zone.id}/dns_records?name=${domain}`, token))
        .result || []

async function ensureCname(domain, subdomain, token) {
    const zone = await findZone(domain, token)
    if (!zone) {
        log(
            `no Cloudflare zone owns ${domain}; add a proxied CNAME -> ${subdomain} manually`
        )
        return false
    }
    const records = await dnsRecords(zone, domain, token)
    const blocking = records.find((r) => r.type === 'A' || r.type === 'AAAA')
    if (blocking)
        throw new Error(
            `${domain} has an ${blocking.type} record (${blocking.content}); remove it or pick another domain`
        )
    const record = {
        type: 'CNAME',
        name: domain,
        content: subdomain,
        proxied: true,
        comment: MARK
    }
    const cname = records.find((r) => r.type === 'CNAME')
    if (cname) {
        if (cname.content === subdomain && cname.proxied) return true
        await cf(
            'PATCH',
            `/zones/${zone.id}/dns_records/${cname.id}`,
            token,
            record
        )
        log(
            `pointed CNAME ${domain} at ${subdomain} (was ${cname.content}; undeploy deletes it)`
        )
        return true
    }
    await cf('POST', `/zones/${zone.id}/dns_records`, token, record)
    log(`created CNAME ${domain} -> ${subdomain} (proxied)`)
    return true
}

async function ensureDomainAttached(account, project, domain, token) {
    const route = `/accounts/${account}/pages/projects/${project}/domains`
    const names = ((await cf('GET', route, token)).result || []).map(
        (d) => d.name
    )
    if (!names.includes(domain)) {
        await cf('POST', route, token, { name: domain })
        log(`attached custom domain ${domain} to '${project}'`)
    }
}

// The zone's cache rules (one ruleset per zone and phase), or null.
const CACHE_PHASE = 'http_request_cache_settings'
const cacheRules = (zone, token) =>
    found(`/zones/${zone.id}/rulesets/phases/${CACHE_PHASE}/entrypoint`, token)

const cacheRuleName = (domain) => `${MARK}: ${domain}`
const findCacheRule = (rules, domain) =>
    (rules?.rules || []).find((r) => r.description === cacheRuleName(domain))

// Browsers keep the domain's files only as long as Pages says (max-age=0).
// A failure never fails the deploy, but is loud: visitors would get it late.
async function ensureCacheRule(domain, token) {
    const rule = {
        description: cacheRuleName(domain),
        expression: `(http.host eq "${domain}")`,
        action: 'set_cache_settings',
        action_parameters: { browser_ttl: { mode: 'respect_origin' } },
        enabled: true
    }
    try {
        const zone = await findZone(domain, token)
        if (!zone) return false
        const rules = await cacheRules(zone, token)
        const existing = findCacheRule(rules, domain)
        if (!rules) {
            await cf(
                'PUT',
                `/zones/${zone.id}/rulesets/phases/${CACHE_PHASE}/entrypoint`,
                token,
                { rules: [rule] }
            )
        } else if (!existing) {
            await cf(
                'POST',
                `/zones/${zone.id}/rulesets/${rules.id}/rules`,
                token,
                rule
            )
        } else if (
            existing.expression !== rule.expression ||
            existing.action_parameters?.browser_ttl?.mode !==
                'respect_origin' ||
            existing.enabled === false
        ) {
            await cf(
                'PATCH',
                `/zones/${zone.id}/rulesets/${rules.id}/rules/${existing.id}`,
                token,
                rule
            )
        } else {
            return true
        }
        log(
            `cache rule for ${domain}: browsers keep files as long as Pages says (revalidate each load)`
        )
        return true
    } catch (err) {
        log(`WARNING: could not set the cache rule (${err.message})`)
        log(
            `hint: the API token needs "Zone > Cache Rules > Edit"; until then, browsers keep ${domain}'s files for the zone's Browser Cache TTL`
        )
        return false
    }
}

function credentials(action) {
    const token = process.env.CLOUDFLARE_API_TOKEN
    const account = process.env.CLOUDFLARE_ACCOUNT_ID
    if (!token || !account)
        log(
            `CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not set; cannot ${action}`
        )
    return token && account ? { token, account } : null
}

// Provision the project and, if configured, its custom domain and DNS.
// Idempotent. Returns the canonical subdomain, or null.
export async function ensureInfrastructure(project, domain) {
    const creds = credentials('deploy')
    if (!creds) return null
    const { token, account } = creds
    try {
        let info = await getProject(account, project, token)
        if (info) {
            refuseShared(info, domain, 'a deploy')
        } else {
            await cf('POST', `/accounts/${account}/pages/projects`, token, {
                name: project,
                production_branch: branch()
            })
            log(`created Pages project '${project}'`)
            info = await getProject(account, project, token)
        }
        const { subdomain } = info
        if (domain && subdomain) {
            // The record first: Pages validates the domain as it is attached.
            await ensureCname(domain, subdomain, token)
            await ensureDomainAttached(account, project, domain, token)
            // Nudge Cloudflare to re-check the domain; once it is active,
            // the nudge may be refused, which changes nothing.
            await cf(
                'PATCH',
                `/accounts/${account}/pages/projects/${project}/domains/${domain}`,
                token
            ).catch((err) => log(`domain re-check not needed: ${err.message}`))
            await ensureCacheRule(domain, token)
        }
        log(
            `infrastructure ready: https://${domain || subdomain} (project '${project}' -> ${subdomain})`
        )
        return subdomain
    } catch (err) {
        log(`ERROR: Cloudflare bootstrap failed - ${err.message}`)
        return null
    }
}

// Evict this site's exact URLs from the edge cache (hostname purges are
// Enterprise-only). Needs the "Zone > Cache Purge" token permission.
async function purgeCache(domain, out, token) {
    const zone = await findZone(domain, token)
    if (!zone) {
        log(`no visible zone owns ${domain}; skipping cache purge`)
        return false
    }
    const urls = [
        `https://${domain}/`,
        ...filesUnder(out).map((name) => `https://${domain}/${name}`)
    ]
    try {
        // The purge endpoint takes at most 30 URLs per request.
        for (let i = 0; i < urls.length; i += 30) {
            await cf('POST', `/zones/${zone.id}/purge_cache`, token, {
                files: urls.slice(i, i + 30)
            })
        }
    } catch (err) {
        log(`cache purge failed (${err.message})`)
        log(
            'hint: the API token needs the "Zone > Cache Purge > Purge" permission'
        )
        return false
    }
    log(`purged ${urls.length} URLs from the edge cache`)
    return true
}

const buildId = (out) =>
    /name="src-build" content="([0-9a-f]+)"/.exec(
        fs.readFileSync(path.join(out, 'index.html'), 'utf8')
    )?.[1]

// Does the URL serve this build? `bust` adds a unique query string, which
// Cloudflare will not cache, so it reads the deployment itself. Returns
// null when the fetch fails, so "stale" and "unreachable" differ.
async function servesBuild(url, id, bust = false) {
    const target = bust ? `${url}?src-check=${crypto.randomUUID()}` : url
    const headers = {
        'User-Agent': `src-deploy/1.0 (+${url})`,
        ...(bust ? { 'Cache-Control': 'no-store' } : {})
    }
    try {
        const response = await fetch(target, {
            headers,
            signal: AbortSignal.timeout(30000)
        })
        return (await response.text()).includes(id)
    } catch {
        return null
    }
}

// Make the new build the one visitors get. A purge right after upload is
// not enough: Pages takes a few seconds to switch the custom domain over,
// and a purge inside that window lets the old deployment back into the
// cache; purges also reach Cloudflare's cache tiers unevenly, so checking
// too eagerly re-caches a stale copy. So: wait for the deployment to go
// live, then purge, wait and check in growing rounds, and always end on a
// purge.
async function settleCache(domain, out, token) {
    const id = buildId(out)
    if (!id) {
        log('no build fingerprint in index.html; purging without verification')
        return purgeCache(domain, out, token)
    }
    const url = `https://${domain}/`
    let live = false
    for (let attempt = 0; attempt < 20 && !live; attempt++) {
        live = await servesBuild(url, id, true)
        if (!live && attempt === 0)
            log('waiting for the deployment to go live at the edge...')
        if (!live) await sleep(3)
    }
    if (!live)
        log(
            'WARNING: the new deployment is not being served yet; purging anyway'
        )
    for (const wait of [12, 20, 30, 45]) {
        if (!(await purgeCache(domain, out, token))) return false
        log(`waiting ${wait}s for the purge to propagate...`)
        await sleep(wait)
        const served = await servesBuild(url, id)
        if (served) {
            log(`verified: ${url} serves build ${id}`)
            return true
        }
        if (served === null) {
            log(`could not reach ${url} to verify the purge`)
            return false
        }
        log('edge still serving an older build; purging again')
    }
    await purgeCache(domain, out, token)
    log(`WARNING: ${url} did not settle on build ${id}`)
    log(
        `the content IS deployed - ${url}?x=1 (uncacheable) proves it; the edge cache is lagging`
    )
    return false
}

const hasCommand = (name) =>
    spawnSync('sh', ['-c', `command -v ${name}`]).status === 0

export async function deploy(out, { project = DEFAULT_PROJECT, domain } = {}) {
    domain = domainOf(domain)
    const subdomain = await ensureInfrastructure(project, domain)
    if (!subdomain) return false
    const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } =
        process.env
    const wrangler = hasCommand('wrangler')
        ? ['wrangler']
        : ['npx', '--yes', 'wrangler']
    const target = `https://${domain || subdomain}`
    // The mirror first, so the site never names files it does not hold yet.
    // Its trouble never fails a deploy: peers still carry the radio.
    const mirror = mirrorSettings()
    if (mirror) await syncMirror(out, mirror)
    // The chat's relay, set in the project's variables before the upload so
    // this deployment has them. Its trouble never fails a deploy either:
    // chat still connects directly.
    try {
        const relay = turnSettings()
        if (relay) await ensureTurn(account, project, token, relay)
        else await disableTurn(account, project, token)
    } catch (err) {
        log(
            `WARNING: the chat relay is not set up (${err.message}); chat connects directly only`
        )
    }
    log(
        `uploading ${out} to '${project}' (branch '${branch()}' -> ${target})...`
    )
    // wrangler runs from the repository, so it finds functions/ (the site's
    // Pages Functions).
    const result = spawnSync(
        wrangler[0],
        [
            ...wrangler.slice(1),
            'pages',
            'deploy',
            out,
            '--project-name',
            project,
            '--branch',
            branch(),
            '--commit-dirty=true'
        ],
        { cwd: ROOT, env: process.env, encoding: 'utf8', timeout: 600000 }
    )
    if (result.status !== 0) {
        log(
            `upload failed (exit ${result.status}): ${(result.stderr || '').trim().slice(0, 500)}`
        )
        return false
    }
    const tail = (result.stdout || '').split('\n').filter((line) => line.trim())
    log(`upload succeeded. ${tail.at(-1) || ''}`)
    // Cache trouble never fails a deploy: the content is up either way.
    if (domain) await settleCache(domain, out, token)
    log(`live at ${target}`)
    return true
}

// Asks on the terminal; anything but yes (or no terminal) is no.
export async function confirm(question) {
    if (!process.stdin.isTTY) return false
    const prompt = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    })
    try {
        return /^y(es)?$/i.test(
            (await prompt.question(`${question} [y/N] `)).trim()
        )
    } finally {
        prompt.close()
    }
}

// A project with many deployments cannot be deleted until they are gone.
// The live one cannot be deleted at all, and goes with the project.
async function deleteDeployments(account, project, token) {
    const route = `/accounts/${account}/pages/projects/${project}/deployments`
    let deleted = 0
    for (;;) {
        const page =
            (await cf('GET', `${route}?per_page=25`, token)).result || []
        let progress = false
        for (const { id } of page) {
            try {
                await cf('DELETE', `${route}/${id}?force=true`, token)
                deleted++
                progress = true
            } catch (err) {
                log(`could not delete deployment ${id}: ${err.message}`)
            }
        }
        if (!progress) break
    }
    log(`deleted ${deleted} deployments`)
}

async function deleteProject(account, project, token) {
    const route = `/accounts/${account}/pages/projects/${project}`
    try {
        await cf('DELETE', route, token)
    } catch (err) {
        log(
            `could not delete the project at once (${err.message}); deleting its deployments first`
        )
        await deleteDeployments(account, project, token)
        await cf('DELETE', route, token)
    }
    log(`deleted Pages project '${project}'`)
}

// Take down what deploy() set up: the custom domain, its CNAME, its cache
// rule, the project with every deployment, the radio's mirror, and the
// chat's relay. Shows the plan and asks first, unless `yes`.
export async function undeploy({
    project = DEFAULT_PROJECT,
    domain,
    yes = false
} = {}) {
    domain = domainOf(domain)
    const creds = credentials('undeploy')
    if (!creds) return false
    const { token, account } = creds
    try {
        const info = await getProject(account, project, token)
        if (info) refuseShared(info, domain, 'undeploying it')
        const zone = domain ? await findZone(domain, token) : null
        const cname = zone
            ? (await dnsRecords(zone, domain, token)).find(
                  (r) => r.type === 'CNAME'
              )
            : null
        // The project's CNAME; with the project gone, one the deploy made
        // (its comment) that still points at Pages.
        const ours = Boolean(
            cname &&
            (info
                ? cname.content === info.subdomain
                : cname.comment?.startsWith(MARK) &&
                  cname.content.endsWith('.pages.dev'))
        )
        // Only the one record, by its id; never the zone or its other
        // records. A zone's root (src.eco itself) keeps even that: without
        // it the bare domain stops resolving, so it is left to change by hand.
        const apex = Boolean(zone && domain === zone.name)
        const deleteCname = ours && !apex
        const attached = Boolean(
            info && domain && info.domains?.includes(domain)
        )
        const rules = zone
            ? await cacheRules(zone, token).catch((err) => {
                  log(
                      `could not read the cache rules (${err.message}); leaving them as they are`
                  )
                  return null
              })
            : null
        const cacheRule = findCacheRule(rules, domain)
        const mirror = mirrorSettings()
        const teardown = mirror
            ? await mirrorTeardown(mirror)
            : { plan: [], run: async () => {} }
        const relay = await turnTeardown(account, project, token)

        const plan = []
        if (attached) plan.push(`detach ${domain} from '${project}'`)
        if (deleteCname)
            plan.push(
                `delete the CNAME ${domain} -> ${cname.content} (that record only)`
            )
        if (ours && apex)
            log(
                `leaving the CNAME ${domain} -> ${cname.content} alone: it is the root of the zone`
            )
        if (cacheRule) plan.push(`delete the cache rule for ${domain}`)
        if (info)
            plan.push(
                `delete the Pages project '${project}' (${info.subdomain}) and all its deployments`
            )
        plan.push(...teardown.plan, ...relay.plan)
        if (cname && !ours)
            log(
                `leaving the CNAME ${domain} -> ${cname.content} alone: it is not this project's`
            )
        if (!plan.length) {
            log(
                `nothing to undeploy: no project '${project}'${domain ? ` and no CNAME of its own at ${domain}` : ''}`
            )
            return true
        }
        log('this will:')
        for (const step of plan) log(`  - ${step}`)
        if (!yes && !(await confirm('[deploy] go ahead?'))) {
            log(
                process.stdin.isTTY
                    ? 'cancelled'
                    : 'not a terminal; pass --yes to undeploy without asking'
            )
            return false
        }

        if (attached) {
            await cf(
                'DELETE',
                `/accounts/${account}/pages/projects/${project}/domains/${domain}`,
                token
            )
            log(`detached ${domain}`)
        }
        if (deleteCname) {
            await cf(
                'DELETE',
                `/zones/${zone.id}/dns_records/${cname.id}`,
                token
            )
            log(`deleted the CNAME ${domain}`)
        }
        if (cacheRule) {
            await cf(
                'DELETE',
                `/zones/${zone.id}/rulesets/${rules.id}/rules/${cacheRule.id}`,
                token
            )
            log(`deleted the cache rule for ${domain}`)
        }
        if (info) await deleteProject(account, project, token)
        await teardown.run()
        await relay.run()
        log('undeployed')
        return true
    } catch (err) {
        log(`ERROR: undeploy failed - ${err.message}`)
        return false
    }
}
