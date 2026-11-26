import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
    MAX_FILE,
    collect,
    parseSources,
    slug
} from '../containers/node/sources.js'

test('sources are git URLs, by commas, spaces or lines, each with an optional branch', () => {
    assert.deepEqual(
        parseSources(
            ' https://github.com/a/b.git, https://gitlab.com/c/d#dev\nhttps://example.org/e/f  '
        ),
        [
            { url: 'https://github.com/a/b.git', ref: '' },
            { url: 'https://gitlab.com/c/d', ref: 'dev' },
            { url: 'https://example.org/e/f', ref: '' }
        ]
    )
    assert.deepEqual(parseSources(''), [])
    assert.equal(
        slug('https://github.com/Some-One/Repo.git'),
        'github.com-some-one-repo'
    )
    assert.equal(
        slug('https://gitlab.com/the-resistance/src.eco'),
        'gitlab.com-the-resistance-src.eco'
    )
})

test('a clone is read for its prose, then its code, and nothing else', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'src-sources-'))
    const put = (file, content) => {
        fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
        fs.writeFileSync(path.join(dir, file), content)
    }
    put('src/main.js', 'const answer = 42\n')
    put('README.md', '# The readme comes first\n')
    put('docs/guide.md', 'A guide, prose.\n')
    put('LICENSE', 'MIT License\n')
    put('node_modules/dep/index.js', 'vendored, left out\n')
    put('.github/workflow.yml', 'hidden, left out\n')
    put('package-lock.json', '{}\n')
    put('app.min.js', 'minified\n')
    put('logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]))
    put(
        'data.bin.txt',
        Buffer.concat([Buffer.from('looks like text'), Buffer.from([0, 1, 2])])
    )
    put('huge.md', 'x'.repeat(MAX_FILE + 1))
    const text = collect(dir)
    assert.equal(
        text,
        [
            '# The readme comes first\n',
            'MIT License\n',
            'A guide, prose.\n',
            'const answer = 42\n'
        ].join('\n\n')
    )
    fs.rmSync(dir, { recursive: true })
})
