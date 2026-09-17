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
    color: '#122447',
    created_at: '2026-01-01T00:00:00.000Z',
    created_by: '1',
    id: '1',
    logo_photo_id: null,
    name: 'Bosch',
    notes: '',
    item_count: '4',
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

test('the list carries the logo and how many items name the maker', async () => {
  // Both as aggregates in the one statement: a screen of makers would
  // otherwise ask per row, twice.
  const { calls, pool } = fakePool([[]])

  await listBrands(query, pool)

  assert.match(calls[0].text, /FROM "catalog"\."photo_brand"/)
  assert.match(calls[0].text, /FROM "catalog"\."item" WHERE "brand_id"/)
  assert.equal(calls.length, 1)
})

test('two makers cannot share a name, whatever the capitals', async () => {
  // "Bosch" and "BOSCH" typed on two days are the same company, and two rows
  // would split its items in half.
  const { pool } = fakePool([], { code: '23505', on: /INSERT INTO "catalog"\."brand"/ })

  await assert.rejects(
    () => createBrand({ color: '', name: 'Bosch', notes: '' }, 1, pool),
    (error) => error instanceof BrandNameTakenError,
  )
})

test('renaming a maker writes one statement and touches no card', () => {
  // It used to rewrite the maker's name on every item that pointed here,
  // because a card carried it as text beside the pointer. The text is gone —
  // that is what collapsing the maker to `brand_id` was for — and this asserts
  // it stays gone: the statement was still being sent after the column had
  // been dropped, and every save of a brand answered 500. A fake pool cannot
  // notice a column that is not there.
  const { calls, pool } = fakePool([[{ id: '1' }], [brandRow({ name: 'Bosch Professional' })]])

  return updateBrand(1, { name: 'Bosch Professional' }, 7, pool).then(() => {
    assert.equal(calls.filter((call) => /UPDATE "catalog"\."item"/.test(call.text)).length, 0)
    assert.match(calls[0].text, /UPDATE "catalog"\."brand"/)
    assert.equal(calls.filter((call) => /BEGIN/.test(call.text)).length, 0)
  })
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
