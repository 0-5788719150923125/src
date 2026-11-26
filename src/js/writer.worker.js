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

import {
    AutoModelForCausalLM,
    AutoTokenizer,
    Tensor,
    env
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js'
import { weight } from './memory.js'
import { boostFrom, common, consume, pick, split, start } from './predict.js'
import { isPlain } from './room.js'

// Where ONNX Runtime's own files are, relative to this module: null on the
// site, where transformers.js fetches them from jsdelivr. The browser
// extension ships them (stores refuse code from elsewhere), and its build
// (scripts/extension.js) fills this in, as it points the import above at
// its own copy. They are the CPU-only build, which is all this runs on.
const RUNTIME = null
if (RUNTIME) {
    env.backends.onnx.wasm.wasmPaths = {
        mjs: new URL(`${RUNTIME}ort-wasm-simd-threaded.mjs`, import.meta.url)
            .href,
        wasm: new URL(`${RUNTIME}ort-wasm-simd-threaded.wasm`, import.meta.url)
            .href
    }
    // Its copy in Cache Storage would be loaded from a blob: URL, which an
    // extension's pages may not run.
    env.useWasmCache = false
}

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
// How the next token is chosen: drawn, not always the likeliest, so a line
// that starts like another need not go on like it (the user's call,
// 2026-11-23: every "The" got the same guess). TEMPERATURE flattens the
// model's odds a little less than evenly (1 would draw by them as they
// are, 0 would be greedy), and the draw is only ever among the likeliest
// tokens holding TOP_P of the probability. A guess is kept while the
// visitor types along with it; only a new guess draws again.
const TEMPERATURE = 0.7
const TOP_P = 0.9
// Tokens between questions to the room's memory while a guess is written.
const ASK_EVERY = 4
// A guess never waits for the swarm, but the swarm can correct it: an
// answer to its first question that comes after it has started, counts for
// at least this much (memory.js weight: a match of 24 characters), and
// disagrees with what it has written rewrites it once, from the start.
const REWRITE = 0.4

let model = null
let tokenizer = null
let vocab = [] // what each token reads as
let allowed = null // 1 for tokens the chat accepts (room.js isPlain)
let stops = null // 1 for tokens that end a line: line breaks, special tokens
let firsts = new Map() // a remembered span's rest -> the token it starts with (firstToken)
let words = null // 1 for allowed tokens with something besides spaces in them
let none = null // no tokens at all: no stops, while a guess has shown nothing yet
let preamble = '' // read before the conversation (text/<language>/pen.md)
let lines = [] // the room's conversation
let from = 0 // the first line the model reads
let cache = { ids: [], past: null } // what the model has read, and its keys and values
let turn = 0 // bumped by every guess and stop: work from an older turn stops
let heard = null // the room's latest word on a question: { id, seq, memory, done }
let asked = 0 // numbers the questions, so a late answer is not taken for a newer one's
let work = Promise.resolve() // one thing at a time, since all of it shares the cache

const queue = (task) =>
    (work = work.then(task).catch((err) => console.error(err)))
// Let waiting messages in. A run of the model never yields to the event
// loop by itself, so without this a stop sent mid-guess would only arrive
// after the guess was done, and a visitor typing at a normal pace would
// queue up a full guess for every key.
const yieldToMessages = () => new Promise((resolve) => setTimeout(resolve))
const encode = (text) =>
    Array.from(tokenizer.encode(text, { add_special_tokens: false }))
const conversation = (first) =>
    `${preamble}\n${lines
        .slice(first)
        .map((line) => `${line}\n`)
        .join('')}`

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
    const ms = busy.reduce(
        (sum, [start, took]) =>
            sum + Math.min(took, start + took - (now - WINDOW)),
        0
    )
    let cached = 0
    for (const tensor of Object.values(cache.past ?? {}))
        cached += tensor.data.byteLength
    report({
        cpu: `${Math.round((100 * ms) / WINDOW)}%`,
        ram: `${Math.round((weights + cached) / 1e6)} MB`
    })
}

async function load(text) {
    // Downloads report every chunk; the page hears only when the
    // percentage moves.
    const status = (done) => report({ download: done })
    const files = {}
    const bytes = (key) =>
        Object.values(files).reduce((sum, f) => sum + f[key], 0)
    const progress_callback = (p) => {
        // The weights are here; what remains is starting the runtime.
        if (p.status === 'done' && p.file.endsWith('.onnx'))
            postMessage({ starting: true })
        if (p.status !== 'progress' || !p.total) return
        files[p.file] = p
        // The small files finish first; until the weights have said how big
        // they are, a percentage would only count those.
        if (!Object.keys(files).some((file) => file.endsWith('.onnx'))) return
        // Only a ready model is 100%.
        status(
            `${Math.min(99, Math.floor((100 * bytes('loaded')) / bytes('total')))}%`
        )
    }
    status('0%')
    preamble = text.preamble
    // One thread when asked: writer.js asks after a start that hung (ONNX
    // Runtime's threads sometimes never come up in Firefox).
    if (text.threads) env.backends.onnx.wasm.numThreads = text.threads
    tokenizer = await AutoTokenizer.from_pretrained(MODEL, {
        progress_callback
    })
    model = await AutoModelForCausalLM.from_pretrained(MODEL, {
        device: DEVICE,
        // 8-bit weights: the fastest on the CPU (measured 2026-11-21: 4-bit
        // reads a prompt 1.1-1.3x slower and writes 2.5-3x slower; full
        // precision reads 1.6x slower), and a smaller download than 4-bit
        // (137 MB against 182 MB). Its activations are quantized per run,
        // so text read in chunks scores a hair differently than text read
        // at once; full precision matches token for token.
        dtype: 'q8',
        progress_callback
    })
    vocab = Array.from({ length: model.config.vocab_size }, (_, id) =>
        tokenizer.decode([id])
    )
    const special = new Set(tokenizer.all_special_ids)
    allowed = Uint8Array.from(
        vocab,
        (piece, id) => !special.has(id) && piece !== '' && isPlain(piece)
    )
    stops = Uint8Array.from(
        vocab,
        (piece, id) => special.has(id) || piece.includes('\n')
    )
    words = Uint8Array.from(
        vocab,
        (piece, id) => allowed[id] && /\S/.test(piece)
    )
    none = new Uint8Array(vocab.length)
    weights = bytes('total')
    usage()
    setInterval(usage, 2000)
    postMessage({ ready: true })
    warm()
}

// ------------------------------------------------------------ the cache

const ids = (list) =>
    new Tensor(
        'int64',
        BigInt64Array.from(list, (id) => BigInt(id)),
        [1, list.length]
    )

// Run the model over `next`, after what the cache holds. Returns the scores
// for the token that follows.
async function step(next) {
    const length = cache.ids.length + next.length
    const started = performance.now()
    const out = await model({
        input_ids: ids(next),
        attention_mask: ids(new Array(length).fill(1)),
        past_key_values: cache.past
    })
    busy.push([started, performance.now() - started])
    const past = {}
    for (const name in out)
        if (name.startsWith('present'))
            past[name.replace('present', 'past_key_values')] = out[name]
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
            data.set(
                tensor.data.subarray(
                    head * seen * size,
                    (head * seen + length) * size
                ),
                head * length * size
            )
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
        scores = await step(
            tokens.slice(cache.ids.length, cache.ids.length + CHUNK)
        )
    }
    return scores
}

// The conversation as tokens, from where the model starts reading.
function context() {
    from = start(
        from,
        lines.length,
        (first) => encode(conversation(first)).length,
        { most: MOST, least: LEAST }
    )
    return encode(conversation(from))
}

// Read new chat while nothing else is going on; a guess or a stop ends it,
// and the guess picks up where it left off.
function warm() {
    const at = turn
    queue(async () => {
        const tokens = context()
        if (common(cache.ids, tokens) < tokens.length)
            await read(tokens, () => turn !== at)
    })
}

// ------------------------------------------------------------ guesses

// The token a remembered span's rest starts with, as the tokenizer writes
// it, so the memory lends its share to a spelling the model writes itself
// (boostFrom); none for a token of spaces alone.
function firstToken(rest) {
    if (!firsts.has(rest)) {
        if (firsts.size >= 4096) firsts.clear()
        const id = encode(rest)[0]
        firsts.set(
            rest,
            id !== undefined && /\S/.test(vocab[id]) ? id : undefined
        )
    }
    return firsts.get(rest)
}

// `memory` is what this tab remembered of how the line goes on (memory.js,
// merged by recall.js), or null: spans that went on from the end of the
// line, and the length of the match that found them. The room's peers are
// asked at the same time; their answers come in `heard` as they arrive
// (`done` once no more will), and steer what is left to write.
//
// `preface`, when given, is read before the line instead of the room's
// conversation: the browser extension's guesses in other sites' text
// fields (extension/host.js), which have nothing to do with the chat.
async function guess(
    id,
    line,
    stopped,
    memory,
    done,
    preface = null,
    rewritten = false
) {
    const { stable, tail } = split(line)
    const typed = encode(stable)
    let scores = await read(
        [
            ...(typeof preface === 'string' ? encode(preface) : context()),
            ...typed
        ],
        stopped
    )
    if (!scores) return
    const recent = new Set(typed)
    let pending = tail
    // The model writes from the end of `stable`, so the unfinished word comes
    // first in what it writes; the spans go on from after it. A question's
    // spans go on from what had been written when it was asked (its
    // anchor), and count only while what was written since agrees with
    // them, so an answer that comes late steers the guess only if the guess
    // has gone its way. When no span agrees any more, and the last question
    // is closed, the room is asked about the line as it now stands (every
    // ASK_EVERY tokens at most, less often while it has nothing to say); the
    // guess writes on meanwhile. The memory counts for its match length, and
    // for where it came from: text from other rooms than this one counts for
    // less (memory.js).
    let question = { seq: 0, anchor: tail, open: !done }
    let lambda = 0
    let spans = []
    const adopt = (found) => {
        lambda = found ? weight(found.L) * (found.w ?? 1) : 0
        spans = lambda
            ? found.spans.map(([text, share]) => [
                  question.anchor + text,
                  share
              ])
            : []
    }
    adopt(memory)
    let written = ''
    let lastAsked = 0
    let every = ASK_EVERY // doubles each time the room has nothing to say
    let taken = null
    let rewrite = null // the answer that is to rewrite this guess
    // Take what the room has said, since the last token, about the latest
    // question (some of it may have come while the guess waited its turn).
    const listen = () => {
        if (
            !heard ||
            heard === taken ||
            heard.id !== id ||
            heard.seq !== question.seq
        )
            return
        taken = heard
        adopt(heard.memory)
        const agrees = spans.some(
            ([span]) => span.startsWith(written) || written.startsWith(span)
        )
        if (
            !rewritten &&
            !question.seq &&
            written &&
            lambda >= REWRITE &&
            !agrees
        )
            rewrite = heard
        if (heard.done) {
            question.open = false
            if (question.seq && !heard.memory) every *= 2
        }
    }
    let why = 'end' // why the guess stopped: the model ended the line, or the budget ran out
    let shown = 0
    for (let n = 0; n < LENGTH; n++) {
        await yieldToMessages()
        if (stopped()) return
        listen()
        if (rewrite) break
        const boost = spans.length
            ? boostFrom(spans, written, firstToken)
            : null
        if (!boost?.size && !question.open && n - lastAsked >= every) {
            question = { seq: ++asked, anchor: written, open: true }
            lastAsked = n
            postMessage({
                more: { id, seq: question.seq, line: stable + written }
            })
        }
        // A guess may not end, or write only spaces, before it has shown
        // something: after a finished message the model's likeliest next
        // token ends the line, and a guess of nothing shows nothing and is
        // never retried (the visitor saw the ghost freeze).
        const blank = shown === 0 || !/\S/.test(written)
        const token = pick(scores, {
            vocab,
            allowed: blank ? words : allowed,
            stops: blank ? none : stops,
            pending,
            recent,
            penalty: PENALTY,
            boost,
            lambda,
            temperature: TEMPERATURE,
            topP: TOP_P
        })
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
    // Written before its first question closed: the answers still to come
    // may correct it.
    while (
        !rewrite &&
        !rewritten &&
        !question.seq &&
        question.open &&
        !stopped()
    ) {
        await new Promise((resolve) => setTimeout(resolve, 25))
        listen()
    }
    if (stopped()) return
    if (rewrite) {
        postMessage({ ghost: { id, reset: true } })
        return guess(
            id,
            line,
            stopped,
            rewrite.memory,
            rewrite.done,
            preface,
            true
        )
    }
    postMessage({ ghost: { id, done: true, why } })
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
        if (model)
            queue(() =>
                guess(
                    data.id,
                    data.line,
                    () => turn !== mine,
                    data.memory,
                    data.done,
                    data.preface
                )
            )
    } else if (data.command === 'memory') {
        heard = {
            id: data.id,
            seq: data.seq,
            memory: data.memory,
            done: data.done
        }
    } else if (data.command === 'stop') {
        turn++
    }
}
