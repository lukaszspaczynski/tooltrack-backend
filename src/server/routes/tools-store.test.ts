import assert from 'node:assert/strict'
import test from 'node:test'

import type { PgPool, PgQueryResult } from '../db'
import {
  createTool,
  duplicateTool,
  listTools,
  SerialNumberTakenError,
  updateTool,
} from './tools-store'
import { parseToolQuery } from './tools-input'

type Call = { params: unknown[]; text: string }

// A pool that records instead of connecting. The point of every test here is
// the statement that would have run, so the recording is the assertion.
function fakePool(rows: unknown[] = [], error?: unknown): { calls: Call[]; pool: PgPool } {
  const calls: Call[] = []
  const pool: PgPool = {
    query(text: string, params: unknown[] = []) {
      calls.push({ params, text })
      if (error) return Promise.reject(error)
      return Promise.resolve({ rowCount: rows.length, rows } as PgQueryResult<never>)
    },
  }
  return { calls, pool }
}

function toolRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    brand: 'Makita',
    category: 'Wiertarki',
    condition: 'good',
    created_at: '2026-01-01T00:00:00.000Z',
    created_by: '3',
    id: '7',
    model: 'HR2470',
    name: 'Młotowiertarka',
    notes: '',
    serial_number: '12345-AB',
    total_count: '1',
    updated_at: '2026-01-02T00:00:00.000Z',
    updated_by: '3',
    ...overrides,
  }
}

test('a listed row is mapped to camelCase with numeric ids', async () => {
  const { pool } = fakePool([toolRow()])

  const page = await listTools(query(''), pool)

  assert.equal(page.total, 1)
  assert.deepEqual(page.items[0], {
    brand: 'Makita',
    category: 'Wiertarki',
    condition: 'good',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 3,
    id: 7,
    model: 'HR2470',
    name: 'Młotowiertarka',
    notes: '',
    serialNumber: '12345-AB',
    updatedAt: '2026-01-02T00:00:00.000Z',
    updatedBy: 3,
  })
})

test('no rows means a total of zero, not an unknown total', async () => {
  const { pool } = fakePool([])

  const page = await listTools(query('q=nic'), pool)

  assert.equal(page.total, 0)
  assert.deepEqual(page.items, [])
})

test('a search becomes one escaped ILIKE pattern', async () => {
  const { calls, pool } = fakePool([])

  await listTools(query('q=50%25 rabat_x'), pool)

  // The wildcards someone typed are literal characters, not a query for
  // everything.
  assert.equal(calls[0].params[0], '%50\\% rabat\\_x%')
})

test('a filter that was not asked for is passed as null, not as SQL', async () => {
  const { calls, pool } = fakePool([])

  await listTools(query('category=Piły&condition=retired&limit=10&offset=20'), pool)

  // The organizer filter is null too: "do not filter" is not the same as
  // "tools that are in no organizer".
  assert.deepEqual(calls[0].params, [null, 'Piły', 'retired', 10, 20, null])
})

test('the sort key is chosen from a fixed map, never interpolated', async () => {
  const { calls, pool } = fakePool([])

  await listTools(query('sort=name&order=asc'), pool)
  assert.match(calls[0].text, /ORDER BY lower\("name"\) ASC/)

  // Anything unrecognised in the query string cannot reach the statement.
  await listTools(query('sort=name%22%3B%20DROP%20TABLE'), pool)
  assert.match(calls[1].text, /ORDER BY "updated_at" DESC/)
  assert.doesNotMatch(calls[1].text, /DROP/)
})

test('a patch touches only the fields it carries, plus the audit columns', async () => {
  const { calls, pool } = fakePool([toolRow({ condition: 'retired' })])

  await updateTool(7, { condition: 'retired', serialNumber: '' }, 3, pool)

  const [{ params, text }] = calls
  assert.match(
    text,
    /SET "condition" = \$3, "serial_number" = \$4, "updated_by" = \$2, "updated_at" = now\(\)/,
  )
  assert.doesNotMatch(text, /"name" =/)
  assert.deepEqual(params, [7, 3, 'retired', ''])
})

test('updating a row that is gone answers null rather than throwing', async () => {
  const { pool } = fakePool([])

  assert.equal(await updateTool(7, { name: 'Nowa' }, 3, pool), null)
})

test('a new card records its author as both creator and last editor', async () => {
  const { calls, pool } = fakePool([toolRow()])

  await createTool(
    {
      brand: 'Makita',
      category: 'Wiertarki',
      condition: 'good',
      model: 'HR2470',
      name: 'Młotowiertarka',
      notes: '',
      serialNumber: '12345-AB',
    },
    3,
    pool,
  )

  // The brand lookup runs first: the typed maker decides which row the card
  // points at, and an unknown one points at nothing.
  assert.match(calls[0].text, /FROM "catalog"\."brand"/)
  assert.match(calls[1].text, /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$8, \$9\)/)
  assert.equal(calls[1].params[7], 3)
})

test('a typed maker points the card at that brand, and an unknown one at none', async () => {
  // The tool form writes the maker as text. Matching it here is what keeps the
  // column and the row telling the same story without inventing a brand from a
  // typo.
  const { calls, pool } = fakePool([toolRow()])

  await createTool(
    {
      brand: 'Makita',
      category: '',
      condition: 'good',
      model: '',
      name: 'Wiertarka',
      notes: '',
      serialNumber: '',
    },
    3,
    pool,
  )

  assert.equal(calls[0].params[0], 'Makita')
  // The fake answers every query with the same row, which has no id — so this
  // asserts the shape of the call rather than the value it found.
  assert.match(calls[1].text, /"brand_id"/)
})

test('a duplicate serial number is a named error, not a raw pg failure', async () => {
  const { pool } = fakePool([], Object.assign(new Error('duplicate key'), { code: '23505' }))

  await assert.rejects(
    () =>
      createTool(
        {
          brand: '',
          category: '',
          condition: 'good',
          model: '',
          name: 'Druga karta',
          notes: '',
          serialNumber: '12345-AB',
        },
        3,
        pool,
      ),
    (error: unknown) => {
      assert.ok(error instanceof SerialNumberTakenError)
      assert.match((error as Error).message, /12345-AB/)
      return true
    },
  )
})

test('any other database error is passed through untouched', async () => {
  const original = Object.assign(new Error('connection terminated'), { code: '08006' })
  const { pool } = fakePool([], original)

  await assert.rejects(() => listTools(query(''), pool), original)
})

function query(search: string) {
  const parsed = parseToolQuery(new URLSearchParams(search))
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.value
}

test('duplicating copies the card but not the serial number', async () => {
  // A serial number is one physical machine. Copying it would mean two cards
  // claiming the same one — which the unique index refuses anyway, so the copy
  // would simply fail instead of starting blank.
  const { calls, pool } = fakePool([toolRow({ id: '12', serial_number: '' })])

  const copy = await duplicateTool(7, 3, pool)

  assert.equal(copy?.id, 12)
  assert.equal(copy?.serialNumber, '')
  // One statement, so the copy cannot drift from the original between a read
  // and a write.
  assert.match(calls[0].text, /INSERT INTO "catalog"\."tool"[\s\S]*SELECT/)
  assert.match(calls[0].text, /"model", '', "condition"/)
  assert.deepEqual(calls[0].params, [7, 3])
})

test('duplicating a card that is not there is not found, not a copy of nothing', async () => {
  const { pool } = fakePool([])

  assert.equal(await duplicateTool(404, 3, pool), null)
})
