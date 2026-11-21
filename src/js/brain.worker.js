// The model behind PEN@ROOT: an ONNX build of SmolLM2-135M-Instruct, run by
// transformers.js on the CPU, with WebAssembly. Never WebGPU, on purpose:
// most visitors don't have it, the site has no business taking theirs, and
// where it does exist it shares memory with every other app on the machine
// (Firefox on 2026-11-20 ran out and answered with noise). Weights download
// once and stay in the browser's cache.

import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js'

const MODEL = 'HuggingFaceTB/SmolLM2-135M-Instruct'
const NAME = 'SmolLM2-135M'
// The model reads at most this many tokens of the conversation, the most
// recent ones. A model this small gets nothing from more, and every extra
// token makes each reply slower and hungrier.
const BUDGET = 512

let ready = null
// PEN's words, from the page (text/<language>/pen.md): `system`, `empty`
// and `fallback`.
let text = null

async function load() {
    const device = 'wasm'
    let last = null
    // Downloads report every chunk; tell the page only when the percentage
    // moves.
    const status = (load) => load !== last && postMessage({ status: { model: NAME, device, load: (last = load) } })
    const files = {}
    status('0%')
    const generator = await pipeline('text-generation', MODEL, {
        device,
        // 8-bit weights: the fastest on the CPU (measured 2026-11-21: 4-bit
        // reads a prompt 1.1-1.3x slower and writes 2.5-3x slower; full
        // precision reads 1.6x slower), and a smaller download than 4-bit
        // (137 MB against 182 MB).
        dtype: 'q8',
        progress_callback: (p) => {
            if (p.status !== 'progress' || !p.total) return
            files[p.file] = p
            const loaded = Object.values(files).reduce((sum, f) => sum + f.loaded, 0)
            const total = Object.values(files).reduce((sum, f) => sum + f.total, 0)
            // Small files finish first; only a ready pipeline is 100%.
            status(`${Math.min(99, Math.floor((100 * loaded) / total))}%`)
        }
    })
    status('100%')
    return generator
}

// The tail of the conversation that fits the budget, starting on a whole
// line where it can.
function recent(tokenizer, messages) {
    const transcript = messages.join('\n')
    const ids = tokenizer.encode(transcript, { add_special_tokens: false })
    if (ids.length <= BUDGET) return transcript
    const tail = tokenizer.decode(ids.slice(-BUDGET), { skip_special_tokens: true })
    return tail.slice(tail.indexOf('\n') + 1)
}

async function generate(messages) {
    const generator = await ready
    const transcript = (messages.length && recent(generator.tokenizer, messages)) || text.empty
    const [out] = await generator(
        [
            { role: 'system', content: text.system },
            { role: 'user', content: transcript }
        ],
        { max_new_tokens: 64, do_sample: true, temperature: 0.3, repetition_penalty: 1.35 }
    )
    const reply = out.generated_text.at(-1).content || ''
    postMessage({ response: reply.split('\n')[0].trim() || text.fallback })
}

onmessage = async ({ data }) => {
    try {
        if (data.command === 'load') {
            text = data.text
            ready = ready || load()
        }
        if (data.command === 'generate') await generate(data.messages)
    } catch (err) {
        console.error(err)
        postMessage({ status: { model: NAME, load: 'failed' } })
    }
}
