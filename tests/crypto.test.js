import test from 'node:test'
import assert from 'node:assert/strict'
import { decrypt, encrypt, keysFor, randomHex, sign, verify } from '../src/js/crypto.js'

test('random hex has the asked length', () => {
    assert.match(randomHex(64), /^[0-9a-f]{64}$/)
    assert.notEqual(randomHex(), randomHex())
})

test('encrypt and decrypt round-trip', async () => {
    const key = randomHex(80)
    assert.equal(await decrypt(await encrypt('hello, world', key), key), 'hello, world')
    await assert.rejects(decrypt(await encrypt('hello', key), 'wrong key'))
})

test('the v3 example message still decrypts', async () => {
    const message = '1HYjTJrf+DxFKmtRr85+OWRKEv47u2JleMmVRRCrGKBsb2H9EMDIpNXf7zqiXaaDFGPe5w=='
    const key = '4621a2fe040bf3382b97fa84e7896fe3f5076614f64fb58542e75e5217e3930b1031441b2aebd8f33b971bbcef813e96'
    assert.equal(await decrypt(message, key), 'stupid is as stupid does')
})

test('an identity is the same key pair everywhere, and signs', async () => {
    const identity = randomHex(96)
    const keys = await keysFor(identity)
    assert.equal((await keysFor(identity)).pub, keys.pub)
    const signature = await sign(keys, 'hello')
    assert.equal(await verify(keys.pub, signature, 'hello'), true)
    assert.equal(await verify(keys.pub, signature, 'hullo'), false)
    assert.equal(await verify((await keysFor(randomHex(96))).pub, signature, 'hello'), false)
    assert.equal(await verify('not a key', signature, 'hello'), false)
})
