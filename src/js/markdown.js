// Markdown, as the terminal prints it. The text files (text/<locale>/*.md)
// are written in it. It is ordinary Markdown with three terminal habits:
//
//   - A line is a line: every line break in a paragraph is printed.
//   - Spaces are kept where they matter: at the start of a line, and in
//     runs of two or more (indents, aligned columns, ASCII art).
//   - [words]{.class} puts words in a span of that class: the colors are
//     core, root, fold, good and bad; missing is white on black.
//
// What it reads: # headings, paragraphs, - and 1. lists (nested by indent),
// ``` fenced code, *italics*, **bold**, ~~struck~~, `code`, [links](url),
// ![images](src), \-escapes, and inline HTML tags as they are. <!-- -->
// comments are dropped. %name% is a macro, filled in later (text.js).
//
// Nothing here touches the DOM, so it also runs in workers and under Node.

export const escape = (text) =>
    String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const stripComments = (source) => source.replace(/<!--[\s\S]*?-->/g, '')

const isFence = (line) => /^\s*```/.test(line)

const dropBlankEnds = (lines) => {
    let start = 0
    let end = lines.length
    while (start < end && !lines[start].trim()) start++
    while (end > start && !lines[end - 1].trim()) end--
    return lines.slice(start, end)
}

// ------------------------------------------------------------ files

// A file's entries, by name: each '# name' line starts one, and it runs to
// the next. Lines before the first are notes on the file.
export function entries(source) {
    const found = {}
    let current = null
    let fenced = false
    for (const line of stripComments(source).replace(/\r/g, '').split('\n')) {
        if (isFence(line)) fenced = !fenced
        if (!fenced && line.startsWith('# ')) found[(current = line.slice(2).trim())] = []
        else if (current !== null) found[current].push(line)
    }
    return Object.fromEntries(Object.entries(found).map(([name, lines]) => [name, dropBlankEnds(lines).join('\n')]))
}

// ------------------------------------------------------------ blocks

const LIST = /^( *)([-*]|\d+\.) +/
const indentOf = (line) => line.match(/^ */)[0].length

function blocks(lines) {
    const found = []
    let i = 0
    while (i < lines.length) {
        const line = lines[i]
        if (!line.trim()) {
            i++
            continue
        }
        if (isFence(line)) {
            const indent = indentOf(line)
            const body = []
            for (i++; i < lines.length && !isFence(lines[i]); i++) body.push(lines[i].slice(Math.min(indent, indentOf(lines[i]))))
            found.push({ type: 'code', text: body.join('\n') })
            i++
            continue
        }
        const heading = /^(#{1,6}) +(.*)$/.exec(line)
        if (heading) {
            found.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() })
            i++
            continue
        }
        const marker = LIST.exec(line)
        if (marker) {
            const list = { type: 'list', ordered: /\d/.test(marker[2]), items: [] }
            const indent = marker[1].length
            while (i < lines.length) {
                const start = LIST.exec(lines[i])
                if (!start || start[1].length !== indent || /\d/.test(start[2]) !== list.ordered) break
                const column = start[0].length
                const item = [lines[i].slice(column)]
                // An item runs on while its lines are indented past the
                // marker; blank lines inside it are kept if more follows.
                for (i++; i < lines.length; i++) {
                    const next = lines[i]
                    if (next.trim() && indentOf(next) <= indent) break
                    if (!next.trim()) {
                        const more = lines.slice(i).find((l) => l.trim())
                        if (!more || indentOf(more) <= indent) break
                    }
                    item.push(next.slice(Math.min(column, indentOf(next))))
                }
                list.items.push(dropBlankEnds(item))
                while (i < lines.length && !lines[i].trim()) {
                    const more = lines.slice(i).find((l) => l.trim())
                    const again = more && LIST.exec(more)
                    if (!again || again[1].length !== indent) break
                    i++
                }
            }
            found.push(list)
            continue
        }
        const paragraph = []
        while (i < lines.length && lines[i].trim() && !isFence(lines[i]) && !/^#{1,6} /.test(lines[i]) && !LIST.exec(lines[i])) {
            paragraph.push(lines[i++])
        }
        if (!paragraph.length) paragraph.push(lines[i++])
        found.push({ type: 'paragraph', lines: paragraph })
    }
    return found
}

// A paragraph's lines, each printed: leading spaces and runs of two or
// more become no-break spaces, so they survive HTML.
const linesHtml = (lines) =>
    lines.map((line) => inline(line.trimEnd().replace(/^ +| {2,}/g, (s) => ' '.repeat(s.length)))).join('<br>')

function blockHtml(block) {
    if (block.type === 'heading') return `<h${block.level}>${inline(block.text)}</h${block.level}>`
    if (block.type === 'code') return `<pre>${escape(block.text)}</pre>`
    if (block.type === 'paragraph') return `<p>${linesHtml(block.lines)}</p>`
    const tag = block.ordered ? 'ol' : 'ul'
    const items = block.items.map((lines) => {
        // An item's first paragraph sits in the item itself, as in a tight
        // list; anything after it is a block of its own.
        const [first, ...rest] = blocks(lines)
        const head = first?.type === 'paragraph' ? linesHtml(first.lines) : first ? blockHtml(first) : ''
        return `<li>${head}${rest.map(blockHtml).join('')}</li>`
    })
    return `<${tag}>${items.join('')}</${tag}>`
}

// The HTML of some Markdown. With `inline`, a lone paragraph comes back
// without its <p>, to sit in a line of its own.
export function render(markdown, { inline: bare = false } = {}) {
    const found = blocks(stripComments(markdown).replace(/\r/g, '').split('\n'))
    if (bare && found.length === 1 && found[0].type === 'paragraph') return linesHtml(found[0].lines)
    return found.map(blockHtml).join('\n')
}

// The items of the first list, as written; an item that is only a link
// comes back as { text, url }.
export function items(markdown) {
    const list = blocks(stripComments(markdown).split('\n')).find((block) => block.type === 'list')
    return (list?.items ?? []).map((lines) => {
        const text = lines.join('\n').trim()
        const link = /^\[([^\]]*)\]\(([^)\s]+(?:\([^)\s]*\)[^)\s]*)*)\)$/.exec(text)
        return link ? { text: link[1], url: link[2] } : text
    })
}

// ------------------------------------------------------------ inline

const PUNCTUATION = /[\\`*_{}[\]()#+\-.!~%<>|"'&]/
const TAG = /^<\/?[A-Za-z][\w-]*(?:\s[^<>]*)?\/?>/
const ENTITY = /^&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i
const EMPHASIS = [
    ['**', 'b'],
    ['~~', 'del'],
    ['*', 'i']
]

// The end of a bracketed run starting at `open` (which holds `[` or `(`),
// with nesting and escapes; -1 if it never closes.
function closing(text, open) {
    const [left, right] = text[open] === '[' ? ['[', ']'] : ['(', ')']
    let depth = 0
    for (let i = open; i < text.length; i++) {
        if (text[i] === '\\') i++
        else if (text[i] === left) depth++
        else if (text[i] === right && --depth === 0) return i
    }
    return -1
}

// [text](url), or [text]{.class}, starting at `at`.
function bracket(text, at) {
    const end = closing(text, at)
    if (end < 0) return null
    const label = text.slice(at + 1, end)
    if (text[end + 1] === '(') {
        const close = closing(text, end + 1)
        if (close > 0) return { label, url: text.slice(end + 2, close).trim(), next: close + 1 }
    }
    const span = /^\{\.([\w-]+)\}/.exec(text.slice(end + 1))
    if (span) return { label, className: span[1], next: end + 1 + span[0].length }
    return null
}

// Where an emphasis mark opened at `start` closes: not against a space,
// and a single * passes over ** inside it.
function emphasisEnd(text, start, mark) {
    if (!text[start] || /\s/.test(text[start])) return -1
    for (let i = start + 1; i < text.length; i++) {
        if (text[i] === '\\') {
            i++
            continue
        }
        if (mark === '*' && text.startsWith('**', i)) {
            i++
            continue
        }
        if (text.startsWith(mark, i) && !/\s/.test(text[i - 1])) return i
    }
    return -1
}

export function inline(text) {
    let html = ''
    let i = 0
    outer: while (i < text.length) {
        const c = text[i]
        const rest = text.slice(i)
        if (c === '\\' && PUNCTUATION.test(text[i + 1] ?? '')) {
            html += escape(text[i + 1])
            i += 2
            continue
        }
        if (c === '`') {
            const end = text.indexOf('`', i + 1)
            if (end > i) {
                html += `<code>${escape(text.slice(i + 1, end))}</code>`
                i = end + 1
                continue
            }
        }
        if (c === '!' && text[i + 1] === '[') {
            const image = bracket(text, i + 1)
            if (image?.url !== undefined) {
                html += `<img src="${escape(image.url)}" alt="${escape(image.label)}">`
                i = image.next
                continue
            }
        }
        if (c === '[') {
            const found = bracket(text, i)
            if (found) {
                html +=
                    found.url !== undefined
                        ? `<a href="${escape(found.url)}">${inline(found.label)}</a>`
                        : `<span class="${escape(found.className)}">${inline(found.label)}</span>`
                i = found.next
                continue
            }
        }
        const raw = (c === '<' && TAG.exec(rest)) || (c === '&' && ENTITY.exec(rest))
        if (raw) {
            html += raw[0]
            i += raw[0].length
            continue
        }
        for (const [mark, tag] of EMPHASIS) {
            if (!text.startsWith(mark, i)) continue
            const end = emphasisEnd(text, i + mark.length, mark)
            if (end < 0) continue
            html += `<${tag}>${inline(text.slice(i + mark.length, end))}</${tag}>`
            i = end + mark.length
            continue outer
        }
        html += escape(c)
        i++
    }
    return html
}
