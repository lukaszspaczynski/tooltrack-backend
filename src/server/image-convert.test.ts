import assert from 'node:assert/strict'
import test from 'node:test'

import sharp from 'sharp'

import { ImageConversionError, STORED_CONTENT_TYPE, toRgba, toStoredPng } from './image-convert'
import { readImageMetadata } from './image-metadata'

async function sample(format: 'jpeg' | 'png' | 'webp'): Promise<Uint8Array> {
  const image = sharp({
    create: { background: { b: 200, g: 150, r: 100 }, channels: 3, height: 40, width: 60 },
  })

  const buffer = await (
    format === 'jpeg' ? image.jpeg() : format === 'webp' ? image.webp() : image.png()
  ).toBuffer()

  return new Uint8Array(buffer)
}

test('a JPEG is stored as PNG', async () => {
  const converted = await toStoredPng(await sample('jpeg'))

  assert.equal(converted.metadata.contentType, STORED_CONTENT_TYPE)
  assert.equal(converted.sourceContentType, 'image/jpeg')
  assert.deepEqual([converted.metadata.width, converted.metadata.height], [60, 40])
  assert.equal(readImageMetadata(converted.bytes)?.contentType, 'image/png')
})

test('a WebP is stored as PNG — the format search engines mostly return', async () => {
  const converted = await toStoredPng(await sample('webp'))

  assert.equal(converted.sourceContentType, 'image/webp')
  assert.equal(converted.metadata.contentType, STORED_CONTENT_TYPE)
})

test('a PNG is kept byte for byte', async () => {
  // Re-encoding would change the checksum, and with it the storage key, for
  // no gain at all.
  const original = await sample('png')

  const converted = await toStoredPng(original)

  assert.equal(converted.bytes, original)
  assert.equal(converted.sourceContentType, 'image/png')
})

test('a file that is not an image never reaches the decoder', async () => {
  for (const bytes of [
    new TextEncoder().encode('<html>hello</html>'),
    new TextEncoder().encode('%PDF-1.7'),
    new Uint8Array(0),
  ]) {
    await assert.rejects(() => toStoredPng(bytes), ImageConversionError)
  }
})

test('pixels come back as four channels whatever went in', async () => {
  // The mask arithmetic in the cutout has one shape, so an image with no alpha
  // channel still has to arrive with one.
  const { height, pixels, width } = await toRgba(await sample('jpeg'))

  assert.deepEqual([width, height], [60, 40])
  assert.equal(pixels.length, 60 * 40 * 4)
  assert.equal(pixels[3], 255)
})

test('unreadable bytes fail as a conversion error, not as whatever sharp throws', async () => {
  await assert.rejects(() => toRgba(new TextEncoder().encode('nie obraz')), ImageConversionError)
})
