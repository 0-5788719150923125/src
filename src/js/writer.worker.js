// The model behind PEN@ROOT: an ONNX build of SmolLM2-135M-Instruct, run by
// transformers.js on the CPU, with WebAssembly. Never WebGPU, on purpose:
// most visitors don't have it, the site has no business taking theirs, and
// where it does exist it shares memory with every other app on the machine
// (Firefox on 2026-11-20 ran out and answered with noise). The page is
// cross-origin isolated (_headers), so ONNX Runtime runs on threads: half
// the cores, at most 4. Weights download once and stay in the browser's
// cache.
//
// PEN writes ahead of the visitor: given the room's conversation and the
// line being typed, it streams its guess at the rest of the line, a token
// at a time (ghost.js shows it). Reading text is what takes time, so the
// model's keys and values for what it has read are kept (the K/V cache):
// each guess reads only what changed since the last one, and new chat is
// read while the visitor is idle.

import { AutoModelForCausalLM, AutoTokenizer, Tensor, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js'
import { weight } from './memory.js'
import { boostFrom, common, consume, pick, split, start } from './predict.js'
import { isPlain } from './room.js'

const MODEL = 'HuggingFaceTB/SmolLM2-135M-Instruct'
const NAME = 'SmolLM2-135M'
// Tokens of conversation the model reads: once they pass MOST, the start
// jumps ahead until LEAST remain. Between jumps the start stays put, and
// with it everything cached.
const MOST = 384
const LEAST = 192
// Tokens read per run of the model. A keystroke waits for at most one run.
const CHUNK = 32
// How long a guess runs: past BUDGET characters it stops at the next word's
// start, so it never ends mid-word; LENGTH tokens is the hard stop. And how
// much less likely a token gets for each time it already appears in the
// line.
const BUDGET = 120
const LENGTH = 64
const PENALTY = 1.3
// Tokens between questions to the room's memory while a guess is written.
const ASK_EVERY = 4
const ASK_WAIT = 200 // ms to wait for the room's answer before writing on

let model = null
let tokenizer = null
let vocab = [] // what each token reads as
let allowed = null // 1 for tokens the chat accepts (room.js isPlain)
let stops = null // 1 for tokens that end a line: line breaks, special tokens
let byString = new Map() // a token's text -> its id, for the swarm's memory
let words = null // 1 for allowed tokens with something besides spaces in them
let none = null // no tokens at all: no stops, while a guess has shown nothing yet
let preamble = '' // read before the conversation (text/<language>/pen.md)
let lines = [] // the room's conversation
let from = 0 // the first line the model reads
let cache = { ids: [], past: null } // what the model has read, and its keys and values
let turn = 0 // bumped by every guess and stop: work from an older turn stops
let asking = null // a question about memory this worker is waiting on: { id, seq, written, answer }
let asked = 0 // numbers the questions, so a late answer is not taken for a newer one's
let work = Promise.resolve() // one thing at a time, since all of it shares the cache

const queue = (task) => (work = work.then(task).catch((err) => console.error(err)))
// Let waiting messages in. A run of the model never yields to the event
// loop by itself, so without this a stop sent mid-guess would only arrive
// after the guess was done, and a visitor typing at a normal pace would
// queue up a full guess for every key.
const yieldToMessages = () => new Promise((resolve) => setTimeout(resolve))
const encode = (text) => Array.from(tokenizer.encode(text, { add_special_tokens: false }))
const conversation = (first) => `${preamble}\n${lines.slice(first).map((line) => `${line}\n`).join('')}`

// What the ticker shows: how far the download has come, then, once the
// model is ready, `cpu` (the share of the last WINDOW ms this worker spent
// running the model) and `ram` (what it holds: the model's files, and the
// keys and values it has cached). Browsers do not say how much memory a
// worker really uses, so `ram` counts what the writer itself keeps, which
// is most of it.
const WINDOW = 5000
const DEVICE = 'wasm'
let weights = 0 // bytes of the model's files
let busy = [] // [start, ms] of each run of the model
let reported = null

function report(fields) {
    const status = JSON.stringify(fields)
    if (status === reported) return
    reported = status
    postMessage({ status: { model: NAME, device: DEVICE, ...fields } })
}

function usage() {
    const now = performance.now()
    busy = busy.filter(([start, ms]) => start + ms > now - WINDOW)
    const ms = busy.reduce((sum, [start, took]) => sum + Math.min(took, start + took - (now - WINDOW)), 0)
    let cached = 0
    for (const tensor of Object.values(cache.past ?? {})) cached += tensor.data.byteLength
    report({ cpu: `${Math.round((100 * ms) / WINDOW)}%`, ram: `${Math.round((weights + cached) / 1e6)} MB` })
}

async function load(text) {
    const device = DEVICE
    // Downloads report every chunk; the page hears only when the
    // percentage moves.
    const status = (done) => report({ download: done })
    const files = {}
    const progress_callback = (p) => {
        // The weights are here; what remains is starting the runtime.
        if (p.status === 'done' && p.file.endsWith('.onnx')) postMessage({ starting: true })
        if (p.status !== 'progress' || !p.total) return
        files[p.file] = p
        // The small files finish first; until the weights have said how big
        // they are, a percentage would only count those.
        if (!Object.keys(files).some((file) => file.endsWith('.onnx'))) return
        const loaded = Object.values(files).reduce((sum, f) => sum + f.loaded, 0)
        const total = Object.values(files).reduce((sum, f) => sum + f.total, 0)
        // Small files finish first; only a ready model is 100%.
        status(`${Math.min(99, Math.floor((100 * loaded) / total))}%`)
    }
    status('0%')
    preamble = text.preamble
    // One thread when asked: writer.js asks after a start that hung (ONNX
    // Runtime's threads sometimes never come up in Firefox).
    if (text.threads) env.backends.onnx.wasm.numThreads = text.threads
    tokenizer = await AutoTokenizer.from_pretrained(MODEL, { progress_callback })
    model = await AutoModelForCausalLM.from_pretrained(MODEL, {
        device,
        // 8-bit weights: the fastest on the CPU (measured 2026-11-21: 4-bit
        // reads a prompt 1.1-1.3x slower and writes 2.5-3x slower; full
        // precision reads 1.6x slower), and a smaller download than 4-bit
        // (137 MB against 182 MB). Its activations are quantized per run,
        // so text read in chunks scores a hair differently than text read
        // at once; full precision matches token for token.
        dtype: 'q8',
        progress_callback
    })
    vocab = Array.from({ length: model.config.vocab_size }, (_, id) => tokenizer.decode([id]))
    const special = new Set(tokenizer.all_special_ids)
    allowed = Uint8Array.from(vocab, (piece, id) => !special.has(id) && piece !== '' && isPlain(piece))
    stops = Uint8Array.from(vocab, (piece, id) => special.has(id) || piece.includes('\n'))
    vocab.forEach((piece, id) => allowed[id] && !byString.has(piece) && byString.set(piece, id))
    words = Uint8Array.from(vocab, (piece, id) => allowed[id] && /\S/.test(piece))
    none = new Uint8Array(vocab.length)
    weights = Object.values(files).reduce((sum, f) => sum + f.total, 0)
    usage()
    setInterval(usage, 2000)
    postMessage({ ready: true })
    warm()
}

// ------------------------------------------------------------ the cache

const ids = (list) => new Tensor('int64', BigInt64Array.from(list, (id) => BigInt(id)), [1, list.length])

// Run the model over `next`, after what the cache holds. Returns the scores
// for the token that follows.
async function step(next) {
    const length = cache.ids.length + next.length
    const started = performance.now()
    const out = await model({ input_ids: ids(next), attention_mask: ids(new Array(length).fill(1)), past_key_values: cache.past })
    busy.push([started, performance.now() - started])
    const past = {}
    for (const name in out) if (name.startsWith('present')) past[name.replace('present', 'past_key_values')] = out[name]
    cache = { ids: [...cache.ids, ...next], past }
    const size = out.logits.dims.at(-1)
    return out.logits.data.subarray(out.logits.data.length - size)
}

// Keep only the first `length` tokens of the cache. Each tensor is
// [batch, heads, tokens, size]; the tokens are cut per head.
function trim(length) {
    if (length >= cache.ids.length) return
    if (length === 0) return (cache = { ids: [], past: null })
    const past = {}
    for (const [name, tensor] of Object.entries(cache.past)) {
        const [batch, heads, seen, size] = tensor.dims
        const data = new tensor.data.constructor(batch * heads * length * size)
        for (let head = 0; head < batch * heads; head++) {
            data.set(tensor.data.subarray(head * seen * size, (head * seen + length) * size), head * length * size)
        }
        past[name] = new Tensor(tensor.type, data, [batch, heads, length, size])
    }
    cache = { ids: cache.ids.slice(0, length), past }
}

// Bring the cache to `tokens`: keep what it shares with them, then read the
// rest a chunk at a time. At least the last token is read again, for its
// scores. Returns them, or null if stopped first.
async function read(tokens, stopped) {
    trim(Math.max(0, Math.min(common(cache.ids, tokens), tokens.length - 1)))
    let scores = null
    while (cache.ids.length < tokens.length) {
        await yieldToMessages()
        if (stopped()) return null
        scores = await step(tokens.slice(cache.ids.length, cache.ids.length + CHUNK))
    }
    return scores
}

// The conversation as tokens, from where the model starts reading.
function context() {
    from = start(from, lines.length, (first) => encode(conversation(first)).length, { most: MOST, least: LEAST })
    return encode(conversation(from))
}

// Read new chat while nothing else is going on; a guess or a stop ends it,
// and the guess picks up where it left off.
function warm() {
    const at = turn
    queue(async () => {
        const tokens = context()
        if (common(cache.ids, tokens) < tokens.length) await read(tokens, () => turn !== at)
    })
}

// ------------------------------------------------------------ guesses

// `memory` is what the room's peers remembered for this line (memory.js,
// merged by recall.js), or null: spans that went on from the end of the
// line, and the length of the match that found them.
async function guess(id, line, stopped, memory) {
    const { stable, tail } = split(line)
    const typed = encode(stable)
    let scores = await read([...context(), ...typed], stopped)
    if (!scores) return
    const recent = new Set(typed)
    let pending = tail
    // The model writes from the end of `stable`, so the unfinished word comes
    // first in what it writes; the spans go on from after it. When no span
    // agrees with what has been written any more, the room is asked again
    // about the line as it now stands (every ASK_EVERY tokens at most, less
    // often while it has nothing to say), and its answer goes on from there.
    // The memory counts for its match length, and for where it came from:
    // text from other rooms than this one counts for less (memory.js).
    let lambda = memory ? weight(memory.L) * (memory.w ?? 1) : 0
    let spans = lambda ? memory.spans.map(([text, share]) => [tail + text, share]) : []
    let written = ''
    let lastAsked = 0
    let every = ASK_EVERY // doubles each time the room has nothing to say
    asking = null
    // Take the room's answer to the last question: its spans go on from what
    // had been written when it was asked.
    const adopt = () => {
        const { answer } = asking
        if (!answer) every *= 2
        lambda = answer ? weight(answer.L) * (answer.w ?? 1) : 0
        spans = lambda ? answer.spans.map(([text, share]) => [asking.written + text, share]) : []
        asking = null
    }
    let why = 'end' // why the guess stopped: the model ended the line, or the budget ran out
    let shown = 0
    for (let n = 0; n < LENGTH; n++) {
        await yieldToMessages()
        if (stopped()) return
        if (asking?.id === id && asking.answer !== undefined) adopt()
        let boost = spans.length ? boostFrom(spans, written, byString) : null
        if (!boost?.size && !asking && n - lastAsked >= every) {
            asking = { id, seq: ++asked, written }
            lastAsked = n
            postMessage({ more: { id, seq: asking.seq, line: stable + written } })
            // Wait a moment for the answer: a token written meanwhile would
            // already have gone its own way. No answer in time counts as
            // none, and the guess goes on with the model alone; it may ask
            // again later.
            const until = performance.now() + ASK_WAIT
            while (asking?.answer === undefined && performance.now() < until && !stopped()) await yieldToMessages()
            if (stopped()) return
            if (asking.answer === undefined) asking.answer = null
            adopt()
            boost = spans.length ? boostFrom(spans, written, byString) : null
        }
        // A guess may not end, or write only spaces, before it has shown
        // something: after a finished message the model's likeliest next
        // token ends the line, and a guess of nothing shows nothing and is
        // never retried (the visitor saw the ghost freeze).
        const blank = shown === 0 || !/\S/.test(written)
        const token = pick(scores, { vocab, allowed: blank ? words : allowed, stops: blank ? none : stops, pending, recent, penalty: PENALTY, boost, lambda })
        if (token < 0 || stops[token]) break
        if (shown >= BUDGET && /^\s/.test(vocab[token])) {
            why = 'length'
            break
        }
        written += vocab[token]
        const next = consume(pending, vocab[token])
        pending = next.pending
        recent.add(token)
        if (next.shown) postMessage({ ghost: { id, text: next.shown } })
        shown += next.shown.length
        scores = await step([token])
        if (n === LENGTH - 1) why = 'length'
    }
    if (!stopped()) postMessage({ ghost: { id, done: true, why } })
}

onmessage = ({ data }) => {
    if (data.command === 'load') {
        lines = data.lines ?? []
        load(data.text).catch((err) => {
            console.error(err)
            postMessage({ status: { model: NAME, error: 'failed' } })
        })
    } else if (data.command === 'remember') {
        // Lines before the start are never read again.
        lines = [...lines.slice(from), data.line]
        from = 0
        if (model) warm()
    } else if (data.command === 'forget') {
        lines = []
        from = 0
        if (model) warm()
    } else if (data.command === 'guess') {
        const mine = ++turn
        if (model) queue(() => guess(data.id, data.line, () => turn !== mine, data.memory))
    } else if (data.command === 'memory') {
        if (asking?.id === data.id && asking.seq === data.seq) asking.answer = data.memory
    } else if (data.command === 'stop') {
        turn++
    }
}
