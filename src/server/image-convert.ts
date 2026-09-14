// One stored format: PNG.
//
// Everything that reaches the media directory goes through here first. A
// catalog that holds four formats has to decode four formats everywhere it
// touches a picture — the cutout, any future thumbnail, any future export —
// and the one it could not read (WebP, which is most of what an image search
// returns) was exactly the one people wanted to cut out. Converting once, at
// the door, makes every later step deal with a single format.
//
// The cost is size: a photograph that arrives as a 200 kB JPEG leaves here as
// a PNG several times larger, because PNG is lossless and photographs are not
// what it was designed for. For a tool catalog measured in hundreds of
// pictures that is an acceptable trade for never failing to read one.

import sharp from 'sharp'
import type { ErrorCode } from './error-codes'

import { readImageMetadata, type ImageMetadata } from './image-metadata'
import { t } from './i18n'

export const STORED_CONTENT_TYPE = 'image/png'

export class ImageConversionError extends Error {
  readonly code: ErrorCode

  constructor(message: string) {
    super(message)
    this.name = 'ImageConversionError'
    this.code = 'IMAGE_UNREADABLE'
  }
}

export type ConvertedImage = {
  bytes: Uint8Array
  metadata: ImageMetadata
  // What arrived, for the record: 'image/png' means nothing was re-encoded.
  sourceContentType: string
}

export async function toStoredPng(bytes: Uint8Array): Promise<ConvertedImage> {
  // Our own sniffing stays the gate: it decides whether this is an image at
  // all, before a decoder is handed anything. A file that fails here never
  // reaches sharp.
  const source = readImageMetadata(bytes)
  if (!source) {
    throw new ImageConversionError('Ten plik nie jest obrazem JPEG, PNG, GIF ani WebP')
  }

  // Already PNG: keep the exact bytes. Re-encoding would change the checksum,
  // and with it the storage key, for no gain.
  if (source.contentType === STORED_CONTENT_TYPE) {
    return { bytes, metadata: source, sourceContentType: source.contentType }
  }

  let converted: Buffer
  try {
    converted = await sharp(Buffer.from(bytes), { animated: false })
      // Maximum compression: this runs once per photo, and the bytes are kept
      // for years.
      .png({ compressionLevel: 9, effort: 7 })
      .toBuffer()
  } catch (error) {
    throw new ImageConversionError(
      t('Nie udało się przekonwertować zdjęcia na PNG: {reason}', {
        reason: error instanceof Error ? error.message : t('nieznany błąd'),
      }),
    )
  }

  const metadata = readImageMetadata(converted)
  if (!metadata)
    throw new ImageConversionError(t('Konwersja zwróciła coś, co nie jest obrazem PNG'))

  return { bytes: converted, metadata, sourceContentType: source.contentType }
}

// Decodes any stored picture to raw RGBA for the local cutout. Separate from
// the conversion above because it answers a different question: not "what do
// we keep" but "what are the pixels".
export async function toRgba(
  bytes: Uint8Array,
): Promise<{ height: number; pixels: Uint8Array; width: number }> {
  try {
    const { data, info } = await sharp(Buffer.from(bytes))
      // Four channels whatever arrived, so the mask arithmetic has one shape.
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    return { height: info.height, pixels: data, width: info.width }
  } catch {
    throw new ImageConversionError(t('Nie udało się odczytać pikseli zdjęcia'))
  }
}

export async function pngFromRgba(
  pixels: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const png = await sharp(Buffer.from(pixels), { raw: { channels: 4, height, width } })
    .png({ compressionLevel: 9, effort: 7 })
    .toBuffer()

  return new Uint8Array(png)
}
