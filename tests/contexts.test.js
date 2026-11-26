import test from 'node:test'
import assert from 'node:assert/strict'
import { KEY, RECORD, SLOT, SPAN, build, createShelves, entries, match, question, recordOf } from '../src/js/contexts.js'
import { SHAPE, answer, createTable, hint, locate, mask, readRecord, select } from '../src/js/pir.js'

const COUNT = 64 // records, in tests

// What `text` remembers about `context`, read straight from the records.
function recall(text, context, count = COUNT, options) {
    const records = build(text, count, options)
    const asked = question(context)
    return asked ? match(records[recordOf(asked, count)], asked) : null
}

test('the continuation of a remembered line comes back, after the typed word', () => {
    const text = '\nthe quick brown fox jumps over the lazy dog\nsomething else entirely here\n'
    assert.deepEqual(recall(text, 'I saw the quick brown ').spans, [['fox jumps over the lazy dog', 1]])
    const typing = recall(text, 'I saw the quick brown fo')
    assert.deepEqual(typing.spans, [['x jumps over the lazy dog', 1]])
    assert.equal(typing.L, KEY + 2)
    assert.deepEqual(recall(text, 'I saw the quick brown cat').spans, [])
})

test('case is ignored when matching and kept in what comes back', () => {
    const text = '\nThe Archives Say The Signal Started Before\n'
    assert.deepEqual(recall(text, 'the archives say the sig').spans, [['nal Started Before', 1]])
})

test('the longest agreeing context wins', () => {
    // The same 12 characters before "went", after different 24.
    const text = '\nin the old north house the cat went out\nby the river south house the cat went home\n'
    const north = recall(text, 'in the old north house the cat ')
    assert.equal(north.L, 24)
    assert.deepEqual(north.spans, [['went out', 1]])
    const south = recall(text, 'by the river south house the cat ')
    assert.deepEqual(south.spans, [['went home', 1]])
    // Agreeing only on the last 12, both count.
    const either = recall(text, 'somewhere else, house the cat ')
    assert.equal(either.L, 12)
    assert.deepEqual(either.spans.map(([span]) => span).sort(), ['went home', 'went out'])
})

test('repeats are counted, and kept first when a record fills', () => {
    const lines = ['\nwe will meet at the old mill', 'we will meet at the old mill', 'we will meet at the old mill']
    // Many other continuations of the same context, each once.
    for (let i = 0; i < 40; i++) lines.push(`we will meet at the station number ${i} today`)
    const text = `${lines.join('\n')}\n`
    const found = recall(text, 'so we will meet at ')
    assert.deepEqual(found.spans[0], ['the old mill', 3])
    const records = build(text, COUNT)
    const asked = question('so we will meet at ')
    const kept = entries(records[recordOf(asked, COUNT)])
    assert.ok(kept.length < 41, `${kept.length} entries fit`)
    assert.ok(kept.length <= Math.floor(RECORD / SLOT))
})

test('weights order what is kept', () => {
    const text = '\nplease send it to the office now\nplease send it to the lake now\n'
    const lake = text.indexOf('lake')
    const found = recall(text, 'well please send it to ', COUNT, { weigh: (at) => (at > lake - 10 ? 3 : 1) })
    assert.deepEqual(found.spans[0], ['the lake now', 3])
})

test('continuations end after a whole word, within SPAN bytes', () => {
    const text = '\nthe archives say the signal started before the network did\n'
    assert.deepEqual(recall(text, 'and the archives say the ').spans, [['signal started before the', 1]])
})

test('continuations are cut between characters, at SPAN bytes', () => {
    const text = `\nthe word for snow is ${'雪'.repeat(20)}\n`
    const [[span]] = recall(text, 'and the word for snow is ').spans
    assert.ok(new TextEncoder().encode(span).length <= SPAN)
    assert.equal(span, '雪'.repeat(10)) // 3 bytes each
})

test('too little context asks nothing', () => {
    assert.equal(question('hello there'), null) // 6 characters before "there"
    assert.ok(question('just enough context '))
})

test('through private retrieval, a peer answers without the question', async () => {
    const S = { ...SHAPE, cols: 64 }
    const text = '\nthe quick brown fox jumps over the lazy dog\nthe archives say the signal started before the network did\n'
    const records = build(text, S.cols * 2)
    const table = createTable(records, S)
    const hinted = await hint(table)
    const asked = question('they say the archives say the sig')
    const { column, group } = locate(recordOf(asked, S.cols * 2), S)
    const m = await mask(S)
    const record = readRecord(answer(table, select(m, column)), hinted, m, group)
    assert.deepEqual(match(record, asked).spans, [['nal started before the', 1]])
})

// Lines of chat, made up from a few words, so contexts repeat.
function chat(count, seed = 5) {
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const words = ['we', 'will', 'meet', 'at', 'the', 'old', 'mill', 'station', 'tonight', 'again', 'and', 'then', 'go', 'home', 'quickly']
    return Array.from({ length: count }, () => Array.from({ length: 4 + Math.floor(rand() * 10) }, () => words[Math.floor(rand() * words.length)]).join(' '))
}
const bytesOf = (records) => records.map((r) => Buffer.from(r).toString('hex'))
// What each record holds, in no order (slots depend on the order entries came in).
const heldBy = (records) => records.map((r) => entries(r).map((e) => JSON.stringify(e)).sort())

test('a table kept a line at a time is the table built at once', () => {
    const lines = chat(300)
    const whole = build(`\n${lines.join('\n')}\n`, COUNT)
    const once = createShelves(COUNT)
    once.sync({ room: lines })
    assert.deepEqual(bytesOf(once.records()), bytesOf(whole)) // all at once: the same slots too
    // Line by line, in several steps: the same entries, in the slots they took.
    const steps = createShelves(COUNT)
    for (const end of [1, 2, 50, 51, 200, 300]) steps.sync({ room: lines.slice(0, end) })
    assert.deepEqual(heldBy(steps.records()), heldBy(whole))
})

test('an entry that comes changes its own slot, and the others stay', () => {
    const shelves = createShelves(1) // one record: every entry competes for its slots
    shelves.sync({ room: ['we will meet at the old mill tonight and then go home'] })
    const before = shelves.record(0)
    // One new entry (the word "quickly"), the newest, takes the weakest slot.
    shelves.sync({ room: ['we will meet at the old mill tonight and then go home', 'quickly'] })
    const after = shelves.record(0)
    const changed = new Set()
    for (let i = 0; i < RECORD; i++) if (before[i] !== after[i]) changed.add(Math.floor(i / SLOT))
    assert.equal(changed.size, 1)
})

test('a new line changes only the records its words land in', () => {
    const lines = chat(200)
    const shelves = createShelves(COUNT * 4)
    shelves.sync({ room: lines })
    const line = 'and then we will meet at the old mill again'
    const touched = shelves.sync({ room: [...lines, line] })
    assert.ok(touched.size > 0 && touched.size <= line.split(' ').length, `${touched.size} records`)
    assert.equal(shelves.sync({ room: [...lines, line] }).size, 0) // nothing new
})

test('a line that leaves takes back what it made', () => {
    const lines = ['the first line we kept says the secret is a blue door', 'and the next one only talks about the weather today', 'then a third line goes on about something else entirely']
    const shelves = createShelves(COUNT)
    shelves.sync({ room: lines })
    const asked = question('they said the secret is a ')
    const found = () => match(shelves.record(recordOf(asked, COUNT)), asked).spans
    assert.deepEqual(found(), [['blue door', 1]])
    shelves.sync({ room: lines.slice(1) }) // the oldest left the room
    assert.deepEqual(found(), [])
    // What the kept lines made is still there.
    const later = question('it only talks about the ')
    assert.deepEqual(match(shelves.record(recordOf(later, COUNT)), later).spans, [['weather today', 1]])
    // A room gone takes all of its lines with it.
    shelves.sync({})
    assert.ok(shelves.records().every((r) => r.every((b) => b === 0)))
})

test('rooms are read on their own: contexts never reach into another room', () => {
    const shelves = createShelves(COUNT)
    shelves.sync({ a: ['the end of room a talks about apples and pears'], b: ['room b begins here with bananas'] })
    const both = createShelves(COUNT)
    both.sync({ a: ['the end of room a talks about apples and pears'] })
    both.sync({ a: ['the end of room a talks about apples and pears'], b: ['room b begins here with bananas'] })
    assert.deepEqual(bytesOf(both.records()), bytesOf(shelves.records()))
    const alone = createShelves(COUNT)
    alone.sync({ b: ['room b begins here with bananas'] })
    alone.sync({ b: ['room b begins here with bananas'], a: ['the end of room a talks about apples and pears'] })
    assert.deepEqual(bytesOf(alone.records()), bytesOf(shelves.records()))
})
