// Where the bytes of a photo live: a directory on disk, addressed by content.
//
// The filesystem rather than the database, because a Postgres carrying a few
// hundred megabytes of JPEG is one nobody wants to back up or replicate. The
// filesystem rather than object storage, because this is a catalog for one
// company's tool shed and a bucket is a dependency, a credential and a bill.
// Everything object storage would change is behind these four functions.
//
// Content addressed: the key is the checksum, so the same photo saved twice is
// one file, and a delete only unlinks when the last row referencing it goes.

import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { extensionFor } from './image-metadata'

export type StoredPhoto = {
  byteSize: number
  checksum: string
  storageKey: string
}

export function mediaDir(): string {
  const configured = process.env.TOOLTRACK_MEDIA_DIR?.trim()
  // Under .local/, which is already gitignored and is where the local Postgres
  // data would go too.
  return configured ? resolve(configured) : resolve(process.cwd(), '.local/media')
}

export function checksumOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function storageKeyFor(checksum: string, contentType: string): string {
  // Two levels of fan-out: a flat directory with fifty thousand files in it is
  // slow to list and unpleasant to look at.
  return `${checksum.slice(0, 2)}/${checksum}.${extensionFor(contentType)}`
}

export async function savePhotoBytes(bytes: Uint8Array, contentType: string): Promise<StoredPhoto> {
  const checksum = checksumOf(bytes)
  const storageKey = storageKeyFor(checksum, contentType)
  const path = photoPath(storageKey)

  await mkdir(dirname(path), { recursive: true })
  // Written whether or not it exists: the content is the name, so a second
  // write of the same key writes the same bytes.
  await writeFile(path, bytes)

  return { byteSize: bytes.byteLength, checksum, storageKey }
}

export async function readPhotoBytes(storageKey: string): Promise<null | Uint8Array> {
  try {
    return await readFile(photoPath(storageKey))
  } catch {
    // A row whose file is gone is a broken photo, not a crashed request. The
    // route answers 404 and the row can be deleted like any other.
    return null
  }
}

export async function deletePhotoFile(storageKey: string): Promise<void> {
  await rm(photoPath(storageKey), { force: true })
}

// Keys come from the database, but they are still turned into a path here, and
// a path built from a string is worth checking once: nothing may escape the
// media directory.
export function photoPath(storageKey: string): string {
  const root = mediaDir()
  const path = resolve(join(root, storageKey))

  if (path !== root && !path.startsWith(root + '/')) {
    throw new Error(`Storage key escapes the media directory: ${storageKey}`)
  }

  return path
}
