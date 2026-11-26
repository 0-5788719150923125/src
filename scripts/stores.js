// Upload the browser extension (scripts/extension.js) to the stores, from
// this machine, the way the site deploys: `node main.js --publish chrome`,
// `firefox` or `all`. It shows the plan and asks first (--yes skips the
// question). Only the user publishes.
//
// Chrome Web Store, API v2 (v1.1 was retired in October 2026). The API
// cannot create an item: the first upload, the store listing and the
// privacy answers are made once in the developer dashboard; after that,
// this uploads the zip, waits for it to be processed, and submits it for
// review (or stages it, CHROME_PUBLISH=staged, to publish by hand once
// approved). OAuth with a refresh token:
//   CHROME_EXTENSION_ID     the item's id, from the dashboard
//   CHROME_PUBLISHER_ID     Account > Publisher ID in the dashboard
//   CHROME_CLIENT_ID, CHROME_CLIENT_SECRET, CHROME_REFRESH_TOKEN
//                           an OAuth client (Google Cloud console, with the
//                           Chrome Web Store API enabled) and a refresh
//                           token for the scope
//                           https://www.googleapis.com/auth/chromewebstore
//
// addons.mozilla.org, API v5. It uploads the zip to the listed channel,
// waits for validation, then adds it as a new version, with the source
// archive attached for the reviewers (scripts/extension.js sourceArchive).
// The first time, it creates the listing too: name from the manifest,
// summary and description from src/text/<language>/extension.md, the MIT
// license, and CATEGORIES. JWT with an API key from
// https://addons.mozilla.org/developers/addon/api/key/:
//   AMO_JWT_ISSUER, AMO_JWT_SECRET
// The add-on's id is the manifest's (scripts/extension.js GECKO_ID).
//
// Each store's version must be higher than the one it has: raise
// "version" in package.json before publishing again.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { ROOT, readText } from './build.js'
import { source, use } from '../src/js/text.js'

export const CHROME = {
    token: 'https://oauth2.googleapis.com/token',
    api: 'https://chromewebstore.googleapis.com'
}
export const AMO = 'https://addons.mozilla.org'
// addons.mozilla.org's categories for a new listing (at most 3).
export const CATEGORIES = ['social-communication', 'photos-music-videos']
const POLL_EVERY = 3000
const POLL_FOR = 10 * 60 * 1000

const needs = {
    chrome: ['CHROME_EXTENSION_ID', 'CHROME_PUBLISHER_ID', 'CHROME_CLIENT_ID', 'CHROME_CLIENT_SECRET', 'CHROME_REFRESH_TOKEN'],
    firefox: ['AMO_JWT_ISSUER', 'AMO_JWT_SECRET']
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// The body of a reply, parsed if JSON, and an error that says what the
// store said when the status is not a success.
async function answer(response, what) {
    const text = await response.text()
    let body = text
    try {
        body = JSON.parse(text)
    } catch {}
    if (!response.ok) throw new Error(`${what}: HTTP ${response.status} ${typeof body === 'string' ? body.slice(0, 500) : JSON.stringify(body).slice(0, 1000)}`)
    return body
}

// ------------------------------------------------------------ Chrome

export async function chromeToken(env, { fetch = globalThis.fetch, base = CHROME } = {}) {
    const response = await fetch(base.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: env.CHROME_CLIENT_ID,
            client_secret: env.CHROME_CLIENT_SECRET,
            refresh_token: env.CHROME_REFRESH_TOKEN,
            grant_type: 'refresh_token'
        })
    })
    const body = await answer(response, 'Google OAuth')
    if (!body.access_token) throw new Error('Google OAuth: no access token in the reply')
    return body.access_token
}

export async function publishChrome(archive, env, { fetch = globalThis.fetch, base = CHROME, log = console.log, pollEvery = POLL_EVERY } = {}) {
    const token = await chromeToken(env, { fetch, base })
    const item = `publishers/${encodeURIComponent(env.CHROME_PUBLISHER_ID)}/items/${encodeURIComponent(env.CHROME_EXTENSION_ID)}`
    const auth = { Authorization: `Bearer ${token}` }
    log(`[chrome] uploading ${path.basename(archive)}`)
    const uploaded = await answer(
        await fetch(`${base.api}/upload/v2/${item}:upload`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/zip' }, body: fs.readFileSync(archive) }),
        'Chrome Web Store upload'
    )
    let state = uploaded.uploadState
    // Large uploads are processed after the reply.
    const started = Date.now()
    while (state === 'IN_PROGRESS' || state === 'UPLOAD_IN_PROGRESS') {
        if (Date.now() - started > POLL_FOR) throw new Error('Chrome Web Store: the upload is still being processed; check the dashboard')
        await sleep(pollEvery)
        const status = await answer(await fetch(`${base.api}/v2/${item}:fetchStatus`, { headers: auth }), 'Chrome Web Store status')
        state = status.lastAsyncUploadState
    }
    if (state !== 'SUCCEEDED') throw new Error(`Chrome Web Store: upload ${state || 'failed'} ${JSON.stringify(uploaded.itemError || uploaded.errors || '')}`)
    log(`[chrome] uploaded version ${uploaded.crxVersion || '?'}`)
    const publishType = (env.CHROME_PUBLISH || '').toLowerCase() === 'staged' ? 'STAGED_PUBLISH' : 'DEFAULT_PUBLISH'
    const published = await answer(
        await fetch(`${base.api}/v2/${item}:publish`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ publishType }) }),
        'Chrome Web Store publish'
    )
    log(`[chrome] submitted (${publishType === 'STAGED_PUBLISH' ? 'staged: publish it from the dashboard once approved' : 'published once approved'}): ${published.state || JSON.stringify(published)}`)
    if (published.warningInfo) log(`[chrome] warnings: ${JSON.stringify(published.warningInfo)}`)
    return published
}

// ------------------------------------------------------------ Firefox

const base64url = (data) => Buffer.from(data).toString('base64url')

// A JWT for addons.mozilla.org: HS256, the API key as issuer, alive for a
// minute (the API takes at most five).
export function amoToken(issuer, secret, now = Math.floor(Date.now() / 1000)) {
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const payload = base64url(JSON.stringify({ iss: issuer, jti: crypto.randomUUID(), iat: now, exp: now + 60 }))
    const signature = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
    return `${header}.${payload}.${signature}`
}

// The listing's words, from extension.md in every language that has it.
export function listing(languages = readText()) {
    const summary = {}
    const description = {}
    for (const [language, files] of Object.entries(languages)) {
        if (!files.extension) continue
        use(files)
        const locale = language === 'en' ? 'en-US' : language
        summary[locale] = source('extension.summary')
        description[locale] = source('extension.listing')
    }
    use(languages.en)
    return { summary, description }
}

// What the reviewers read with each version: how to build it, and where
// the vendored files come from (extension.md, in English).
export function reviewerNotes(languages = readText()) {
    use(languages.en)
    return source('extension.reviewers')
}

export async function publishFirefox(archive, env, { id, version: number, sourceArchive = null, fetch = globalThis.fetch, base = AMO, log = console.log, pollEvery = POLL_EVERY, languages } = {}) {
    const auth = () => ({ Authorization: `JWT ${amoToken(env.AMO_JWT_ISSUER, env.AMO_JWT_SECRET)}` })
    const addon = `${base}/api/v5/addons/addon/${encodeURIComponent(id)}`
    const exists = await fetch(`${addon}/`, { headers: auth() })
    if (exists.status !== 200 && exists.status !== 404) await answer(exists, 'addons.mozilla.org')
    const isNew = exists.status === 404
    log(`[firefox] uploading ${path.basename(archive)}${isNew ? ' (a new add-on)' : ''}`)
    const form = new FormData()
    form.append('upload', new Blob([fs.readFileSync(archive)], { type: 'application/zip' }), path.basename(archive))
    form.append('channel', 'listed')
    let upload = await answer(await fetch(`${base}/api/v5/addons/upload/`, { method: 'POST', headers: auth(), body: form }), 'addons.mozilla.org upload')
    const started = Date.now()
    while (!upload.processed) {
        if (Date.now() - started > POLL_FOR) throw new Error('addons.mozilla.org: the upload is still being validated; check the developer hub')
        await sleep(pollEvery)
        upload = await answer(await fetch(`${base}/api/v5/addons/upload/${upload.uuid}/`, { headers: auth() }), 'addons.mozilla.org upload status')
    }
    const messages = upload.validation?.messages || []
    for (const m of messages.filter((m) => m.type === 'error' || m.type === 'warning')) log(`[firefox] ${m.type}: ${m.message}${m.file ? ` (${m.file})` : ''}`)
    if (!upload.valid) throw new Error(`addons.mozilla.org: the upload did not validate (${upload.validation?.errors ?? '?'} errors)`)
    const sourceFile = () => new Blob([fs.readFileSync(sourceArchive)], { type: 'application/zip' })
    if (isNew) {
        // The listing and its first version in one call; the source cannot
        // ride along (it is a file, the rest JSON), so it follows, on the
        // version, by its number.
        const { summary, description } = listing(languages)
        await answer(
            await fetch(`${addon}/`, {
                method: 'PUT',
                headers: { ...auth(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ categories: CATEGORIES, summary, description, version: { upload: upload.uuid, license: 'MIT', approval_notes: reviewerNotes(languages) } })
            }),
            'addons.mozilla.org new add-on'
        )
        if (sourceArchive) {
            const form = new FormData()
            form.append('source', sourceFile(), path.basename(sourceArchive))
            await answer(await fetch(`${addon}/versions/${encodeURIComponent(number)}/`, { method: 'PATCH', headers: auth(), body: form }), 'addons.mozilla.org source')
        }
    } else {
        // A new version keeps the last one's license.
        const form = new FormData()
        form.append('upload', upload.uuid)
        form.append('approval_notes', reviewerNotes(languages))
        if (sourceArchive) form.append('source', sourceFile(), path.basename(sourceArchive))
        await answer(await fetch(`${addon}/versions/`, { method: 'POST', headers: auth(), body: form }), 'addons.mozilla.org new version')
    }
    log(`[firefox] submitted version ${number} for review`)
    return { isNew, uuid: upload.uuid }
}

// ------------------------------------------------------------ the plan

async function askYes(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    try {
        return /^y(es)?$/i.test((await rl.question(question)).trim())
    } finally {
        rl.close()
    }
}

// `target` is chrome, firefox or all; `built` is buildExtension's list.
// `options` may carry `fetch`, `chromeBase`, `amoBase` and `pollEvery` (the
// tests use them).
export async function publish(target, { version, built, source: sourceArchive, yes = false, env = process.env, ask = askYes, log = console.log, ...options }) {
    const stores = { chrome: 'chromium', firefox: 'firefox' }
    const wanted = target === 'all' ? Object.keys(stores) : [target]
    if (!wanted.every((store) => stores[store])) {
        log(`[publish] unknown store "${target}": chrome, firefox or all`)
        return false
    }
    const plan = []
    for (const store of wanted) {
        const missing = needs[store].filter((name) => !env[name])
        if (missing.length) {
            log(`[publish] ${store}: not configured, skipped (set ${missing.join(', ')} in .env; see scripts/stores.js)`)
            continue
        }
        const archive = built.find((b) => b.browser === stores[store])?.archive
        if (!archive) continue
        plan.push({ store, archive })
    }
    if (!plan.length) return false
    const firefox = built.find((b) => b.browser === 'firefox')
    const id = firefox && JSON.parse(fs.readFileSync(path.join(firefox.dir, 'manifest.json'), 'utf8')).browser_specific_settings?.gecko?.id
    log(`[publish] version ${version}:`)
    for (const { store, archive } of plan) {
        const rel = path.relative(ROOT, archive)
        if (store === 'chrome') log(`  Chrome Web Store: upload ${rel} to item ${env.CHROME_EXTENSION_ID}, then ${(env.CHROME_PUBLISH || '').toLowerCase() === 'staged' ? 'stage it' : 'submit it for review (published once approved)'}`)
        if (store === 'firefox') log(`  addons.mozilla.org: upload ${rel} as ${id}, listed, with ${path.relative(ROOT, sourceArchive)} for the reviewers`)
    }
    if (!yes && !(await ask('Go ahead? [y/N] '))) {
        log('[publish] nothing sent')
        return false
    }
    let ok = true
    for (const { store, archive } of plan) {
        try {
            const { fetch = globalThis.fetch, pollEvery = POLL_EVERY, chromeBase = CHROME, amoBase = AMO } = options
            if (store === 'chrome') await publishChrome(archive, env, { fetch, base: chromeBase, log, pollEvery })
            if (store === 'firefox') await publishFirefox(archive, env, { id, version, sourceArchive, fetch, base: amoBase, log, pollEvery })
        } catch (err) {
            ok = false
            log(`[${store}] failed: ${err.message}`)
        }
    }
    return ok
}
