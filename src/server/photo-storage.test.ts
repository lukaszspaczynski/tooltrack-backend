import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  checksumOf,
  deletePhotoFile,
  mediaDir,
  photoPath,
  readPhotoBytes,
  savePhotoBytes,
  storageKeyFor,
} from './photo-storage'

async function withTempMediaDir(fn: () => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'tooltrack-media-'))
  const previous = process.env.TOOLTRACK_MEDIA_DIR
  process.env.TOOLTRACK_MEDIA_DIR = directory
  try {
    await fn()
  } finally {
    if (previous === undefined) delete process.env.TOOLTRACK_MEDIA_DIR
    else process.env.TOOLTRACK_MEDIA_DIR = previous
    await rm(directory, { force: true, recursive: true })
  }
}

test('the key is the checksum, so the same bytes are the same file', () => {
  const bytes = new TextEncoder().encode('pretend this is a jpeg')

  const checksum = checksumOf(bytes)
  assert.match(checksum, /^[0-9a-f]{64}$/)
  assert.equal(storageKeyFor(checksum, 'image/jpeg'), `${checksum.slice(0, 2)}/${checksum}.jpg`)
  // The extension follows the type the bytes declared.
  assert.match(storageKeyFor(checksum, 'image/png'), /\.png$/)
})

test('bytes make the round trip', async () => {
  await withTempMediaDir(async () => {
    const bytes = new TextEncoder().encode('pretend this is a png')

    const stored = await savePhotoBytes(bytes, 'image/png')
    assert.equal(stored.byteSize, bytes.byteLength)

    assert.deepEqual(await readPhotoBytes(stored.storageKey), Buffer.from(bytes))
    // On disk where the key says it is.
    assert.deepEqual(await readFile(photoPath(stored.storageKey)), Buffer.from(bytes))
  })
})

test('saving the same photo twice writes one file', async () => {
  await withTempMediaDir(async () => {
    const bytes = new TextEncoder().encode('same picture')

    const first = await savePhotoBytes(bytes, 'image/jpeg')
    const second = await savePhotoBytes(bytes, 'image/jpeg')

    assert.equal(first.storageKey, second.storageKey)
  })
})

test('a missing file reads as null rather than throwing', async () => {
  await withTempMediaDir(async () => {
    assert.equal(await readPhotoBytes('ab/does-not-exist.jpg'), null)
    // Deleting one that is already gone is not an error either.
    await deletePhotoFile('ab/does-not-exist.jpg')
  })
})

test('a key cannot escape the media directory', async () => {
  await withTempMediaDir(async () => {
    for (const key of ['../../etc/passwd', '..', 'ab/../../../secret']) {
      assert.throws(() => photoPath(key), /escapes the media directory/, key)
    }

    // A normal key resolves inside it.
    assert.ok(photoPath('ab/cd.jpg').startsWith(mediaDir() + '/'))
  })
})
