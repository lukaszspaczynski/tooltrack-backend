// Where generated labels live: <media>/labels, addressed by content like the
// photos next door.
//
// Content addressing means two identical labels are one file, which is the
// common case — the same number label regenerated after a name change is byte
// for byte the same PDF. It also means a file is only removed once no row
// points at it, which the delete path checks.

import { createHash } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { mediaDir } from '../photo-storage'

export type StoredLabel = {
  byteSize: number
  // Relative to the media directory, which is where it belongs: the absolute
  // path depends on the deployment and has no business in the database.
  path: string
}

export function labelDir(): string {
  return join(mediaDir(), 'labels')
}

export async function saveLabelPdf(bytes: Uint8Array): Promise<StoredLabel> {
  const checksum = createHash('sha256').update(bytes).digest('hex')
  const path = join('labels', checksum.slice(0, 2), `${checksum}.pdf`)
  const absolute = join(mediaDir(), path)

  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, bytes)

  return { byteSize: bytes.byteLength, path }
}

export async function readLabelPdf(path: string): Promise<null | Uint8Array> {
  // A path from the database, but still not trusted to stay inside the media
  // directory: a stored '..' would otherwise read anything the process can.
  const absolute = join(mediaDir(), path)
  if (!absolute.startsWith(join(mediaDir(), 'labels'))) return null

  try {
    return await readFile(absolute)
  } catch {
    return null
  }
}

export async function deleteLabelPdf(path: string): Promise<void> {
  const absolute = join(mediaDir(), path)
  if (!absolute.startsWith(join(mediaDir(), 'labels'))) return

  try {
    await unlink(absolute)
  } catch {
    // Already gone, or never written. Either way there is nothing to do and
    // nothing worth failing a delete over.
  }
}
