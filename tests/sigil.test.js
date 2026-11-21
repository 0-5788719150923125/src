import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createSigil, drawSigil } from '../src/js/sigil.js'
import { TILES } from '../src/js/sigil-tiles.js'

// The hashes are of what @tlon/sigil-js 1.4.5 drew for the same input (less
// its unused `dataisgeon` attribute), so these pin the drawing to the old one.
const sha256 = (text) => createHash('sha256').update(text).digest('hex')

test('the welcome sigil is the one sigil-js drew', async () => {
    assert.equal(
        sha256(await createSigil('GhostIsCuteVoidGirl')),
        '6f9665b464658f11657e6f6f97eaf4c0f96cf91e38144cd5ec9066128326ccbf'
    )
})

test('every tile draws as sigil-js drew it', async () => {
    const options = { size: 512, colors: ['black', 'white'], className: 'logo' }
    const all = await Promise.all(Object.keys(TILES).map((syllable) => drawSigil([syllable], options)))
    assert.equal(all.length, 512)
    assert.equal(sha256(all.join('\n')), 'bc223bca327966f8f4c5126de50f1b421f70e62e6e90bddd51544c86f3308ce9')
})
