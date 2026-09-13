// Where the bytes of a manual live.
//
// The same arrangement as the photos next door, under its own directory: the
// filesystem rather than the database, content addressed by checksum, and
// nothing escaping the media root. A PDF is bigger than a photograph and read
// far less often, which changes none of that.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { checksumOf, mediaDir } from './photo-storage'

export type StoredManual = {
  byteSize: number
  checksum: string
  storageKey: string
}

// A manual is a document somebody will open on a phone on a site. Forty
// megabytes is a generous scan of a hundred-page parts list; more than that is
// a file somebody meant to compress.
export const MAX_MANUAL_BYTES = 40 * 1024 * 1024

export class NotAPdfError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotAPdfError'
  }
}

// The bytes decide, not the name and not the content-type header. A shop
// serving an HTML error page with `.pdf` on the end of the address is the
// common case this catches.
export function isPdf(bytes: Uint8Array): boolean {
  // %PDF- at the top, allowing for the junk some generators put before it.
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 1024))
  return head.includes('%PDF-')
}

export async function saveManualBytes(bytes: Uint8Array): Promise<StoredManual> {
  const checksum = checksumOf(bytes)
  const storageKey = `${checksum.slice(0, 2)}/${checksum}.pdf`
  const path = manualPath(storageKey)

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)

  return { byteSize: bytes.byteLength, checksum, storageKey }
}

export async function readManualBytes(storageKey: string): Promise<null | Uint8Array> {
  try {
    return await readFile(manualPath(storageKey))
  } catch {
    // A row whose file is gone is a broken manual, not a crashed request.
    return null
  }
}

export async function deleteManualFile(storageKey: string): Promise<void> {
  await rm(manualPath(storageKey), { force: true })
}

// Keys come from the database, but a path built from a string is worth
// checking once: nothing may escape the manuals directory.
export function manualPath(storageKey: string): string {
  const root = join(mediaDir(), 'manuals')
  const path = resolve(join(root, storageKey))

  if (path !== root && !path.startsWith(root + '/')) {
    throw new Error(`Storage key escapes the manuals directory: ${storageKey}`)
  }

  return path
}

// "instrukcja_pl_v2_final.pdf" is not a title, but it is better than nothing
// and it is what the person chose when they saved the file.
export function titleFromFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''

  return (
    base
      .replace(/\.pdf$/i, '')
      // Underscores were spaces once; hyphens were not. "GSB 185-LI" is a model
      // number and losing the hyphen makes it a different one.
      .replace(/_+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}
