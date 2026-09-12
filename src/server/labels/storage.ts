// Where generated labels live: <media>/labels, addressed by content like the
// photos next door.
//
// Content addressing means two identical labels are one file, which is the
// common case — the same number label regenerated after a name change is byte
// for byte the same PDF. It also means a file is only removed once no row
// points at it, which the delete path checks.
//
// The preview sits next to its PDF under the same name: identical labels share
// it for free, and it can never outlive the file it is a picture of, because
// whatever unlinks one unlinks the other.

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

// Keyed off the PDF's path rather than its own checksum, which is what ties
// the two together. Answers with the path to record on the row.
export async function saveLabelPreview(pdfPath: string, bytes: Uint8Array): Promise<string> {
  const path = previewPathFor(pdfPath)
  if (!path) return ''

  const absolute = join(mediaDir(), path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, bytes)

  return path
}

export function previewPathFor(pdfPath: string): string {
  return pdfPath.endsWith('.pdf') ? `${pdfPath.slice(0, -4)}.png` : ''
}

// Both the PDF and its preview come out of here: the check that matters is
// that the path stays inside the label directory, and that is the same check
// for either.
export async function readLabelFile(path: string): Promise<null | Uint8Array> {
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

// Takes the preview with it: the row that pointed at the PDF is the only thing
// that pointed at its picture, so leaving the PNG behind would leave a file
// nothing can ever reach.
export async function deleteLabelPdf(path: string): Promise<void> {
  for (const candidate of [path, previewPathFor(path)]) {
    if (!candidate) continue

    const absolute = join(mediaDir(), candidate)
    if (!absolute.startsWith(join(mediaDir(), 'labels'))) continue

    try {
      await unlink(absolute)
    } catch {
      // Already gone, or never written. Either way there is nothing to do and
      // nothing worth failing a delete over.
    }
  }
}
