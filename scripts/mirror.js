// The radio's mirror: every station's files in a Cloudflare R2 bucket,
// served at a domain of its own (CLOUDFLARE_R2_BUCKET, CLOUDFLARE_R2_DOMAIN).
// Browsers fetch from it only when no peer has a song (src/js/radio.js adds
// it as a web seed then); the swarm stays first. R2 charges nothing for
// downloads, so the mirror costs nothing while the stations fit in its free
// storage (10 GB).
//
// Keys are content-addressed: <info hash>/<station>/<path>, so a URL never
// changes what it serves (no cache to purge, and a station that changes is a
// new prefix; the old one is deleted). Only the files of the .torrent the
// build bundled are uploaded, from the station's folder on this machine
// (STATION_59_1 in .env, as for the stack), and only after every piece of the
// folder has been checked against the .torrent's hashes: a mirror that
// differs from what the seeder hashed would serve nothing a browser accepts.
//
// Whatever serves a mirror must clamp a range that runs past a file's end,
// as HTTP says to (R2 does, as S3 does): WebTorrent 2.x computes the end of
// a range wrong for every file but a torrent's first (webconn.js mixes the
// file's absolute end into a relative one), so the last piece of most songs
// asks for bytes beyond the file. A server that answers that literally
// never delivers that piece.
//
// Buckets, CORS and the domain go through Cloudflare's REST API; objects go
// through R2's S3 API, signed with S3 credentials that R2 derives from the
// API token itself (the token's id, and the SHA-256 of its value). The token
// needs "Account > Workers R2 Storage > Edit".

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { cf, findZone, found } from './cloudflare.js'
import {
    readTorrent,
    stationFolder,
    stationVariable,
    verifyFolder
} from './torrent.js'

const log = (message) => console.log(`[mirror] ${message}`)
const HASH_PREFIX = /^[0-9a-f]{40}\//
const NOTHING = { plan: [], run: async () => {} }

// --- Cloudflare's REST API ----------------------------------------------------

// R2 is off until it is enabled once in the dashboard.
function explain(err) {
    if (err.codes?.includes(10042))
        return `${err.message}\n[mirror] hint: enable R2 once at https://dash.cloudflare.com (R2 Object Storage)`
    if (err.status === 403)
        return `${err.message}\n[mirror] hint: the API token needs "Account > Workers R2 Storage > Edit"`
    return err.message
}

const getBucket = (account, bucket, token) =>
    found(`/accounts/${account}/r2/buckets/${bucket}`, token)

// Any page may read the mirror; WebTorrent's requests carry a range, and
// headers that need a preflight (Cache-Control, and User-Agent in Firefox).
const CORS = {
    rules: [
        {
            allowed: {
                origins: ['*'],
                methods: ['GET', 'HEAD'],
                headers: ['range', 'cache-control', 'user-agent']
            },
            exposeHeaders: ['Content-Length', 'Content-Range', 'ETag'],
            maxAgeSeconds: 86400
        }
    ]
}

const customDomains = async (account, bucket, token) =>
    (
        await cf(
            'GET',
            `/accounts/${account}/r2/buckets/${bucket}/domains/custom`,
            token
        )
    ).result?.domains || []

// --- R2's S3 API ----------------------------------------------------------------

// S3 credentials from the API token (developers.cloudflare.com/r2/api/tokens).
async function s3Credentials(account, token) {
    const verify = async (route) => (await cf('GET', route, token)).result?.id
    const id = await verify(`/accounts/${account}/tokens/verify`).catch(() =>
        verify('/user/tokens/verify')
    )
    return {
        accessKey: id,
        secretKey: crypto.createHash('sha256').update(token).digest('hex')
    }
}

// RFC 3986 encoding, as Signature Version 4 wants it ('/' kept in paths).
const encode = (s, keepSlash = false) =>
    [...Buffer.from(s, 'utf8')]
        .map((b) => {
            const c = String.fromCharCode(b)
            return /[A-Za-z0-9\-._~]/.test(c) || (keepSlash && c === '/')
                ? c
                : `%${b.toString(16).toUpperCase().padStart(2, '0')}`
        })
        .join('')

// The query string, its keys sorted, as Signature Version 4 signs it.
const queryString = (query) =>
    Object.keys(query)
        .sort()
        .map((k) => `${encode(k)}=${encode(String(query[k]))}`)
        .join('&')

const hmac = (key, data) =>
    crypto.createHmac('sha256', key).update(data).digest()
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex')
const amzDate = (date) => date.toISOString().replace(/[-:]|\.\d{3}/g, '')

// AWS Signature Version 4: the Authorization header for one request.
// `headers` must hold host and every x-amz-* header sent; all are signed.
export function signV4({
    method,
    path: uri,
    query = {},
    headers,
    payloadHash,
    accessKey,
    secretKey,
    region,
    service = 's3',
    date
}) {
    const time = amzDate(date)
    const day = time.slice(0, 8)
    const lower = Object.fromEntries(
        Object.entries(headers).map(([k, v]) => [
            k.toLowerCase(),
            String(v).trim()
        ])
    )
    const names = Object.keys(lower).sort()
    const canonical = [
        method,
        encode(uri, true),
        queryString(query),
        ...names.map((h) => `${h}:${lower[h]}`),
        '',
        names.join(';'),
        payloadHash
    ].join('\n')
    const scope = `${day}/${region}/${service}/aws4_request`
    const toSign = ['AWS4-HMAC-SHA256', time, scope, sha256(canonical)].join(
        '\n'
    )
    const key = [day, region, service, 'aws4_request'].reduce(
        hmac,
        `AWS4${secretKey}`
    )
    const signature = hmac(key, toSign).toString('hex')
    return `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`
}

function s3(account, credentials) {
    const host = `${account}.r2.cloudflarestorage.com`
    return async (method, uri, { query = {}, body, headers = {} } = {}) => {
        const date = new Date()
        const payloadHash = 'UNSIGNED-PAYLOAD'
        const signed = {
            host,
            'x-amz-content-sha256': payloadHash,
            'x-amz-date': amzDate(date)
        }
        const authorization = signV4({
            method,
            path: uri,
            query,
            headers: signed,
            payloadHash,
            ...credentials,
            region: 'auto',
            date
        })
        const qs = queryString(query)
        const response = await fetch(
            `https://${host}${encode(uri, true)}${qs ? `?${qs}` : ''}`,
            {
                method,
                headers: {
                    ...headers,
                    ...signed,
                    Authorization: authorization
                },
                body,
                signal: AbortSignal.timeout(600000)
            }
        )
        if (!response.ok && !(method === 'DELETE' && response.status === 404)) {
            throw new Error(
                `S3 ${method} ${uri} -> HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`
            )
        }
        return response
    }
}

const unxml = (s) =>
    s.replace(
        /&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi,
        (_, e) =>
            ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[e] ??
            String.fromCodePoint(
                Number(e[1] === 'x' ? `0${e.slice(1)}` : e.slice(1))
            )
    )

// Every key in the bucket, with its size.
async function listObjects(request, bucket) {
    const objects = new Map()
    let token = null
    do {
        const query = {
            'list-type': '2',
            ...(token ? { 'continuation-token': token } : {})
        }
        const xml = await (await request('GET', `/${bucket}`, { query })).text()
        for (const [, body] of xml.matchAll(
            /<Contents>([\s\S]*?)<\/Contents>/g
        )) {
            objects.set(
                unxml(/<Key>([\s\S]*?)<\/Key>/.exec(body)[1]),
                Number(/<Size>(\d+)<\/Size>/.exec(body)?.[1])
            )
        }
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
            ? unxml(
                  /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(
                      xml
                  )?.[1] || ''
              )
            : null
    } while (token)
    return objects
}

// --- deploy and undeploy ----------------------------------------------------------

// The mirror's settings, or null when there is none.
export function mirrorSettings(env = process.env) {
    const bucket = (env.CLOUDFLARE_R2_BUCKET || '').trim()
    const domain = (env.CLOUDFLARE_R2_DOMAIN || '').trim()
    return bucket && domain ? { bucket, domain } : null
}

const TYPES = {
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    opus: 'audio/ogg',
    flac: 'audio/flac',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    wav: 'audio/wav',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    pdf: 'application/pdf',
    txt: 'text/plain; charset=utf-8'
}
const typeOf = (file) =>
    TYPES[file.split('.').pop().toLowerCase()] || 'application/octet-stream'

// Make the mirror hold exactly the stations the build bundled. Idempotent:
// a deploy with nothing new reads no files and uploads nothing.
export async function syncMirror(out, { bucket, domain }, env = process.env) {
    const token = env.CLOUDFLARE_API_TOKEN
    const account = env.CLOUDFLARE_ACCOUNT_ID
    try {
        if (!(await getBucket(account, bucket, token))) {
            await cf('POST', `/accounts/${account}/r2/buckets`, token, {
                name: bucket
            })
            log(`created R2 bucket '${bucket}'`)
        }
        await cf(
            'PUT',
            `/accounts/${account}/r2/buckets/${bucket}/cors`,
            token,
            CORS
        )
        const domains = await customDomains(account, bucket, token)
        if (!domains.some((d) => d.domain === domain)) {
            const zone = await findZone(domain, token)
            if (!zone) throw new Error(`no Cloudflare zone owns ${domain}`)
            await cf(
                'POST',
                `/accounts/${account}/r2/buckets/${bucket}/domains/custom`,
                token,
                { domain, zoneId: zone.id, enabled: true, minTLS: '1.2' }
            )
            log(
                `connected ${domain} to the bucket (Cloudflare adds its DNS record; the certificate can take a few minutes)`
            )
        }

        const request = s3(account, await s3Credentials(account, token))
        const stored = await listObjects(request, bucket)
        const keep = new Set()
        const dir = path.join(out, 'radio')
        const torrents = fs.existsSync(dir)
            ? fs.readdirSync(dir).filter((f) => f.endsWith('.torrent'))
            : []
        if (!torrents.length)
            log(
                'WARNING: the build bundled no .torrent (is STATION_59_1 set?); nothing to mirror'
            )
        for (const name of torrents) {
            const frequency = name.slice(0, -'.torrent'.length)
            const torrent = readTorrent(fs.readFileSync(path.join(dir, name)))
            const key = (file) => `${torrent.infoHash}/${file.path}`
            for (const file of torrent.files) keep.add(key(file))
            const missing = torrent.files.filter(
                (file) => stored.get(key(file)) !== file.length
            )
            if (!missing.length) {
                log(
                    `station ${frequency}: all ${torrent.files.length} files are up (${torrent.infoHash.slice(0, 8)})`
                )
                continue
            }
            const folder = stationFolder(frequency, env)
            if (!folder) {
                log(
                    `WARNING: station ${frequency}: ${stationVariable(frequency)} is not set; cannot upload its ${missing.length} missing files`
                )
                continue
            }
            log(
                `station ${frequency}: checking ${folder} against the .torrent...`
            )
            try {
                await verifyFolder(folder, torrent)
            } catch (err) {
                log(`WARNING: station ${frequency}: ${err.message}`)
                log(
                    'the folder is not what the build hashed (build again after changing it); not uploading'
                )
                continue
            }
            const bytes = missing.reduce((n, f) => n + f.length, 0)
            log(
                `station ${frequency}: uploading ${missing.length} files (${(bytes / 1048576).toFixed(1)} MiB)...`
            )
            let done = 0
            for (const file of missing) {
                await request('PUT', `/${bucket}/${key(file)}`, {
                    body: fs.readFileSync(path.join(folder, file.inner)),
                    headers: {
                        'Content-Type': typeOf(file.path),
                        'Cache-Control': 'public, max-age=31536000, immutable'
                    }
                })
                done += file.length
                if (missing.length > 1)
                    process.stdout.write(
                        `\r[mirror]   ${((done / bytes) * 100).toFixed(0)}%`
                    )
            }
            if (missing.length > 1) process.stdout.write('\n')
        }
        // Old versions of stations; keys the deploy did not make stay.
        const stale = [...stored.keys()].filter(
            (key) => HASH_PREFIX.test(key) && !keep.has(key)
        )
        for (const key of stale) await request('DELETE', `/${bucket}/${key}`)
        if (stale.length)
            log(`deleted ${stale.length} files of old station versions`)
        log(`ready: https://${domain}/<info hash>/<station>/<file>`)
        return true
    } catch (err) {
        log(`WARNING: the mirror is not up to date - ${explain(err)}`)
        return false
    }
}

// What undeploy would remove, for its plan; `run` removes it. Only keys the
// deploy made are deleted, and the bucket only if that empties it.
export async function mirrorTeardown({ bucket, domain }, env = process.env) {
    const token = env.CLOUDFLARE_API_TOKEN
    const account = env.CLOUDFLARE_ACCOUNT_ID
    let info
    try {
        info = await getBucket(account, bucket, token)
    } catch (err) {
        log(`could not read the R2 bucket (${explain(err)}); leaving it alone`)
        return NOTHING
    }
    if (!info) return NOTHING
    const domains = (await customDomains(account, bucket, token)).filter(
        (d) => d.domain === domain
    )
    const request = s3(account, await s3Credentials(account, token))
    const stored = await listObjects(request, bucket)
    const ours = [...stored.keys()].filter((key) => HASH_PREFIX.test(key))
    const emptied = ours.length === stored.size
    const plan = [
        ...(domains.length
            ? [`disconnect ${domain} from the R2 bucket '${bucket}'`]
            : []),
        ...(ours.length
            ? [`delete the mirror's ${ours.length} files from '${bucket}'`]
            : []),
        emptied
            ? `delete the R2 bucket '${bucket}'`
            : `keep the bucket '${bucket}': it holds ${stored.size - ours.length} other files`
    ]
    const run = async () => {
        if (domains.length) {
            await cf(
                'DELETE',
                `/accounts/${account}/r2/buckets/${bucket}/domains/custom/${domain}`,
                token
            )
            log(`disconnected ${domain}`)
        }
        for (const key of ours) await request('DELETE', `/${bucket}/${key}`)
        if (ours.length) log(`deleted ${ours.length} files`)
        if (emptied) {
            await cf(
                'DELETE',
                `/accounts/${account}/r2/buckets/${bucket}`,
                token
            )
            log(`deleted the bucket '${bucket}'`)
        }
    }
    return { plan, run }
}
