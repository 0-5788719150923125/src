// Helpers for the tests of private questions (private.test.js,
// privacy.test.js): fake wires joining an asker to a peer that answers.

import { privateExtension } from '../src/js/private.js'

// Two fake wires joined to each other, as BitTorrent wires carrying the
// extension; `drop(bytes)` loses messages, `sent` keeps what each side sent.
export function connect(asker, answerer, { drop = () => false } = {}) {
    const make = () => ({
        peerExtendedMapping: { src_pir: 1 },
        destroyed: false,
        sent: [],
        closers: [],
        once(event, fn) {
            if (event === 'close') this.closers.push(fn)
        }
    })
    const a = make()
    const b = make()
    const pass = (from, to) => (name, buf) => {
        const bytes = Uint8Array.from(buf)
        // What a data channel to Node takes, less the BitTorrent framing.
        if (bytes.length > 65536 - 6)
            throw new Error(`message of ${bytes.length} bytes`)
        from.sent.push(bytes)
        if (!drop(bytes, from === a))
            setImmediate(() => to.ext.onMessage(bytes))
    }
    a.extended = pass(a, b)
    b.extended = pass(b, a)
    a.ext = new (privateExtension(asker.handle))(a)
    b.ext = new (privateExtension(answerer.handle))(b)
    a.ext.onExtendedHandshake({ m: { src_pir: 1 } })
    b.ext.onExtendedHandshake({ m: { src_pir: 1 } })
    return { a, b }
}

export const until = async (ok, ms = 5000) => {
    for (const end = Date.now() + ms; !ok();) {
        if (Date.now() > end) throw new Error('timed out')
        await new Promise((r) => setTimeout(r, 10))
    }
}

// The asker's final memory about `context`.
export const ask = (asker, context) =>
    new Promise((resolve) =>
        asker.ask(context, (memory, done) => done && resolve(memory))
    )
export const spansOf = (memory) => (memory?.spans ?? []).map(([text]) => text)

export async function ready(asker, peers = 1) {
    await until(() => asker.status().ready >= peers)
    await asker.fill()
}
