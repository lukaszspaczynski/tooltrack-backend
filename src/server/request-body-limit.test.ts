import assert from 'node:assert/strict'
import test from 'node:test'

import { MAX_MANUAL_BYTES } from './manual-storage'
import { bodyLimitFor, maxRequestBodyBytes } from './request-body-limit'
import { ROUTES, sampleOf } from './route-list'

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

test('every route that takes bytes is over the JSON cap, and nothing else is', () => {
  // The cap is applied by path, before routing, so it is the one rule in this
  // server that is not derived from the routing table. This test is what ties
  // the two back together: a `POST .../photos` or `POST .../manuals` added
  // without a line in the patterns above is refused at a megabyte, which looks
  // to whoever added it like a broken upload rather than a missing line here.
  //
  // A photo off a phone is three to twelve megabytes and a scanned parts list
  // is more. Both were under the JSON cap on the case and manual routes until
  // this existed.
  const json = maxRequestBodyBytes()

  // The bytes are posted to the collection itself. Everything deeper is a
  // document about a file rather than the file: `/photos/attach` sends ids,
  // `/manuals/from-page` sends an address.
  //
  // By path rather than by route, because the cap is decided before the method
  // is looked at — `GET /api/tools/1/manuals` is under the same ceiling and it
  // costs nothing, since readRequestBody reads no body for a GET at all.
  const uploadPaths = new Set(
    ROUTES.filter((route) => /^POST \/api\/(\S+\/)?(photos|manuals)$/.test(route)).map((route) =>
      sampleOf(route.split(' ')[1]),
    ),
  )

  for (const route of ROUTES) {
    const path = sampleOf(route.split(' ')[1])
    const limit = bodyLimitFor(path)

    if (uploadPaths.has(path)) {
      assert.ok(limit > json, `${route} should take a file, but is capped at ${limit}`)
    } else {
      assert.equal(limit, json, `${route} is not an upload and should take the JSON cap`)
    }
  }
})

test('a manual is allowed to be far bigger than a photograph', () => {
  // saveManualBytes refuses anything over MAX_MANUAL_BYTES. A cap in front of
  // it that is stricter makes that constant a fiction, which is what a 40 MB
  // limit behind a 1 MB one was.
  assert.equal(bodyLimitFor('/api/tools/42/manuals'), MAX_MANUAL_BYTES)
  assert.equal(bodyLimitFor('/api/tools/42/manuals/'), MAX_MANUAL_BYTES)
  // The routes beside it carry an address or a list of ids.
  assert.equal(bodyLimitFor('/api/tools/42/manuals/from-page'), maxRequestBodyBytes())
})

test('a case photograph gets the same room as a tool’s', () => {
  // The same camera, the same file. The pattern used to name tools only, so
  // photographing a box failed at a megabyte and photographing a drill did not.
  assert.equal(bodyLimitFor('/api/cases/42/photos'), bodyLimitFor('/api/tools/42/photos'))
  assert.ok(bodyLimitFor('/api/cases/42/photos') > maxRequestBodyBytes())
})
