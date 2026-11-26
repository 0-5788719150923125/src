// Cloudflare's REST API, shared by the deploy (deploy.js), the radio's
// mirror (mirror.js) and the chat's relay (turn.js).

const API = 'https://api.cloudflare.com/client/v4'

// Call the API; throws with the API's own error text, and the HTTP status
// and error codes on the error.
export async function cf(method, route, token, body) {
    const response = await fetch(API + route, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30000)
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || payload.success === false) {
        const errors = payload.errors || []
        const err = new Error(
            `${method} ${route} -> HTTP ${response.status}: ${errors.map((e) => `${e.message} (${e.code})`).join('; ') || '?'}`
        )
        err.status = response.status
        err.codes = errors.map((e) => e.code)
        throw err
    }
    return payload
}

// A GET's result, or null when there is nothing at that route.
export const found = (route, token) =>
    cf('GET', route, token).then(
        (payload) => payload.result || null,
        (err) => {
            if (err.status === 404) return null
            throw err
        }
    )

// The zone whose name is the longest suffix of the domain.
export async function findZone(domain, token) {
    const zones = (await cf('GET', '/zones?per_page=50', token)).result || []
    return zones
        .filter((z) => domain === z.name || domain.endsWith(`.${z.name}`))
        .sort((a, b) => b.name.length - a.name.length)[0]
}
