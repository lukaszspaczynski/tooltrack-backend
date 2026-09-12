import assert from 'node:assert/strict'
import test from 'node:test'

import { drawNumberLabel } from './number-label'
import { renderLabelPreview } from './preview'
import { previewPathFor } from './storage'

test('the preview lives beside its PDF under the same name', () => {
  // The whole dedupe and cleanup story rests on this: identical labels share
  // one PDF, so they share one picture, and unlinking the file finds the
  // picture without asking the database a second question.
  assert.equal(previewPathFor('labels/ab/abcd.pdf'), 'labels/ab/abcd.png')
  assert.equal(previewPathFor('labels/ab/abcd.png'), '')
  assert.equal(previewPathFor(''), '')
})

test('a label renders to a PNG of the shape it was drawn at', async () => {
  // Slow — the rasteriser is WebAssembly and has to be instantiated — and
  // worth it: this is the test that fails if the module cannot load at all,
  // which no amount of typechecking would say.
  const pdf = await drawNumberLabel({
    brands: [{ color: '#122447', logo: null, name: 'Bosch Professional' }],
    cutLine: false,
    heightMm: 40,
    number: 4,
    widthMm: 30,
    withLogos: false,
  })

  const png = await renderLabelPreview(pdf)

  assert.deepEqual([...png.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47])

  // The long side is the one that gets the pixels, and 30 x 40 mm keeps its
  // proportions: a tile showing a squashed label is worse than no tile. Within
  // a few pixels rather than exactly, because the rasteriser floors the page
  // size in points before it scales.
  const width = readUint32(png, 16)
  const height = readUint32(png, 20)
  assert.ok(Math.abs(height - 480) <= 4, String(height))
  assert.ok(Math.abs(width / height - 30 / 40) < 0.01, `${width} x ${height}`)
})

test('a lid gives a wide preview rather than a tall one', async () => {
  const pdf = await drawNumberLabel({
    brands: [{ color: '#244930', logo: null, name: 'Bosch Home & Garden' }],
    cutLine: false,
    heightMm: 60,
    number: 4,
    widthMm: 200,
    withLogos: false,
  })

  const png = await renderLabelPreview(pdf)
  assert.ok(Math.abs(readUint32(png, 16) - 480) <= 4, String(readUint32(png, 16)))
  assert.ok(readUint32(png, 20) < 200, String(readUint32(png, 20)))
})

// The IHDR chunk starts at byte 8 and its width and height are the two big
// endian words after the chunk type. Cheaper than a decoder for two numbers.
function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]
  )
}
