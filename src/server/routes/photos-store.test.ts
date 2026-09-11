import assert from 'node:assert/strict'
import test from 'node:test'

import type { PgClient, PgPool, PgQueryResult } from '../db'
import { deletePhotosByIds, listAllPhotos } from './photos-store'

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
    { direction: 'desc', limit: 48, offset: 0, search: 'makita', source: 'search' },
    pool,
  )

  assert.equal(page.items[0].toolName, 'Szlifierka kątowa')
  assert.equal(page.items[0].url, '/api/tools/9/photos/5/file')
  assert.match(calls[0].text, /JOIN "catalog"\."tool"/)
  // The search matches the tool, because a photo has no name of its own.
  assert.deepEqual(calls[0].params, ['%makita%', 'search', 48, 0])
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
