// Reads the type and the pixel dimensions straight out of an image's first
// bytes. No image library: this needs to answer two questions about four
// formats, and pulling in a native dependency to do it would be the largest
// thing in the tree.
//
// It is also the validation. A `content-type: image/jpeg` header is a claim by
// whoever is uploading; this is the file saying what it is. Anything that does
// not parse here never reaches the disk.

export type ImageMetadata = {
  contentType: string
  height: number
  width: number
}

export function readImageMetadata(bytes: Uint8Array): null | ImageMetadata {
  return readPng(bytes) ?? readJpeg(bytes) ?? readGif(bytes) ?? readWebp(bytes)
}

function readPng(bytes: Uint8Array): null | ImageMetadata {
  // \x89PNG\r\n\x1a\n, then an IHDR chunk whose payload starts at byte 16.
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24 || !startsWith(bytes, signature)) return null

  const view = viewOf(bytes)
  return {
    contentType: 'image/png',
    height: view.getUint32(20),
    width: view.getUint32(16),
  }
}

function readJpeg(bytes: Uint8Array): null | ImageMetadata {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null

  const view = viewOf(bytes)
  let offset = 2

  // Walk the segment chain to the start-of-frame marker, which is the only one
  // carrying the dimensions. Sizes come from the file, so every read is bounds
  // checked: a truncated or hostile file must fail as "not an image", not as a
  // crash.
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null

    const marker = bytes[offset + 1]
    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    // Start of scan: past this point is entropy-coded data, not segments.
    if (marker === 0xda) return null

    const length = view.getUint16(offset + 2)
    if (length < 2) return null

    // SOF0..SOF15, minus the four that are not frame headers.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (offset + 9 > bytes.length) return null
      return {
        contentType: 'image/jpeg',
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
      }
    }

    offset += 2 + length
  }

  return null
}

function readGif(bytes: Uint8Array): null | ImageMetadata {
  if (bytes.length < 10) return null
  const header = String.fromCharCode(...bytes.slice(0, 6))
  if (header !== 'GIF87a' && header !== 'GIF89a') return null

  const view = viewOf(bytes)
  return {
    contentType: 'image/gif',
    // GIF is the one format here that is little-endian.
    height: view.getUint16(8, true),
    width: view.getUint16(6, true),
  }
}

function readWebp(bytes: Uint8Array): null | ImageMetadata {
  if (bytes.length < 30) return null
  if (String.fromCharCode(...bytes.slice(0, 4)) !== 'RIFF') return null
  if (String.fromCharCode(...bytes.slice(8, 12)) !== 'WEBP') return null

  const view = viewOf(bytes)
  const format = String.fromCharCode(...bytes.slice(12, 16))

  // Lossy: a VP8 bitstream, dimensions 14 bytes in, 14 bits each.
  if (format === 'VP8 ') {
    return {
      contentType: 'image/webp',
      height: view.getUint16(28, true) & 0x3fff,
      width: view.getUint16(26, true) & 0x3fff,
    }
  }

  // Lossless: VP8L packs both dimensions into 28 bits, minus one.
  if (format === 'VP8L') {
    const packed = view.getUint32(21, true)
    return {
      contentType: 'image/webp',
      height: (((packed >> 14) & 0x3fff) >>> 0) + 1,
      width: ((packed & 0x3fff) >>> 0) + 1,
    }
  }

  // Extended: a VP8X chunk with 24-bit dimensions minus one.
  if (format === 'VP8X') {
    return {
      contentType: 'image/webp',
      height: readUint24(bytes, 27) + 1,
      width: readUint24(bytes, 24) + 1,
    }
  }

  return null
}

export function extensionFor(contentType: string): string {
  switch (contentType) {
    case 'image/gif':
      return 'gif'
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    default:
      return 'bin'
  }
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value)
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function readUint24(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}
