import assert from 'node:assert/strict'
import test from 'node:test'

import { bodyLimitFor, maxRequestBodyBytes } from './request-body-limit'

test('a photo upload gets the photo cap, everything else the JSON cap', (t) => {
  t.after(() => {
    delete process.env.TOOLTRACK_MAX_PHOTO_BYTES
  })

  const json = maxRequestBodyBytes()

  assert.equal(bodyLimitFor('/api/tools'), json)
  assert.equal(bodyLimitFor('/api/auth/login'), json)
  // A tool card is a small document; a photograph off a phone is not.
  assert.ok(bodyLimitFor('/api/tools/42/photos') > json)
  assert.equal(bodyLimitFor('/api/tools/42/photos/'), bodyLimitFor('/api/tools/42/photos'))

  process.env.TOOLTRACK_MAX_PHOTO_BYTES = '2048'
  assert.equal(bodyLimitFor('/api/tools/42/photos'), 2048)
})

test('the JSON cap applies to the paths around an upload', () => {
  const json = maxRequestBodyBytes()

  // Promoting a photo and importing links are JSON documents, not files.
  assert.equal(bodyLimitFor('/api/tools/42/photos/7'), json)
  assert.equal(bodyLimitFor('/api/tools/42/photo-suggestions'), json)
})
