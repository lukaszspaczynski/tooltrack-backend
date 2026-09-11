import assert from 'node:assert/strict'
import test from 'node:test'

import { parseBrandCreate, parseBrandPatch, parseColor } from './brands-input'

test('a colour arrives as three numbers and is stored as hex', () => {
  // The leading colour is read off a brand book, where it is three numbers.
  // CSS wants hex, and one stored form means two spellings cannot both exist.
  assert.equal(parseColor('18 36 71'), '#122447')
  assert.equal(parseColor('18,36,71'), '#122447')
  assert.equal(parseColor('rgb(18, 36, 71)'), '#122447')
})

test('hex is accepted in either spelling and lowercased', () => {
  assert.equal(parseColor('#D0392A'), '#d0392a')
  assert.equal(parseColor('d0392a'), '#d0392a')
})

test('a colour nobody has said is empty, which is not black', () => {
  assert.equal(parseColor(''), '')
  assert.equal(parseColor(null), '')
  assert.equal(parseColor(undefined), '')
})

test('a channel outside 0–255, or the wrong count, is not a colour', () => {
  for (const value of [
    '18 36',
    '18 36 71 90',
    '256 0 0',
    '-1 0 0',
    '18 36 x',
    '#12345',
    'czerwony',
  ]) {
    assert.equal(parseColor(value), null, value)
  }
})

test('a brand can be created without a colour and given one later', () => {
  const created = parseBrandCreate({ name: 'Makita' })
  assert.ok(created.ok)
  assert.equal(created.value.color, '')

  const patched = parseBrandPatch({ color: '0 158 224' })
  assert.ok(patched.ok)
  assert.equal(patched.value.color, '#009ee0')
})

test('nonsense in the colour is a 400, not a silently dropped field', () => {
  assert.equal(parseBrandCreate({ color: 'granatowy', name: 'Makita' }).ok, false)
  assert.equal(parseBrandPatch({ color: '300 0 0' }).ok, false)
})
