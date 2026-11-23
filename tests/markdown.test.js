import test from 'node:test'
import assert from 'node:assert/strict'
import { entries, inline, items, render } from '../src/js/markdown.js'

const NB = ' '

test('a file is entries under # names; notes and comments are dropped', () => {
    const file = 'notes on the file\n<!-- a comment\n# not an entry -->\n# one\n\nfirst\n\n# two\n```\n# kept\n```\n'
    assert.deepEqual(entries(file), { one: 'first', two: '```\n# kept\n```' })
})

test('every line is printed, and spaces that matter are kept', () => {
    assert.equal(render('a line\n  indented  twice', { inline: true }), `a line<br>${NB}${NB}indented${NB}${NB}twice`)
    assert.equal(render('one\n\ntwo'), '<p>one</p>\n<p>two</p>')
    assert.equal(render('alone'), '<p>alone</p>')
    assert.equal(render('alone', { inline: true }), 'alone')
})

test('headings, lists nested by indent, and fenced code', () => {
    assert.equal(
        render('## Title\n\n- one\n  - nested\n- two\n\n  more\n\n1. first\n2. second\n\n```\n  <kept> *as is*\n```'),
        '<h2>Title</h2>\n' +
            '<ul><li>one<ul><li>nested</li></ul></li><li>two<p>more</p></li></ul>\n' +
            '<ol><li>first</li><li>second</li></ol>\n' +
            '<pre>  &lt;kept&gt; *as is*</pre>'
    )
})

test('ASCII art is not a list', () => {
    assert.equal(render('+   +\n++++', { inline: true }), `+${NB}${NB}${NB}+<br>++++`)
})

test('inline marks', () => {
    assert.equal(inline('*it* **bold** ~~gone~~ `x < y`'), '<i>it</i> <b>bold</b> <del>gone</del> <code>x &lt; y</code>')
    assert.equal(inline('[a link](https://w.org/wiki/F_(p)) ![](assets/a.png)'), '<a href="https://w.org/wiki/F_(p)" target="_blank" rel="noopener">a link</a> <img src="assets/a.png" alt="">')
    assert.equal(inline('[INK@CORE]{.core} [[R(1)]]{.missing}'), '<span class="core">INK@CORE</span> <span class="missing">[R(1)]</span>')
    assert.equal(inline('[bird] 2 * 3 * 4 \\*not\\*'), '[bird] 2 * 3 * 4 *not*')
    assert.equal(inline('<u>kept</u> & < 3 &amp;'), '<u>kept</u> &amp; &lt; 3 &amp;')
    assert.equal(inline('*a **b** c*'), '<i>a <b>b</b> c</i>')
})

test('list items come back as written, links as text and url', () => {
    assert.deepEqual(items('<!-- c -->\n- [bird]\n- [evidence](https://e.org/F_(p))\n- plain words'), [
        '[bird]',
        { text: 'evidence', url: 'https://e.org/F_(p)' },
        'plain words'
    ])
})
