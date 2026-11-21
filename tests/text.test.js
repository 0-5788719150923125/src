import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { readText } from '../scripts/build.js'
import { html, list, markdown, names, source, t, use } from '../src/js/text.js'

const languages = readText()
use(languages.en)

test('t fills macros and leaves unknown ones', () => {
    assert.equal(t('terminal.missing', { command: '/nope' }), "The '/nope' command does not exist.")
    assert.equal(t('terminal.missing'), "The '%command%' command does not exist.")
})

test('html renders an entry and escapes what is filled in', () => {
    assert.equal(
        html('offline.sealed', { message: '*<b>&*', key: { html: '<u>k</u>' } }).html,
        'Your offline message is:<br>  <i>*&lt;b&gt;&amp;*</i><br>Your decryption key is:<br>  <i><u>k</u></i>'
    )
    assert.equal(markdown('*%x%*', { x: '%y%' }).html, '<i>%y%</i>')
})

test('the lore reads as pages and lists', () => {
    assert.deepEqual(names('about').sort(), ['access', 'archives', 'experiments', 'overview', 'support', 'us'])
    assert.ok(list('lore.types').includes('[GHOST]'))
    assert.ok(list('lore.partners').every((partner) => partner.text && /^https?:|^assets\//.test(partner.url)))
    assert.match(html('about.access').html, /^<h2>Access<\/h2>/)
    assert.match(source('about.us'), /^## The Wired\n\nOur story begins/)
})

// Every key the code asks for exists, and every entry outside the lore is
// asked for: a translation can follow the files alone.
const dir = path.join(import.meta.dirname, '..', 'src', 'js')
const code = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.js'))
    .map((file) => fs.readFileSync(path.join(dir, file), 'utf8'))
    .join('\n')
const asked = [...code.matchAll(/\b(?:t|html|list|source)\('([\w.-]+)'/g)].map((m) => m[1])

test('every key the code asks for exists', () => {
    assert.ok(asked.length > 20)
    for (const key of asked) assert.notEqual(source(key), key, `missing text: ${key}`)
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
        return Object.keys(files).flatMap((file) => names(file).map((name) => `${file}.${name}`)).sort()
    }
    const english = keys(languages.en)
    for (const [language, files] of Object.entries(languages)) assert.deepEqual(keys(files), english, language)
    use(languages.en)
})
