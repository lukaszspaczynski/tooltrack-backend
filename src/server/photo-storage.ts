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
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
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

// --- Previews ------------------------------------------------------------
//
// A cutout somebody has looked at but not kept. They live apart from the
// photos on purpose: a directory nothing in the catalog points at can be swept
// without ever asking whether a file is still needed, and a preview that is
// never accepted must not become permanent because it happened to be written
// to the same place as one that was.
//
// Kept for half an hour by default — long enough to compare two methods and
// think about it, short enough that an afternoon of experimenting does not
// accumulate.

const DEFAULT_PREVIEW_TTL_MINUTES = 30

// Not more often than this, however many previews are generated: the sweep
// reads a directory, and doing that on every click would be work nobody asked
// for.
const SWEEP_INTERVAL_MS = 60_000

let lastSweep = 0

export function previewTtlMs(): number {
  const raw = process.env.TOOLTRACK_PREVIEW_TTL_MINUTES
  const parsed = Number(raw)
  const minutes =
    raw?.trim() && Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PREVIEW_TTL_MINUTES

  return minutes * 60 * 1000
}

export function previewDir(): string {
  return join(mediaDir(), 'previews')
}

function previewPath(checksum: string): string {
  // The name is a checksum and nothing else, so there is no path to escape
  // with — but it is checked rather than trusted, like every other key here.
  if (!/^[0-9a-f]{64}$/.test(checksum)) {
    throw new Error(`Preview key is not a checksum: ${checksum}`)
  }

  return join(previewDir(), `${checksum}.png`)
}

export async function savePreviewBytes(bytes: Uint8Array): Promise<StoredPhoto> {
  const checksum = checksumOf(bytes)

  await mkdir(previewDir(), { recursive: true })
  await writeFile(previewPath(checksum), bytes)
  // Every write is also a chance to clear what has expired; there is no cron
  // in this server and a preview cache does not deserve one.
  void sweepExpiredPreviews()

  return { byteSize: bytes.byteLength, checksum, storageKey: `previews/${checksum}.png` }
}

export type CachedPreview = {
  // How long this preview still has. The route turns it into a cache-control,
  // because a browser told it may keep the bytes for a full TTL — measured
  // from whenever it happened to ask — outlives the file: the picture still
  // looks fine on screen while the save answers "expired".
  remainingMs: number
  bytes: Uint8Array
}

// Null for a preview that was never made, and for one that has expired — the
// caller cannot tell the two apart and does not need to: both mean "generate
// it again".
export async function readPreviewBytes(checksum: string): Promise<null | CachedPreview> {
  let path: string
  try {
    path = previewPath(checksum)
  } catch {
    return null
  }

  try {
    const info = await stat(path)
    const ttl = previewTtlMs()
    const age = Date.now() - info.mtimeMs
    if (age > ttl) return null

    return { bytes: await readFile(path), remainingMs: Math.max(ttl - age, 0) }
  } catch {
    return null
  }
}

export async function sweepExpiredPreviews(force = false): Promise<number> {
  const now = Date.now()
  if (!force && now - lastSweep < SWEEP_INTERVAL_MS) return 0
  lastSweep = now

  let names: string[]
  try {
    names = await readdir(previewDir())
  } catch {
    return 0
  }

  const ttl = previewTtlMs()
  let removed = 0

  for (const name of names) {
    const path = join(previewDir(), name)
    try {
      const info = await stat(path)
      if (now - info.mtimeMs <= ttl) continue
      await rm(path, { force: true })
      removed += 1
    } catch {
      // A file that vanished between readdir and stat is one less to remove.
    }
  }

  return removed
}
