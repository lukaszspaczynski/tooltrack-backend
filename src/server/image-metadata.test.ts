import assert from 'node:assert/strict'
import test from 'node:test'

import { extensionFor, readImageMetadata } from './image-metadata'

// Smallest valid files of each format, built by hand: the parser only reads
// headers, so a header is all a test needs, and a fixture directory of binary
// blobs would be harder to check than these are.
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 13)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

function jpeg(width: number, height: number, extraSegments = true): Uint8Array {
  const parts: number[] = [0xff, 0xd8]
  if (extraSegments) {
    // An APP0/JFIF segment, which every camera file has and which the parser
    // has to skip over to reach the frame header.
    parts.push(0xff, 0xe0, 0x00, 0x10)
    parts.push(...new Array(14).fill(0))
  }
  parts.push(0xff, 0xc0, 0x00, 0x11, 0x08)
  parts.push((height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff)
  parts.push(...new Array(8).fill(0))
  return new Uint8Array(parts)
}

function gif(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(14)
  bytes.set([...'GIF89a'].map((character) => character.charCodeAt(0)))
  const view = new DataView(bytes.buffer)
  view.setUint16(6, width, true)
  view.setUint16(8, height, true)
  return bytes
}

function webpLossy(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32)
  bytes.set(
    [...'RIFF'].map((c) => c.charCodeAt(0)),
    0,
  )
  bytes.set(
    [...'WEBP'].map((c) => c.charCodeAt(0)),
    8,
  )
  bytes.set(
    [...'VP8 '].map((c) => c.charCodeAt(0)),
    12,
  )
  const view = new DataView(bytes.buffer)
  view.setUint16(26, width, true)
  view.setUint16(28, height, true)
  return bytes
}

test('a PNG reports its type and size', () => {
  assert.deepEqual(readImageMetadata(png(1200, 800)), {
    contentType: 'image/png',
    height: 800,
    width: 1200,
  })
})

test('a JPEG is found past the segments in front of the frame header', () => {
  assert.deepEqual(readImageMetadata(jpeg(4032, 3024)), {
    contentType: 'image/jpeg',
    height: 3024,
    width: 4032,
  })
  assert.deepEqual(readImageMetadata(jpeg(640, 480, false)), {
    contentType: 'image/jpeg',
    height: 480,
    width: 640,
  })
})

test('GIF is read little-endian, unlike the rest', () => {
  assert.deepEqual(readImageMetadata(gif(300, 200)), {
    contentType: 'image/gif',
    height: 200,
    width: 300,
  })
})

test('a lossy WebP reports its 14-bit dimensions', () => {
  assert.deepEqual(readImageMetadata(webpLossy(800, 600)), {
    contentType: 'image/webp',
    height: 600,
    width: 800,
  })
})

test('anything that is not one of the four formats is refused', () => {
  // This is the check that stops an upload: the content-type header is a
  // claim, and this is the file answering.
  assert.equal(readImageMetadata(new Uint8Array([1, 2, 3, 4])), null)
  assert.equal(readImageMetadata(new TextEncoder().encode('<html>hello</html>')), null)
  assert.equal(readImageMetadata(new TextEncoder().encode('%PDF-1.7')), null)
  assert.equal(readImageMetadata(new Uint8Array(0)), null)
})

test('a truncated file fails instead of crashing', () => {
  const truncated = png(100, 100).slice(0, 18)
  assert.equal(readImageMetadata(truncated), null)

  // A JPEG whose segment length runs past the end of the buffer.
  const lying = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 0x00, 0x00])
  assert.equal(readImageMetadata(lying), null)

  // A JPEG that reaches the scan without ever declaring a frame.
  const noFrame = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02])
  assert.equal(readImageMetadata(noFrame), null)
})

test('the extension follows the type the bytes claimed, not the file name', () => {
  assert.equal(extensionFor('image/jpeg'), 'jpg')
  assert.equal(extensionFor('image/png'), 'png')
  assert.equal(extensionFor('image/webp'), 'webp')
  assert.equal(extensionFor('application/pdf'), 'bin')
})
