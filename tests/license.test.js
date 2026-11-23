import test from 'node:test'
import assert from 'node:assert/strict'
import { stamp } from '../scripts/license.js'

test('the copyright year carries its progress, and the holder stays', () => {
    const license = 'Copyright (c) 2024 Source\n\nPermission is hereby granted, free of charge\n'
    const stamped = stamp(license, new Date(2026, 6, 1))
    assert.match(stamped, /^Copyright \(c\) 2026\.4\d+ Source\n\nPermission/)
    assert.equal(stamp(stamped, new Date(2027, 0, 1)), license.replace('2024', '2027.0'))
})

test('a license without a copyright line is left alone', () => {
    assert.equal(stamp('no notice here\n'), 'no notice here\n')
})
