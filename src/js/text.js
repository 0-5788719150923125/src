// Every string a visitor reads lives in text/<language>/*.md (see
// text/README.md), and is reached here by file and entry: 'radio.missing'
// is the entry "# missing" in radio.md.
//
//   t(key, vars)          the entry as plain text, its %macros% filled
//   html(key, vars)       the entry as HTML, { html }; a lone paragraph
//                         comes back bare, to sit in a line
//   markdown(text, vars)  the same, for Markdown put together in code
//   list(key)             the items of the entry's list
//   source(key)           the entry as written
//   names(file)           the names of a file's entries
//
// A macro's value is escaped, unless it is { html }. Nothing here touches
// the DOM, so tests use it under Node.

import { entries, escape, items, render } from './markdown.js'

let TEXT = {}

// A language's files, as { file: contents }.
export function use(files) {
    TEXT = {}
    for (const [file, contents] of Object.entries(files)) {
        for (const [name, body] of Object.entries(entries(contents)))
            TEXT[`${file}.${name}`] = body
    }
}

// The page's language. English is the only one so far; the build bundles
// each into text/<language>.js.
export async function load(language = 'en') {
    use((await import(`../text/${language}.js`)).default)
}

export function source(key) {
    if (Object.hasOwn(TEXT, key)) return TEXT[key]
    console.warn(`text: nothing at '${key}'`)
    return key
}

export const names = (file) =>
    Object.keys(TEXT)
        .filter((key) => key.startsWith(`${file}.`))
        .map((key) => key.slice(file.length + 1))

const fill = (template, vars = {}, encode) =>
    template.replace(/%([\w-]+)%/g, (match, name) =>
        Object.hasOwn(vars, name) ? encode(vars[name]) : match
    )

const asHtml = (value) =>
    value?.html !== undefined ? value.html : escape(value)

export const t = (key, vars) => fill(source(key), vars, String)

export const markdown = (text, vars) => ({
    html: fill(render(text, { inline: true }), vars, asHtml)
})

export const html = (key, vars) => markdown(source(key), vars)

export const list = (key) => items(source(key))

export { escape }
