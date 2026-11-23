// Everything the terminal prints. A line is a speaker's handle, then a body:
//
//   > ONE@FOLD: Station does not exist.
//
// Speakers are data. The symbol says which way the words go: < from you,
// > to you.

import { escape, html } from './text.js'
import { formatDate } from './time.js'

// A list in `count` columns, read top to bottom, the extra items going to
// the first columns one each: seven in three are 3, 2 and 2.
const columns = (items, count) => {
    const out = []
    for (let c = 0, at = 0; c < count; c++) {
        const size = Math.floor(items.length / count) + (c < items.length % count ? 1 : 0)
        out.push(items.slice(at, (at += size)))
    }
    return out.filter((column) => column.length)
}

export const SPEAKERS = {
    ink: { symbol: '<', name: 'INK', location: 'CORE', color: 'core' }, // you
    fold: { symbol: '>', name: 'ONE', location: 'FOLD', color: 'fold' }, // the terminal, and everyone else
    pen: { symbol: '>', name: 'PEN', location: 'ROOT', color: 'root' } // the model in this tab
}

export const handle = ({ symbol, name, location }) => `${symbol} ${name}@${location}:`

const MAX_LINES = 1000
const output = document.querySelector('#container output')
const page = () => document.documentElement.scrollHeight

// Whether the reader is at the bottom of the page, where new lines are
// followed.
let atBottom = true
window.addEventListener('scroll', () => {
    atBottom = window.scrollY + (window.visualViewport?.height ?? window.innerHeight) > page() - 300
})

const el = (tag, className, ...children) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    node.append(...children)
    return node
}

// Appends a line and returns it, so a caller can take it away again.
//
//   body       a string is plain text; { html } is markup; { list } is the
//              column list of /help; { text, tooltip } is text with a note
//              that shows on hover
//   speaker    null prints the body alone, with no handle
//   block      starts the body on a line of its own
//   scroll     'always' (the default), 'follow' (only a reader already at
//              the bottom), or 'never'
export function print(speaker, body, { block = false, scroll = 'always' } = {}) {
    const text = el('span', 'text')
    if (block) text.style.display = 'block'
    if (typeof body === 'string') text.textContent = body
    else if (body.html !== undefined) text.innerHTML = body.html
    else if (body.list) text.append(el('div', 'help', ...columns(body.list, 3).map((items) => el('ul', null, ...items.map((item) => el('li', null, item))))))
    else text.append(el('span', 'tooltip', body.tooltip), body.text)

    const line = el('div', 'content')
    if (speaker) line.append(el('span', `handle ${speaker.color}`, handle(speaker)))
    line.append(text)
    output.append(line)
    while (output.childElementCount > MAX_LINES) output.firstElementChild.remove()

    if (scroll === 'always' || (scroll === 'follow' && atBottom)) window.scrollTo(0, page())
    return line
}

// The terminal speaking: most lines are this.
export const say = (body, options) => print(SPEAKERS.fold, body, options)

export const clear = () => output.replaceChildren()

// Links open in a new tab, so the terminal is never navigated away from.
export const link = (href, label) => ({ html: `<a href="${escape(href)}" target="_blank" rel="noopener">${escape(label)}</a>` })

// Art, a title, the date, and where to start.
export const banner = (art, title) => ({
    html: `${art}<h1>${escape(title)}</h1>${html('banner.lines', { date: formatDate() }).html}<br><br>`
})

// The handle before the command line: who you are.
export function showPrompt(speaker) {
    const prompt = document.getElementById('prompt')
    prompt.className = speaker.color
    prompt.textContent = handle(speaker)
}
