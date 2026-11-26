// The swarm memory as a table for private retrieval (pir.js): what followed
// each context, in fixed-size records, so a peer can answer a question
// without learning it (next/private-memory.md).
//
// The suffix array (memory.js) finds the longest match by a search whose
// every step depends on the question; private retrieval needs one lookup at
// a position the asker computes alone. So the table is keyed by the 12
// characters before each word start (case folded), hashed to one of its
// records, and each entry carries tags (16-bit hashes) of the 24, 48 and 64
// characters before that word, and what followed it, to the end of its
// line. The asker hashes the 12 characters before the word it is typing,
// retrieves that record from each peer, and finds the longest match itself
// from the tags: the suffix array's answer, at four lengths instead of every
// length.
//
// An entry: four tags (2 bytes each, little-endian; 0 where the text was
// too short), a count (1), the continuation's length (1), and the
// continuation (UTF-8, up to SPAN bytes), in a slot of SLOT bytes; a record
// is SLOTS slots (a count of zero: empty). It keeps the entries whose
// continuation is repeated most under their key (summed over the longer
// contexts it came after), then the most recent; what does not fit is left
// out. Slots, not entries end to end, so an entry that comes or goes
// changes its own slot and no other: a chat line changes a few slots, and
// askers are sent only those (private.js).
//
// Imports nothing; meant to be shared by the browser and the stack's peers.

export const RECORD = 256 // bytes, as pir.js's SHAPE.record
export const KEY = 12 // characters the record is chosen by
export const TAGS = [24, 48, 64] // longer contexts an entry is tagged with
export const SPAN = 30 // bytes of continuation an entry carries, at most
export const NEAR = 0.75 // matches within a quarter of the longest count too (as memory.js)
const HEADER = 2 * (1 + TAGS.length) + 2
export const SLOT = HEADER + SPAN // bytes
export const SLOTS = Math.floor(RECORD / SLOT)
const KEY_SEED = 1
const TAG_SEED = 2

// As memory.js: matching ignores case, where lowercasing keeps every
// character in its place.
const folded = (text) => {
    const lower = text.toLowerCase()
    return lower.length === text.length ? lower : text
}

const isSpace = (ch) => ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r'

// FNV-1a over UTF-16 code units, then MurmurHash3's finalizer, so nearby
// contexts land far apart.
function hash(text, seed) {
    let h = (0x811c9dc5 ^ seed) >>> 0
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
    return (h ^ (h >>> 16)) >>> 0
}

const tag = (text) => 1 + (hash(text, TAG_SEED) % 65535)

// The tags of the contexts before position `at` of folded text: KEY's, then
// each of TAGS' (0 where the text is too short).
const tagsAt = (match, at) => [tag(match.slice(at - KEY, at)), ...TAGS.map((k) => (at >= k ? tag(match.slice(at - k, at)) : 0))]

// A continuation as at most SPAN bytes of UTF-8, cut after its last whole
// word (a ghost that ends mid-word gets finished wrong), or between
// characters when one word fills it.
const encoder = new TextEncoder()
function clip(text) {
    const bytes = encoder.encode(text)
    if (bytes.length <= SPAN) return bytes
    const space = bytes.subarray(0, SPAN + 1).lastIndexOf(0x20)
    if (space > 0) return bytes.slice(0, space)
    let end = SPAN
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--
    return bytes.slice(0, end)
}

// ------------------------------------------------------------ the peer

// The records of a table of `count` (a multiple of pir.js's columns),
// from `text`: lines of remembered text. With `weigh`, an occurrence
// counts for weigh(position) instead of 1 (the library weighs by how well a
// line was written); the count kept is rounded, at least 1.
export function build(text, count, { weigh = null } = {}) {
    const match = folded(text)
    const shelves = new Map() // record -> Map(entry id -> entry)
    for (let at = KEY; at < text.length; at++) {
        if (!isStart(match, at)) continue
        const found = entryAt(text, match, at, count)
        const entry = shelve(shelves, found)
        entry.score += weigh ? weigh(at) : 1
        entry.last = at
    }
    const all = new Uint8Array(count * RECORD)
    const records = Array.from({ length: count }, (_, i) => all.subarray(i * RECORD, (i + 1) * RECORD))
    for (const [record, shelf] of shelves) pack(records[record], [...shelf.values()])
    return records
}

const isStart = (match, at) => isSpace(match[at - 1]) && !isSpace(match[at])

// The entry for the word starting at `at` of `text` (`match`, its folded
// copy): the record its key picks, its tags, what followed to the end of
// the line, and an id that is the same wherever the same entry is made.
function entryAt(text, match, at, count) {
    const end = text.indexOf('\n', at)
    const span = clip(text.slice(at, end < 0 ? text.length : end))
    const tags = tagsAt(match, at)
    return { record: hash(match.slice(at - KEY, at), KEY_SEED) % count, tags, span, id: `${tags.join(',')} ${span.join(',')}` }
}

// The entry kept for `found` on its record's shelf, made if new.
function shelve(shelves, found) {
    if (!shelves.has(found.record)) shelves.set(found.record, new Map())
    const shelf = shelves.get(found.record)
    if (!shelf.has(found.id)) shelf.set(found.id, { ...found, score: 0, last: 0 })
    return shelf.get(found.id)
}

// The same table, kept a line at a time, for a browser whose library
// changes with every chat line (answering.js): rooms of lines, each room's
// text read as build reads one ("\n", the lines, each ended by "\n"), so
// a word's contexts reach back into the room's earlier lines, never into
// another room. A line added makes an entry at each of its word starts; a
// line dropped (the oldest of its room) takes back what it made. `sync`
// takes the library as it now stands, works out what was added and
// dropped, and returns the records that changed; `record` packs one: the
// entries build would keep (recency being the order lines came in), each
// left in the slot it had.
export function createShelves(count) {
    const shelves = new Map() // record -> Map(entry id -> entry)
    const rooms = new Map() // name -> [{ text, made: [[entry, weight]] }]
    let clock = 0
    let changed = new Set()

    // A room's text before its next line, as far back as a context reaches.
    function tailOf(lines) {
        const kept = []
        let length = 0
        let i = lines.length - 1
        for (; i >= 0 && length < TAGS.at(-1); i--) {
            kept.unshift(lines[i].text)
            length += lines[i].text.length + 1
        }
        const tail = `${i < 0 ? '\n' : ''}${kept.join('\n')}${lines.length ? '\n' : ''}`
        return tail.length > TAGS.at(-1) ? tail.slice(-TAGS.at(-1)) : tail
    }

    function add(room, text, weight) {
        if (!rooms.has(room)) rooms.set(room, [])
        const lines = rooms.get(room)
        const tail = tailOf(lines)
        const whole = `${tail}${text}\n`
        const match = folded(whole)
        const made = []
        for (let at = Math.max(KEY, tail.length); at < tail.length + text.length; at++) {
            if (!isStart(match, at)) continue
            const entry = shelve(shelves, entryAt(whole, match, at, count))
            entry.score += weight
            entry.last = ++clock
            made.push([entry, weight])
            changed.add(entry.record)
        }
        lines.push({ text, made })
    }

    function drop(room) {
        const lines = rooms.get(room)
        const line = lines?.shift()
        if (!line) return
        for (const [entry, weight] of line.made) {
            entry.score -= weight
            const shelf = shelves.get(entry.record)
            // An entry gone and made again since is another object.
            if (entry.score <= 1e-9 && shelf?.get(entry.id) === entry) shelf.delete(entry.id)
            changed.add(entry.record)
        }
        if (!lines.length) rooms.delete(room)
    }

    // `library`: room name -> its lines, oldest first, as library.js keeps
    // them (lines leave a room's front, and come at its end). `weigh(line)`:
    // what a new line counts for (1).
    function sync(library, weigh = () => 1) {
        for (const room of [...rooms.keys()]) if (!Object.hasOwn(library, room)) while (rooms.has(room)) drop(room)
        for (const [room, texts] of Object.entries(library)) {
            const have = (rooms.get(room) ?? []).map((line) => line.text)
            // The lines dropped from the front: the fewest after which what
            // was kept is how the room now starts (all, if nothing fits).
            let dropped = 0
            while (dropped < have.length && !have.slice(dropped).every((text, i) => texts[i] === text)) dropped++
            for (let i = 0; i < dropped; i++) drop(room)
            for (const text of texts.slice(have.length - dropped)) add(room, text, weigh(text))
        }
        const out = changed
        changed = new Set()
        return out
    }

    // A record as it now stands: its kept entries stay in their slots.
    const layouts = new Map() // record -> entry ids by slot
    function record(index) {
        const out = new Uint8Array(RECORD)
        const shelf = shelves.get(index)
        const kept = shelf ? best([...shelf.values()]) : []
        const slots = place(kept, layouts.get(index))
        if (kept.length) layouts.set(index, slots)
        else layouts.delete(index)
        write(out, slots, new Map(kept.map((entry) => [entry.id, entry])))
        return out
    }

    return { sync, record, records: () => Array.from({ length: count }, (_, i) => record(i)) }
}

// The SLOTS entries a record keeps, best first.
function best(entries) {
    const repeated = new Map() // key tag and continuation -> score over all its entries
    const of = ({ tags, span }) => `${tags[0]} ${span.join(',')}`
    for (const entry of entries) repeated.set(of(entry), (repeated.get(of(entry)) || 0) + entry.score)
    return [...entries].sort((a, b) => repeated.get(of(b)) - repeated.get(of(a)) || b.score - a.score || b.last - a.last).slice(0, SLOTS)
}

// Where each kept entry goes: the slot it had, if it had one, else a free
// slot, best first. `had`: entry ids by slot (none: a new record).
function place(kept, had = []) {
    const ids = new Set(kept.map((entry) => entry.id))
    const slots = Array.from({ length: SLOTS }, (_, i) => (ids.has(had[i]) ? had[i] : null))
    const placed = new Set(slots)
    for (const entry of kept) if (!placed.has(entry.id)) slots[slots.indexOf(null)] = entry.id
    return slots
}

function write(out, slots, byId) {
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
    slots.forEach((id, i) => {
        const entry = id && byId.get(id)
        if (!entry) return
        const at = i * SLOT
        entry.tags.forEach((t, k) => view.setUint16(at + 2 * k, t, true))
        out[at + 2 * entry.tags.length] = Math.min(255, Math.max(1, Math.round(entry.score)))
        out[at + 2 * entry.tags.length + 1] = entry.span.length
        out.set(entry.span, at + HEADER)
    })
}

function pack(out, entries) {
    const kept = best(entries)
    write(out, place(kept), new Map(kept.map((entry) => [entry.id, entry])))
}

// The entries of a record: { tags, count, text }.
const decoder = new TextDecoder()
export function entries(record) {
    const view = new DataView(record.buffer, record.byteOffset, record.byteLength)
    const out = []
    for (let at = 0; at + SLOT <= record.length; at += SLOT) {
        const count = record[at + 2 * (1 + TAGS.length)]
        const length = record[at + 2 * (1 + TAGS.length) + 1]
        if (!count || length > SPAN) continue
        const tags = Array.from({ length: 1 + TAGS.length }, (_, i) => view.getUint16(at + 2 * i, true))
        out.push({ tags, count, text: decoder.decode(record.subarray(at + HEADER, at + HEADER + length)) })
    }
    return out
}

// ------------------------------------------------------------ the asker

// What a question about `context` (the text before the caret) asks: the
// hash that picks a record (recordOf), the tags to check entries against,
// and the word being typed, which continuations must begin with. Null when
// there are fewer than KEY characters before that word.
export function question(context) {
    const match = folded(context)
    let start = match.length
    while (start > 0 && !isSpace(match[start - 1])) start--
    if (start < KEY) return null
    return { hash: hash(match.slice(start - KEY, start), KEY_SEED), tags: tagsAt(match, start), partial: context.slice(start) }
}

// The record a question picks at a peer whose table holds `count`. Its
// column (count being a multiple of the columns) is the same at every peer.
export const recordOf = (asked, count) => asked.hash % count

// What a retrieved record says about a question, as memory.js's lookup
// does: L, the characters matched (the longest agreeing tag, and the word
// being typed), and spans, [continuation, count] pairs after the typed
// word, most frequent first, from every entry within NEAR of the longest.
export function match(record, asked) {
    const typed = folded(asked.partial)
    const found = []
    for (const entry of entries(record)) {
        if (entry.tags[0] !== asked.tags[0]) continue
        let length = KEY
        for (let i = 0; i < TAGS.length && asked.tags[i + 1] && entry.tags[i + 1] === asked.tags[i + 1]; i++) length = TAGS[i]
        if (!folded(entry.text).startsWith(typed)) continue
        found.push({ length, text: entry.text.slice(typed.length), count: entry.count })
    }
    if (!found.length) return { L: 0, spans: [] }
    const longest = Math.max(...found.map((f) => f.length))
    const spans = new Map()
    for (const { length, text, count } of found) if (text && length >= longest * NEAR) spans.set(text, (spans.get(text) || 0) + count)
    return { L: Math.min(64, longest + typed.length), spans: [...spans].sort((a, b) => b[1] - a[1]) }
}
