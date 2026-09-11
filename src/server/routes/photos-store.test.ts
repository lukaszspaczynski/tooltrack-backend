import assert from 'node:assert/strict'
import test from 'node:test'

import type { PgClient, PgPool, PgQueryResult } from '../db'
import { attachPhotosToTool, deletePhotosByIds, insertPhoto, listAllPhotos } from './photos-store'

type Call = { params: unknown[]; text: string }

// A pool that also hands out a client, because the bulk delete runs in a
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

test('the library joins the tool, so a photo can say what it belongs to', async () => {
  const { calls, pool } = fakePool([
    [
      {
        attribution: '',
        byte_size: '1024',
        checksum: 'abc',
        content_type: 'image/jpeg',
        created_at: '2026-01-01T00:00:00.000Z',
        created_by: '1',
        height: 600,
        id: '5',
        is_primary: true,
        source: 'search',
        source_url: 'https://example.com/a.jpg',
        storage_key: 'ab/abc.jpg',
        tool_id: '9',
        tool_name: 'Szlifierka kątowa',
        width: 800,
      },
    ],
  ])

  const page = await listAllPhotos(
    { assigned: null, direction: 'desc', limit: 48, offset: 0, search: 'makita', source: 'search' },
    pool,
  )

  assert.equal(page.items[0].toolName, 'Szlifierka kątowa')
  // Addressed by its own id, because a photo may have no tool to be reached
  // through.
  assert.equal(page.items[0].url, '/api/photos/5/file')
  // LEFT, because a photo waiting for a tool is still a photo.
  assert.match(calls[0].text, /LEFT JOIN "catalog"\."tool"/)
  // The search matches the tool, because a photo has no name of its own.
  assert.deepEqual(calls[0].params, ['%makita%', 'search', null, 48, 0])
})

test('deleting nothing touches no database', async () => {
  const { calls, pool } = fakePool()

  assert.deepEqual(await deletePhotosByIds([], pool), { deleted: 0, promotedTools: [] })
  assert.deepEqual(calls, [])
})

test('a bulk delete promotes a new main photo for every tool that lost one', async () => {
  const { calls, pool } = fakePool([
    [], // BEGIN
    [
      { is_primary: true, storage_key: 'ab/one.jpg', tool_id: '9' },
      { is_primary: false, storage_key: 'cd/two.jpg', tool_id: '9' },
    ],
    [{ tool_id: '9' }], // the promotion
    [{ storage_key: 'cd/two.jpg' }], // still used by another card
  ])

  const result = await deletePhotosByIds([1, 2], pool)

  assert.deepEqual(result, { deleted: 2, promotedTools: [9] })
  // Only the tool that lost its primary is considered for promotion.
  assert.deepEqual(calls[2].params, [[9]])
})

test('a file is unlinked only when no row points at it any more', async () => {
  const { calls, pool } = fakePool([
    [],
    [{ is_primary: false, storage_key: 'ab/shared.jpg', tool_id: '9' }],
    [],
    // The checksum is still on another tool's card: the file stays.
    [{ storage_key: 'ab/shared.jpg' }],
  ])

  const result = await deletePhotosByIds([1], pool)

  assert.equal(result.deleted, 1)
  assert.deepEqual(result.promotedTools, [])
  assert.match(calls[1].text, /DELETE FROM "catalog"\."tool_photo" WHERE "id" = ANY/)
  // The transaction was committed, not rolled back.
  assert.ok(calls.some((call) => call.text.trim() === 'COMMIT'))
})

test('an unattached photo keeps its place in the library', async () => {
  const { pool } = fakePool([
    [
      {
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
        tool_id: null,
        tool_name: null,
        total_count: '1',
        width: 100,
      },
    ],
  ])

  const page = await listAllPhotos(
    { assigned: false, direction: 'desc', limit: 48, offset: 0, search: null, source: null },
    pool,
  )

  assert.equal(page.items[0].toolId, null)
  // Empty rather than null, so the screen has one thing to render.
  assert.equal(page.items[0].toolName, '')
  // Addressed by its own id: there is no tool to reach it through.
  assert.equal(page.items[0].url, '/api/photos/5/file')
})

test('the assigned filter is a parameter, not two different statements', async () => {
  const { calls, pool } = fakePool([])

  await listAllPhotos(
    { assigned: true, direction: 'desc', limit: 10, offset: 0, search: null, source: null },
    pool,
  )
  assert.equal(calls[0].params[2], true)
  assert.match(calls[0].text, /"p"\."tool_id" IS NOT NULL\) = \$3/)
})

test('the tool id is cast, because it may be null in every position', async () => {
  // A bare parameter that is null everywhere it appears has no type Postgres
  // can infer, and the insert fails with "could not determine data type of
  // parameter $1" — which is exactly what an unattached upload does.
  const { calls, pool } = fakePool([[]])

  await insertPhoto(
    {
      metadata: { contentType: 'image/png', height: 10, width: 10 },
      source: 'upload',
      stored: { byteSize: 10, checksum: 'abc', storageKey: 'ab/abc.png' },
      toolId: null,
    },
    1,
    pool,
  ).catch(() => undefined)

  assert.match(calls[0].text, /\$1::bigint/)
  assert.equal(calls[0].params[0], null)
})

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
    tool_id: null,
    width: 100,
    ...overrides,
  }
}

test('an unattached photo is moved, keeping its id', async () => {
  // "Przypisz" means it leaves the unassigned shelf, not that a second copy
  // appears there.
  const { calls, pool } = fakePool([[photoRow()], [photoRow({ is_primary: true, tool_id: '9' })]])

  const result = await attachPhotosToTool(9, [5], 1, pool)

  assert.equal(result.attached[0].id, 5)
  assert.equal(result.attached[0].toolId, 9)
  assert.match(calls[1].text, /UPDATE "catalog"\."tool_photo"/)
  assert.match(calls[1].text, /"tool_id" IS NULL/)
})

test('a photo that belongs to another tool is copied, sharing the file', async () => {
  const { calls, pool } = fakePool([
    [photoRow({ tool_id: '3' })],
    [photoRow({ id: '12', tool_id: '9' })],
  ])

  const result = await attachPhotosToTool(9, [5], 1, pool)

  assert.equal(result.attached[0].id, 12)
  assert.match(calls[1].text, /INSERT INTO "catalog"\."tool_photo"/)
  // The same storage key: one picture on two cards costs a row, not a file.
  assert.equal(calls[1].params[1], 'ab/abc.png')
})

test('a photo already on this tool is reported rather than duplicated', async () => {
  const { pool } = fakePool([[photoRow({ tool_id: '9' })]])

  const result = await attachPhotosToTool(9, [5], 1, pool)

  assert.deepEqual(result.attached, [])
  assert.match(result.failed[0].reason, /już jest na tej karcie/)
})

test('a photo that no longer exists fails on its own', async () => {
  // One bad id out of five must not lose the other four.
  const { pool } = fakePool([[], [photoRow()], [photoRow({ tool_id: '9' })]])

  const result = await attachPhotosToTool(9, [404, 5], 1, pool)

  assert.equal(result.failed.length, 1)
  assert.equal(result.failed[0].id, 404)
  assert.equal(result.attached.length, 1)
})
