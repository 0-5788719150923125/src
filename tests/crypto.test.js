import test from 'node:test'
import assert from 'node:assert/strict'
import { keysFor, randomHex, sign, verify } from '../src/js/crypto.js'

test('random hex has the asked length', () => {
    assert.match(randomHex(64), /^[0-9a-f]{64}$/)
    assert.notEqual(randomHex(), randomHex())
})

test('an identity is the same key pair everywhere, and signs', async () => {
    const identity = randomHex(96)
    const keys = await keysFor(identity)
    assert.equal((await keysFor(identity)).pub, keys.pub)
    const signature = await sign(keys, 'hello')
    assert.equal(await verify(keys.pub, signature, 'hello'), true)
    assert.equal(await verify(keys.pub, signature, 'hullo'), false)
    assert.equal(
        await verify((await keysFor(randomHex(96))).pub, signature, 'hello'),
        false
    )
    assert.equal(await verify('not a key', signature, 'hello'), false)
})
