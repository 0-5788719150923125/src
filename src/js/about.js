// /about: the overview, or one of the pages in text/<language>/about.md.

import { say } from './print.js'
import { pick, shuffle } from './random.js'
import { html, list, markdown, names, source } from './text.js'

const LINKS = 23
const LINKABLE = /^[^[\]*\\`%<>]+$/

// The Wired: LINKS words of its story, never two neighbors, each linked to
// one of the partners. Headings are left alone.
function weave(page, partners) {
    const lines = page.split('\n').map((line) => (line.trim() && !line.startsWith('#') ? line.split(' ') : null))
    const spots = lines.flatMap((words, l) => (words ? words.map((word, w) => ({ l, w, word })) : []))
    const linked = new Set()
    for (const { url } of shuffle(partners).slice(0, LINKS)) {
        let i
        do i = Math.floor(Math.random() * spots.length)
        while (linked.has(i) || linked.has(i - 1) || linked.has(i + 1) || !LINKABLE.test(spots[i].word))
        linked.add(i)
        const { l, w, word } = spots[i]
        lines[l][w] = `[${word}](${url})`
    }
    return page
        .split('\n')
        .map((line, l) => (lines[l] ? lines[l].join(' ') : line))
        .join('\n')
}

const pages = () => names('about').filter((name) => name !== 'overview')

// Each is chosen once a visit.
let type = null
let wired = null

function overview() {
    type ??= pick(list('lore.types'))
    const index = pages()
        .sort()
        .map((name) => `  */about ${name}*`)
        .join('\n')
    return html('about.overview', { type, pages: markdown(index) })
}

export function about([name]) {
    if (!pages().includes(name)) return say(overview(), { block: true })
    if (name === 'us') wired ??= markdown(weave(source('about.us'), list('lore.partners')))
    say(name === 'us' ? wired : html(`about.${name}`), { block: true, scroll: 'never' })
}
