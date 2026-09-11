import assert from 'node:assert/strict'
import test from 'node:test'

import type { PgClient, PgPool, PgQueryResult } from '../db'
import {
  attachPhotosTo,
  copyPhotoLinks,
  deletePhotosByIds,
  insertPhoto,
  linkPhoto,
  listAllPhotos,
  listPhotos,
  unlinkPhoto,
} from './photos-store'

type Call = { params: unknown[]; text: string }

// A pool that also hands out a client, because several of these run in a
// transaction. Each query answers from a queue of canned results, so the test
// can say what the database "found" at each step.
function fakePool(results: unknown[][] = []): { calls: Call[]; pool: PgPool } {
  const calls: Call[] = []
  const queue = [...results]

  const answer = (text: string, params: unknown[] = []) => {
    calls.push({ params, text })
    const rows = queue.shift() ?? []
    return Promise.resolve({ rowCount: rows.length, rows } as PgQueryResult<never>)
  }

  const client: PgClient = { query: answer, release() {} }
  const pool = {
    connect: () => Promise.resolve(client),
    query: answer,
  } as unknown as PgPool

  return { calls, pool }
}

function photoRow(overrides: Record<string, unknown> = {}) {
  return {
    attribution: '',
    byte_size: '512',
    checksum: 'abc',
    content_type: 'image/png',
    created_at: '2026-01-01T00:00:00.000Z',
    created_by: '1',
    derived_from: null,
    height: 100,
    id: '5',
    is_primary: false,
    source: 'upload',
    source_url: '',
    storage_key: 'ab/abc.png',
    width: 100,
    ...overrides,
  }
}

const TOOL = { id: 9, kind: 'tool' } as const
const CASE = { id: 4, kind: 'case' } as const

test('a card reads its photos through the link table', async () => {
  const { calls, pool } = fakePool([[photoRow({ is_primary: true })]])

  const photos = await listPhotos(TOOL, pool)

  assert.equal(photos[0].isPrimary, true)
  // Addressed by the picture's own id: it is not reached through any one card.
  assert.equal(photos[0].url, '/api/photos/5/file')
  assert.match(calls[0].text, /FROM "catalog"\."photo_tool"/)
  assert.match(calls[0].text, /JOIN "catalog"\."photo"/)
  // Main photo first, then in the order the pictures were attached to this
  // card — not the order they were uploaded.
  assert.match(calls[0].text, /ORDER BY "l"\."is_primary" DESC, "l"\."created_at" ASC/)
})

test('a case reads from its own link table, chosen by the map and not by the caller', async () => {
  const { calls, pool } = fakePool([[]])

  await listPhotos(CASE, pool)

  assert.match(calls[0].text, /FROM "catalog"\."photo_case"/)
  assert.match(calls[0].text, /"l"\."case_id" = \$1/)
})

test('the same bytes twice are one picture, not a conflict', async () => {
  // ON CONFLICT DO NOTHING returns nothing, so the existing row is read back.
  // A re-import, or the same address pasted again, must not fail and must not
  // produce a second row pointing at the same file.
  const { calls, pool } = fakePool([[], [photoRow({ id: '12' })]])

  const photo = await insertPhoto(
    {
      metadata: { contentType: 'image/png', height: 10, width: 10 },
      source: 'url',
      stored: { byteSize: 10, checksum: 'abc', storageKey: 'ab/abc.png' },
    },
    1,
    pool,
  )

  assert.equal(photo.id, 12)
  assert.match(calls[0].text, /ON CONFLICT \("checksum"\) DO NOTHING/)
  assert.match(calls[1].text, /WHERE "checksum" = \$1/)
})

test('the first picture of a card becomes its main one, decided in the insert', async () => {
  const { calls, pool } = fakePool([[{}], [photoRow({ is_primary: true })]])

  const photo = await linkPhoto(TOOL, 5, 1, pool)

  assert.equal(photo.isPrimary, true)
  // NOT EXISTS in the same statement, so two uploads racing cannot both decide
  // they are the first.
  assert.match(calls[0].text, /NOT EXISTS \(SELECT 1 FROM "catalog"\."photo_tool"/)
})

test('attaching a picture the card already shows is refused, not duplicated', async () => {
  // The link table's primary key is (card, photo); ON CONFLICT DO NOTHING
  // reports it as zero rows written.
  const { pool } = fakePool([[photoRow()], []])

  const result = await attachPhotosTo(TOOL, [5], 1, pool)

  assert.deepEqual(result.attached, [])
  assert.match(result.failed[0].reason, /już na tej karcie/)
})

test('attaching is one insert — nothing is moved and nothing is copied', async () => {
  const { calls, pool } = fakePool([[photoRow()], [{}], [photoRow()]])

  const result = await attachPhotosTo(CASE, [5], 1, pool)

  assert.equal(result.attached.length, 1)
  assert.match(calls[1].text, /INSERT INTO "catalog"\."photo_case"/)
  // The picture itself is untouched: no UPDATE of the photo row, no second row.
  assert.equal(
    calls.filter((call) =>
      /UPDATE "catalog"\."photo"|INSERT INTO "catalog"\."photo" /.test(call.text),
    ).length,
    0,
  )
})

test('taking a picture off its last card deletes the picture', async () => {
  // A bin on a card means the photograph is gone, not that it moved to a
  // library nobody asked to fill.
  const { calls, pool } = fakePool([
    [], // BEGIN
    [{ is_primary: false }], // the link, removed
    [{ storage_key: 'ab/abc.png' }], // no card shows it any more
    [], // nothing else points at the file
  ])

  assert.equal(await unlinkPhoto(TOOL, 5, pool), true)
  assert.match(calls[1].text, /DELETE FROM "catalog"\."photo_tool"/)
  assert.match(calls[2].text, /DELETE FROM "catalog"\."photo"/)
  assert.match(calls[2].text, /NOT EXISTS \(SELECT 1 FROM "catalog"\."photo_tool"/)
  assert.match(calls[2].text, /NOT EXISTS \(SELECT 1 FROM "catalog"\."photo_case"/)
})

test('a picture another card still shows survives being taken off this one', async () => {
  const { calls, pool } = fakePool([
    [],
    [{ is_primary: false }],
    [], // the conditional delete matched nothing: another link remains
  ])

  assert.equal(await unlinkPhoto(CASE, 5, pool), true)
  // No file is unlinked, because the picture is still a row.
  assert.equal(calls.filter((call) => /DELETE FROM "catalog"\."photo" /.test(call.text)).length, 1)
})

test('removing the main photo promotes the oldest attachment on that card', async () => {
  const { calls, pool } = fakePool([[], [{ is_primary: true }], [], []])

  await unlinkPhoto(TOOL, 5, pool)

  const promote = calls.find((call) => /SET "is_primary" = true/.test(call.text))
  assert.ok(promote)
  assert.match(promote!.text, /ORDER BY "created_at" ASC, "photo_id" ASC LIMIT 1/)
})

test('deleting nothing touches no database', async () => {
  const { calls, pool } = fakePool()

  assert.deepEqual(await deletePhotosByIds([], pool), { deleted: 0, promoted: [] })
  assert.deepEqual(calls, [])
})

test('a bulk delete reports every card that now shows a different main photo', async () => {
  const { pool } = fakePool([
    [], // BEGIN
    [{ owner_id: '9' }], // tools losing their primary
    [], // cases losing theirs
    [{ storage_key: 'ab/one.png' }], // the pictures, deleted
    [{}], // the promotion on tool 9
    [], // nothing else points at the file
  ])

  const result = await deletePhotosByIds([5], pool)

  assert.equal(result.deleted, 1)
  assert.deepEqual(result.promoted, [{ id: 9, kind: 'tool' }])
})

test('the library lists a picture once, with every card that shows it', async () => {
  const { calls, pool } = fakePool([
    [
      {
        ...photoRow(),
        owners: [
          { id: '9', isPrimary: true, kind: 'tool', name: 'Szlifierka' },
          { id: '4', isPrimary: false, kind: 'case', name: 'Toolbox' },
        ],
        total_count: '1',
      },
    ],
  ])

  const page = await listAllPhotos(
    { assigned: null, direction: 'desc', limit: 48, offset: 0, search: 'makita', source: 'search' },
    pool,
  )

  // One row, two cards — the point of the link tables.
  assert.equal(page.items.length, 1)
  assert.deepEqual(page.items[0].owners, [
    { id: 9, isPrimary: true, kind: 'tool', name: 'Szlifierka' },
    { id: 4, isPrimary: false, kind: 'case', name: 'Toolbox' },
  ])
  // The same picture heads the tool and sits behind another on the case: a
  // fact about each pairing, which is why it travels with the card and not
  // with the picture.
  // The search matches the cards, because a picture has no name of its own.
  assert.deepEqual(calls[0].params, ['%makita%', 'search', null, 48, 0])
})

test('an unplaced picture is still a picture', async () => {
  const { pool } = fakePool([[{ ...photoRow(), owners: [], total_count: '1' }]])

  const page = await listAllPhotos(
    { assigned: false, direction: 'desc', limit: 48, offset: 0, search: null, source: null },
    pool,
  )

  assert.deepEqual(page.items[0].owners, [])
  assert.equal(page.items[0].url, '/api/photos/5/file')
})

test('the assigned filter asks whether any card shows it', async () => {
  const { calls, pool } = fakePool([[]])

  await listAllPhotos(
    { assigned: true, direction: 'desc', limit: 10, offset: 0, search: null, source: null },
    pool,
  )

  assert.equal(calls[0].params[2], true)
  assert.match(calls[0].text, /"r"\."photo_id" IS NOT NULL\) = \$3/)
})

test('copying a card onto another keeps which picture is the main one', async () => {
  // Duplicating a tool: the copy shows the same pictures, headed by the same
  // one. A link each, no second file.
  const { calls, pool } = fakePool([[{}, {}]])

  const copied = await copyPhotoLinks(TOOL, { id: 12, kind: 'tool' }, 1, pool)

  assert.equal(copied, 2)
  assert.match(calls[0].text, /INSERT INTO "catalog"\."photo_tool"/)
  assert.match(calls[0].text, /SELECT \$2, "photo_id", "is_primary", \$3/)
  assert.deepEqual(calls[0].params, [9, 12, 1])
})

test('copying onto a card that already shows some of them adds only the rest', async () => {
  // ON CONFLICT DO NOTHING on the pair, so running it twice is not an error
  // and does not duplicate a pairing.
  const { calls, pool } = fakePool([[]])

  assert.equal(await copyPhotoLinks(CASE, { id: 7, kind: 'case' }, 1, pool), 0)
  assert.match(calls[0].text, /ON CONFLICT DO NOTHING/)
})
