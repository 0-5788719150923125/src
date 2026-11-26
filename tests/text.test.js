import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { readText } from '../scripts/build.js'
import { html, list, markdown, names, source, t, use } from '../src/js/text.js'

const languages = readText()
use(languages.en)

test('t fills macros and leaves unknown ones', () => {
    assert.equal(
        t('terminal.missing', { command: '/nope' }),
        "The '/nope' command does not exist."
    )
    assert.equal(
        t('terminal.missing'),
        "The '%command%' command does not exist."
    )
})

test('html renders an entry and escapes what is filled in', () => {
    assert.equal(
        html('radio.playing', { artist: '*<b>&*', title: { html: '<u>t</u>' } })
            .html,
        'Now playing: *&lt;b&gt;&amp;* - &quot;<u>t</u>&quot;'
    )
    assert.equal(markdown('*%x%*', { x: '%y%' }).html, '<i>%y%</i>')
})

test('/about is the overview, with its links', () => {
    assert.deepEqual(names('about'), ['overview'])
    assert.ok(list('lore.types').includes('[GHOST]'))
    const overview = html('about.overview', { type: '[GHOST]' }).html
    assert.match(overview, /^<h2>Overview<\/h2>/)
    assert.match(overview, /<span class="missing">\[GHOST\]<\/span>/)
    assert.match(overview, /href="https:\/\/github\.com\/0-5788719150923125"/)
    assert.match(
        overview,
        /href="https:\/\/gitlab\.com\/the-resistance\/src\.eco"/
    )
})

// Every key the code asks for exists, and every entry outside the lore is
// asked for: a translation can follow the files alone. The code is the
// site's, the browser extension's, and the two scripts that read the
// extension's listing.
const root = path.join(import.meta.dirname, '..')
const scripts = (dir) =>
    fs
        .readdirSync(path.join(root, dir))
        .filter((file) => file.endsWith('.js'))
        .map((file) => path.join(root, dir, file))
const code = [
    ...scripts('src/js'),
    ...scripts('extension'),
    path.join(root, 'scripts', 'extension.js'),
    path.join(root, 'scripts', 'stores.js')
]
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n')
const asked = [...code.matchAll(/\b(?:t|html|list|source)\('([\w.-]+)'/g)].map(
    (m) => m[1]
)

test('every key the code asks for exists', () => {
    assert.ok(asked.length > 20)
    for (const key of asked)
        assert.notEqual(source(key), key, `missing text: ${key}`)
})

test('every entry is used', () => {
    const lore = ['about', 'lore']
    const unused = Object.keys(languages.en)
        .filter((file) => !lore.includes(file))
        .flatMap((file) => names(file).map((name) => `${file}.${name}`))
        .filter((key) => !asked.includes(key))
    assert.deepEqual(unused, [])
})

test('every language has the same entries as English', () => {
    const keys = (files) => {
        use(files)
        return Object.keys(files)
            .flatMap((file) => names(file).map((name) => `${file}.${name}`))
            .sort()
    }
    const english = keys(languages.en)
    for (const [language, files] of Object.entries(languages))
        assert.deepEqual(keys(files), english, language)
    use(languages.en)
})
