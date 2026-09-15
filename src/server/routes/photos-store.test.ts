import assert from 'node:assert/strict'
import test from 'node:test'

import type { PgClient, PgPool, PgQueryResult } from '../db'
import {
  attachPhotosTo,
  copyPhotoLinks,
  deletePhotosByIds,
  exclusivePhotoIds,
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

const TOOL = { id: 9, kind: 'item' } as const
const CASE = { id: 4, kind: 'case' } as const

test('a card reads its photos through the link table', async () => {
  const { calls, pool } = fakePool([[photoRow({ is_primary: true })]])

  const photos = await listPhotos(TOOL, pool)

  assert.equal(photos[0].isPrimary, true)
  // Addressed by the picture's own id: it is not reached through any one card.
  assert.equal(photos[0].url, '/api/photos/5/file')
  assert.match(calls[0].text, /FROM "catalog"\."photo_item"/)
  assert.match(calls[0].text, /JOIN "catalog"\."photo"/)
  // Main photo first, then in the order the pictures were attached to this
  // card — not the order they were uploaded.
  assert.match(calls[0].text, /ORDER BY "l"\."is_primary" DESC, "l"\."created_at" ASC/)
})

test('both kinds read the same link table, chosen by the map and not by the caller', async () => {
  // There were two tables while a case was one. The map survived the fold, and
  // the reason is unchanged: a kind that is not a key of it cannot reach a
  // query, whatever arrives in the path.
  const { calls, pool } = fakePool([[], []])

  await listPhotos(CASE, pool)
  await listPhotos(TOOL, pool)

  for (const call of calls) {
    assert.match(call.text, /FROM "catalog"\."photo_item"/)
    assert.match(call.text, /"l"\."item_id" = \$1/)
  }
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
  assert.match(calls[0].text, /NOT EXISTS \(SELECT 1 FROM "catalog"\."photo_item"/)
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
  assert.match(calls[1].text, /INSERT INTO "catalog"\."photo_item"/)
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
  assert.match(calls[1].text, /DELETE FROM "catalog"\."photo_item"/)
  assert.match(calls[2].text, /DELETE FROM "catalog"\."photo"/)
  assert.match(calls[2].text, /NOT EXISTS \(SELECT 1 FROM "catalog"\."photo_item"/)
})

test('what a card is the only home of is asked before it is deleted, not after', async () => {
  // The same three holds as the delete rule, minus this card's own link: that
  // is the one about to go. A confirmation saying "and its photographs"
  // without a number is one nobody can weigh.
  const { calls, pool } = fakePool([[{ photo_id: '5' }, { photo_id: '7' }]])

  assert.deepEqual(await exclusivePhotoIds(TOOL, pool), [5, 7])

  const [{ text, params }] = calls
  assert.match(text, /FROM "catalog"\."photo_item" AS "l"/)
  // Another card of the same kind, one of the other kind, or a maker's logo.
  assert.match(text, /"same"\."item_id" <> \$1/)
  assert.match(text, /FROM "catalog"\."photo_brand" AS "logo"/)
  assert.deepEqual(params, [TOOL.id])
})

test('a case asks exactly the same question, off the same table', () => {
  // It used to ask about a table of its own. A case is a card now, so the
  // question is one question and the answer cannot depend on which kind is
  // asking — which is what this asserts by asking it the other way round.
  const { calls, pool } = fakePool([[]])

  return exclusivePhotoIds(CASE, pool).then(() => {
    assert.match(calls[0].text, /FROM "catalog"\."photo_item" AS "l"/)
    assert.match(calls[0].text, /"same"\."item_id" <> \$1/)
    assert.doesNotMatch(calls[0].text, /"cross"/)
  })
})

test('a picture that is a maker’s logo is not deleted with the card it sat on', async () => {
  // photo_brand cascades on the photo, so a rule that only knows about cards
  // does not fail here — it quietly takes the logo off a brand that had
  // nothing to do with the item being deleted.
  const { calls, pool } = fakePool([
    [], // BEGIN
    [{ is_primary: false }], // the link, removed
    [], // the conditional delete matched nothing: the logo still holds it
  ])

  assert.equal(await unlinkPhoto(TOOL, 5, pool), true)
  assert.match(calls[2].text, /NOT EXISTS \(SELECT 1 FROM "catalog"\."photo_brand"/)
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
    [{ owner_id: '9' }], // items losing their primary
    [], // cases losing theirs
    [{ storage_key: 'ab/one.png' }], // the pictures, deleted
    [{}], // the promotion on item 9
    [], // nothing else points at the file
  ])

  const result = await deletePhotosByIds([5], pool)

  assert.equal(result.deleted, 1)
  assert.deepEqual(result.promoted, [{ id: 9, kind: 'item' }])
})

test('the library lists a picture once, with every card that shows it', async () => {
  const { calls, pool } = fakePool([
    [
      {
        ...photoRow(),
        owners: [
          { id: '9', isPrimary: true, kind: 'item', name: 'Szlifierka' },
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
    { id: 9, isPrimary: true, kind: 'item', name: 'Szlifierka' },
    { id: 4, isPrimary: false, kind: 'case', name: 'Toolbox' },
  ])
  // The same picture heads the item and sits behind another on the case: a
  // fact about each pairing, which is why it travels with the card and not
  // with the picture.
  // The search matches the cards, because a picture has no name of its own.
  assert.deepEqual(calls[0].params, ['%makita%', 'search', null, 48, 0])
})

test('a picture that is a brand logo says so, and is still unplaced', async () => {
  // A logo is not on a card: it cannot be attached through the photo routes
  // and does not count as assigned. It is, however, what a delete would
  // quietly take away, so the library carries it.
  const { pool } = fakePool([
    [
      {
        ...photoRow(),
        logo_for_brand: { id: '3', name: 'Bosch Professional' },
        owners: [],
        total_count: '1',
      },
    ],
  ])

  const page = await listAllPhotos(
    { assigned: null, direction: 'desc', limit: 48, offset: 0, search: null, source: null },
    pool,
  )

  assert.deepEqual(page.items[0].logoForBrand, { id: 3, name: 'Bosch Professional' })
  assert.deepEqual(page.items[0].owners, [])
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
  // Duplicating an item: the copy shows the same pictures, headed by the same
  // one. A link each, no second file.
  const { calls, pool } = fakePool([[{}, {}]])

  const copied = await copyPhotoLinks(TOOL, { id: 12, kind: 'item' }, 1, pool)

  assert.equal(copied, 2)
  assert.match(calls[0].text, /INSERT INTO "catalog"\."photo_item"/)
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
