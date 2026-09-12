import assert from 'node:assert/strict'
import test from 'node:test'

import { rgb } from 'pdf-lib'

import { MM, readableOn, toRgb } from './pdf'

test('a millimetre is the same number of points everywhere', () => {
  // 72 points to the inch, 25.4 mm to the inch. A label measured in anything
  // else comes out of the printer the wrong size.
  assert.equal(Math.round(30 * MM), 85)
  assert.equal(Math.round(200 * MM), 567)
})

test('a hex colour becomes the components pdf-lib wants', () => {
  const color = toRgb('#122447')

  assert.ok(Math.abs(color.red - 18 / 255) < 1e-9)
  assert.ok(Math.abs(color.green - 36 / 255) < 1e-9)
  assert.ok(Math.abs(color.blue - 71 / 255) < 1e-9)
})

test('a colour nobody set is white, because a label still has to print', () => {
  assert.deepEqual(toRgb(''), rgb(1, 1, 1))
  assert.deepEqual(toRgb('granatowy'), rgb(1, 1, 1))
})

test('the ink is whichever of black and white can be read on the background', () => {
  // Bosch navy and Bosch green take white; Stanley yellow takes black.
  assert.deepEqual(readableOn(toRgb('#122447')), rgb(1, 1, 1))
  assert.deepEqual(readableOn(toRgb('#244930')), rgb(1, 1, 1))
  assert.deepEqual(readableOn(toRgb('#f5d24a')), rgb(0, 0, 0))
})
