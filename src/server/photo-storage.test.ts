import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { utimes } from 'node:fs/promises'

import {
  checksumOf,
  deletePhotoFile,
  mediaDir,
  photoPath,
  previewDir,
  previewTtlMs,
  readPhotoBytes,
  readPreviewBytes,
  savePhotoBytes,
  savePreviewBytes,
  storageKeyFor,
  sweepExpiredPreviews,
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

// --- Previews ------------------------------------------------------------

async function age(checksum: string, minutes: number): Promise<void> {
  // Backdating the file is how a test waits half an hour without waiting.
  const when = new Date(Date.now() - minutes * 60 * 1000)
  await utimes(join(previewDir(), `${checksum}.png`), when, when)
}

test('a preview comes back while it is fresh', async () => {
  await withTempMediaDir(async () => {
    const bytes = new TextEncoder().encode('pretend this is a cutout')

    const stored = await savePreviewBytes(bytes)

    assert.equal(stored.storageKey, `previews/${stored.checksum}.png`)
    const cached = await readPreviewBytes(stored.checksum)
    assert.deepEqual(cached?.bytes, Buffer.from(bytes))
    // What is left of its life, so the route can say so in a cache-control.
    assert.ok(cached!.remainingMs > 29 * 60 * 1000, String(cached?.remainingMs))
  })
})

test('an expired preview reads as no preview', async () => {
  await withTempMediaDir(async () => {
    const stored = await savePreviewBytes(new TextEncoder().encode('stary podgląd'))

    await age(stored.checksum, 31)

    // The caller cannot tell "never existed" from "expired", and does not need
    // to: both mean generate it again.
    assert.equal(await readPreviewBytes(stored.checksum), null)
  })
})

test('the sweep removes what has expired and leaves the rest', async () => {
  await withTempMediaDir(async () => {
    const old = await savePreviewBytes(new TextEncoder().encode('stary'))
    const fresh = await savePreviewBytes(new TextEncoder().encode('świeży'))
    await age(old.checksum, 45)

    // force: the sweep normally runs at most once a minute, and a test should
    // not depend on when the last one happened to be.
    assert.equal(await sweepExpiredPreviews(true), 1)
    assert.equal(await readPreviewBytes(old.checksum), null)
    assert.deepEqual((await readPreviewBytes(fresh.checksum))?.bytes, Buffer.from('świeży'))
  })
})

test('the lifetime is half an hour unless the environment says otherwise', (t) => {
  // The variable belongs to whoever runs the tests — .env.example invites
  // setting it — so it is restored rather than deleted, and cleared before the
  // default is asserted.
  const previous = process.env.TOOLTRACK_PREVIEW_TTL_MINUTES
  t.after(() => {
    if (previous === undefined) delete process.env.TOOLTRACK_PREVIEW_TTL_MINUTES
    else process.env.TOOLTRACK_PREVIEW_TTL_MINUTES = previous
  })

  delete process.env.TOOLTRACK_PREVIEW_TTL_MINUTES
  assert.equal(previewTtlMs(), 30 * 60 * 1000)

  process.env.TOOLTRACK_PREVIEW_TTL_MINUTES = '5'
  assert.equal(previewTtlMs(), 5 * 60 * 1000)

  // Zero would expire every preview before it could be looked at; anything
  // unreadable is a typo in a deploy variable.
  for (const bad of ['0', '-5', 'pół godziny', '1.5']) {
    process.env.TOOLTRACK_PREVIEW_TTL_MINUTES = bad
    assert.equal(previewTtlMs(), 30 * 60 * 1000, bad)
  }
})

test('a preview key that is not a checksum is refused, not resolved', async () => {
  await withTempMediaDir(async () => {
    // The name comes from a URL; it is checked rather than trusted.
    assert.equal(await readPreviewBytes('../../etc/passwd'), null)
    assert.equal(await readPreviewBytes('nie-suma'), null)
  })
})

test('previews live apart from photos, so a sweep cannot touch one', async () => {
  await withTempMediaDir(async () => {
    const photo = await savePhotoBytes(new TextEncoder().encode('prawdziwe zdjęcie'), 'image/png')
    const preview = await savePreviewBytes(new TextEncoder().encode('podgląd'))
    await age(preview.checksum, 60)

    await sweepExpiredPreviews(true)

    // The photo is in the store, which nothing sweeps.
    assert.notEqual(await readPhotoBytes(photo.storageKey), null)
    assert.equal(await readPreviewBytes(preview.checksum), null)
  })
})

test('a preview reports less life left as it ages', async () => {
  // This is what the browser is told to cache for. A fresh TTL on every
  // request would let a tab hold a picture the server has already swept.
  await withTempMediaDir(async () => {
    const stored = await savePreviewBytes(new TextEncoder().encode('starzejący się'))
    await age(stored.checksum, 20)

    const cached = await readPreviewBytes(stored.checksum)

    assert.ok(cached)
    assert.ok(cached!.remainingMs < 11 * 60 * 1000, String(cached?.remainingMs))
    assert.ok(cached!.remainingMs > 9 * 60 * 1000, String(cached?.remainingMs))
  })
})
