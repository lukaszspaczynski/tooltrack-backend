import assert from 'node:assert/strict'
import test from 'node:test'

import type { PgClient, PgPool, PgQueryResult } from '../db'
import {
  BrandNameTakenError,
  brandIdForName,
  createBrand,
  listBrands,
  LogoTakenError,
  PhotoNotFoundError,
  setLogo,
  updateBrand,
} from './brands-store'

type Call = { params: unknown[]; text: string }

function brandRow(overrides: Record<string, unknown> = {}) {
  return {
    created_at: '2026-01-01T00:00:00.000Z',
    created_by: '1',
    id: '1',
    logo_photo_id: null,
    name: 'Bosch',
    notes: '',
    tool_count: '4',
    updated_at: '2026-01-02T00:00:00.000Z',
    updated_by: '1',
    ...overrides,
  }
}

function fakePool(
  results: unknown[][] = [],
  error?: { code: string; on: RegExp },
): { calls: Call[]; pool: PgPool } {
  const calls: Call[] = []
  const queue = [...results]

  const answer = (text: string, params: unknown[] = []) => {
    calls.push({ params, text })
    if (error && error.on.test(text)) {
      return Promise.reject(Object.assign(new Error('pg'), { code: error.code }))
    }
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

const query = {
  direction: 'asc' as const,
  limit: 100,
  offset: 0,
  search: null,
  sort: 'name' as const,
}

test('the list carries the logo and how many tools name the maker', async () => {
  // Both as aggregates in the one statement: a screen of makers would
  // otherwise ask per row, twice.
  const { calls, pool } = fakePool([[]])

  await listBrands(query, pool)

  assert.match(calls[0].text, /FROM "catalog"\."photo_brand"/)
  assert.match(calls[0].text, /FROM "catalog"\."tool" WHERE "brand_id"/)
  assert.equal(calls.length, 1)
})

test('two makers cannot share a name, whatever the capitals', async () => {
  // "Bosch" and "BOSCH" typed on two days are the same company, and two rows
  // would split its tools in half.
  const { pool } = fakePool([], { code: '23505', on: /INSERT INTO "catalog"\."brand"/ })

  await assert.rejects(
    () => createBrand({ name: 'Bosch', notes: '' }, 1, pool),
    (error) => error instanceof BrandNameTakenError,
  )
})

test('renaming a maker renames it on its tools as well', async () => {
  // The card carries the name as text, which is what the catalog searches.
  // Renaming one without the other leaves them telling different stories.
  const { calls, pool } = fakePool([
    [],
    [{ id: '1' }],
    [],
    [brandRow({ name: 'Bosch Professional' })],
  ])

  await updateBrand(1, { name: 'Bosch Professional' }, 7, pool)

  const update = calls.find((call) => /UPDATE "catalog"\."tool" SET "brand"/.test(call.text))
  assert.ok(update, 'the tools should be renamed too')
  assert.deepEqual(update!.params, [1, 'Bosch Professional'])
})

test('a rename that touches no tools still only runs inside the transaction', async () => {
  const { calls, pool } = fakePool([[], [{ id: '1' }], [], [brandRow()]])

  await updateBrand(1, { notes: 'tylko notatka' }, 7, pool)

  // No name in the patch, so nothing on the tools is touched.
  assert.equal(calls.filter((call) => /UPDATE "catalog"\."tool"/.test(call.text)).length, 0)
})

test('a logo that already belongs to another brand is refused, not moved', async () => {
  const { pool } = fakePool([[{ id: '1' }]], {
    code: '23505',
    on: /INSERT INTO "catalog"\."photo_brand"/,
  })

  await assert.rejects(
    () => setLogo(1, 5, 7, pool),
    (error) => error instanceof LogoTakenError,
  )
})

test('a logo pointing at no picture is a 404 about the picture', async () => {
  const { pool } = fakePool([[{ id: '1' }]], {
    code: '23503',
    on: /INSERT INTO "catalog"\."photo_brand"/,
  })

  await assert.rejects(
    () => setLogo(1, 404, 7, pool),
    (error) => error instanceof PhotoNotFoundError,
  )
})

test('setting a logo twice replaces it rather than failing', async () => {
  const { calls, pool } = fakePool([[{ id: '1' }], [], [brandRow()]])

  await setLogo(1, 9, 7, pool)

  assert.match(calls[1].text, /ON CONFLICT \("brand_id"\) DO UPDATE/)
})

test('a typed maker is matched case-insensitively, and blank matches nothing', async () => {
  const { calls, pool } = fakePool([[{ id: '3' }]])

  assert.equal(await brandIdForName('  bosch professional ', pool), 3)
  assert.equal(calls[0].params[0], 'bosch professional')

  // No query at all for an empty name: there is nothing to look up.
  assert.equal(await brandIdForName('   ', pool), null)
  assert.equal(calls.length, 1)
})
