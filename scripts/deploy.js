// Deploy the built site to Cloudflare Pages.
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
//   CLOUDFLARE_API_TOKEN=...       Pages: Edit, plus DNS: Edit and Cache
//                                  Purge on the zone for a custom domain
//   CLOUDFLARE_ACCOUNT_ID=...
//   CLOUDFLARE_PAGES_DOMAIN=src.eco          optional custom domain
//   CLOUDFLARE_PAGES_PROJECT=src-eco         optional project name
//   CLOUDFLARE_PAGES_PRODUCTION_BRANCH=main  optional
//
// Careful: with a custom domain, an existing CNAME at that name is pointed
// at Pages.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const API = 'https://api.cloudflare.com/client/v4'
export const DEFAULT_PROJECT = 'src-eco'

const log = (message) => console.log(`[deploy] ${message}`)
const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000))

// Call the Cloudflare REST API; throws with the API's own error text.
async function cf(method, route, token, body) {
    const response = await fetch(API + route, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30000)
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
        const errors = (payload.errors || []).map((e) => e.message).join('; ')
        throw new Error(`${method} ${route} -> HTTP ${response.status}: ${errors || '?'}`)
    }
    return payload
}

async function projectSubdomain(account, project, token) {
    try {
        return (await cf('GET', `/accounts/${account}/pages/projects/${project}`, token)).result?.subdomain
    } catch {
        return null
    }
}

async function ensureProject(account, project, branch, token) {
    const existing = await projectSubdomain(account, project, token)
    if (existing) return existing
    await cf('POST', `/accounts/${account}/pages/projects`, token, { name: project, production_branch: branch })
    log(`created Pages project '${project}'`)
    return projectSubdomain(account, project, token)
}

// The zone whose name is the longest suffix of the domain.
async function findZone(domain, token) {
    const zones = (await cf('GET', '/zones?per_page=50', token)).result || []
    return zones
        .filter((z) => domain === z.name || domain.endsWith(`.${z.name}`))
        .sort((a, b) => b.name.length - a.name.length)[0]
}

async function ensureCname(domain, subdomain, token) {
    const zone = await findZone(domain, token)
    if (!zone) {
        log(`no Cloudflare zone owns ${domain}; add a proxied CNAME -> ${subdomain} manually`)
        return false
    }
    const records = (await cf('GET', `/zones/${zone.id}/dns_records?name=${domain}`, token)).result || []
    const record = { type: 'CNAME', name: domain, content: subdomain, proxied: true }
    const cname = records.find((r) => r.type === 'CNAME')
    if (cname) {
        if (cname.content === subdomain && cname.proxied) return true
        await cf('PATCH', `/zones/${zone.id}/dns_records/${cname.id}`, token, record)
        log(`updated CNAME ${domain} -> ${subdomain}`)
        return true
    }
    await cf('POST', `/zones/${zone.id}/dns_records`, token, { ...record, comment: 'The Source' })
    log(`created CNAME ${domain} -> ${subdomain} (proxied)`)
    return true
}

async function ensureDomainAttached(account, project, domain, token) {
    const route = `/accounts/${account}/pages/projects/${project}/domains`
    const names = ((await cf('GET', route, token)).result || []).map((d) => d.name)
    if (!names.includes(domain)) {
        await cf('POST', route, token, { name: domain })
        log(`attached custom domain ${domain} to '${project}'`)
    }
}

// Provision the project and, if configured, its custom domain and DNS.
// Idempotent. Returns the canonical subdomain, or null.
export async function ensureInfrastructure(project, domain) {
    const token = process.env.CLOUDFLARE_API_TOKEN
    const account = process.env.CLOUDFLARE_ACCOUNT_ID
    if (!token || !account) {
        log('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not set; cannot deploy')
        return null
    }
    const branch = (process.env.CLOUDFLARE_PAGES_PRODUCTION_BRANCH || 'main').trim()
    try {
        const subdomain = await ensureProject(account, project, branch, token)
        if (domain && subdomain) {
            await ensureDomainAttached(account, project, domain, token)
            await ensureCname(domain, subdomain, token)
            // Nudge Cloudflare to re-check the domain; harmless once active.
            await cf('PATCH', `/accounts/${account}/pages/projects/${project}/domains/${domain}`, token).catch(() => {})
        }
        log(`infrastructure ready: https://${domain || subdomain} (project '${project}' -> ${subdomain})`)
        return subdomain
    } catch (err) {
        log(`ERROR: Cloudflare bootstrap failed - ${err.message}`)
        return null
    }
}

const files = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name)
        return entry.isDirectory() ? files(full) : [full]
    })

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
        ...files(out).map((f) => `https://${domain}/${path.relative(out, f).split(path.sep).join('/')}`)
    ]
    try {
        // The purge endpoint takes at most 30 URLs per request.
        for (let i = 0; i < urls.length; i += 30) {
            await cf('POST', `/zones/${zone.id}/purge_cache`, token, { files: urls.slice(i, i + 30) })
        }
    } catch (err) {
        log(`cache purge failed (${err.message})`)
        log('hint: the API token needs the "Zone > Cache Purge > Purge" permission')
        return false
    }
    log(`purged ${urls.length} URLs from the edge cache`)
    return true
}

const buildId = (out) =>
    /name="src-build" content="([0-9a-f]+)"/.exec(fs.readFileSync(path.join(out, 'index.html'), 'utf8'))?.[1]

// Does the URL serve this build? `bust` adds a unique query string, which
// Cloudflare will not cache, so it reads the deployment itself. Returns
// null when the fetch fails, so "stale" and "unreachable" differ.
async function servesBuild(url, id, bust = false) {
    const target = bust ? `${url}?src-check=${crypto.randomUUID()}` : url
    const headers = { 'User-Agent': `src-deploy/1.0 (+${url})`, ...(bust ? { 'Cache-Control': 'no-store' } : {}) }
    try {
        const response = await fetch(target, { headers, signal: AbortSignal.timeout(30000) })
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
        if (!live && attempt === 0) log('waiting for the deployment to go live at the edge...')
        if (!live) await sleep(3)
    }
    if (!live) log('WARNING: the new deployment is not being served yet; purging anyway')
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
    log(`the content IS deployed - ${url}?x=1 (uncacheable) proves it; the edge cache is lagging`)
    return false
}

const hasCommand = (name) => spawnSync('sh', ['-c', `command -v ${name}`]).status === 0

export async function deploy(out, { project = DEFAULT_PROJECT, domain } = {}) {
    domain = (domain || process.env.CLOUDFLARE_PAGES_DOMAIN || '').trim()
    const subdomain = await ensureInfrastructure(project, domain)
    if (!subdomain) return false
    const wrangler = hasCommand('wrangler') ? ['wrangler'] : ['npx', '--yes', 'wrangler']
    const branch = (process.env.CLOUDFLARE_PAGES_PRODUCTION_BRANCH || 'main').trim()
    const target = `https://${domain || subdomain}`
    log(`uploading ${out} to '${project}' (branch '${branch}' -> ${target})...`)
    const result = spawnSync(
        wrangler[0],
        [...wrangler.slice(1), 'pages', 'deploy', out, '--project-name', project, '--branch', branch, '--commit-dirty=true'],
        { env: process.env, encoding: 'utf8', timeout: 600000 }
    )
    if (result.status !== 0) {
        log(`upload failed (exit ${result.status}): ${(result.stderr || '').trim().slice(0, 500)}`)
        return false
    }
    const tail = (result.stdout || '').split('\n').filter((line) => line.trim())
    log(`upload succeeded. ${tail.at(-1) || ''}`)
    // Cache trouble never fails a deploy: the content is up either way.
    if (domain) await settleCache(domain, out, process.env.CLOUDFLARE_API_TOKEN)
    log(`live at ${target}`)
    return true
}
