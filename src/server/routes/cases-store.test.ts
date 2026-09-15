import assert from 'node:assert/strict'
import test from 'node:test'

import type { PgPool, PgQueryResult } from '../db'
import { createCase, listCases, updateCase } from './cases-store'

type Call = { params: unknown[]; text: string }

function fakePool(results: unknown[][] = []): { calls: Call[]; pool: PgPool } {
  const calls: Call[] = []
  const queue = [...results]

  const pool = {
    query: (text: string, params: unknown[] = []) => {
      calls.push({ params, text })
      const rows = queue.shift() ?? []
      return Promise.resolve({ rowCount: rows.length, rows } as PgQueryResult<never>)
    },
  } as unknown as PgPool

  return { calls, pool }
}

const fields = {
  brandId: 9,
  name: 'Qbrick System PRO Toolbox 2.0',
  notes: '',
  referenceUrl: '',
  model: 'PRO',
}

test('the insert builds its columns and its parameters together', async () => {
  // Built apart, one list grows and the other does not, and Postgres answers
  // "could not determine data type of parameter $13" on a Friday.
  // Two statements now: the insert answers with an id and the box is read back
  // through the join, because RETURNING cannot reach a maker that lives in
  // another table.
  const { calls, pool } = fakePool([[{ id: '1' }], [toRow(fields)]])

  await createCase(fields, 7, pool)

  const columns = calls[0].text.match(/\(([^)]*)\)\s*VALUES/)![1].split(',').length
  const placeholders = calls[0].text.match(/VALUES \(([^)]*)\)/)![1].split(',').length
  assert.equal(columns, placeholders)
  // The actor is $1 and appears twice, as created_by and updated_by.
  assert.equal(calls[0].params[0], 7)
  assert.match(calls[0].text, /\$1, \$1/)
})

test('a patch writes only what was sent', async () => {
  const { calls, pool } = fakePool([[toRow(fields)]])

  await updateCase(1, { model: 'ONE' }, 7, pool)

  const assignments = calls[0].text.match(/SET (.*)\n/)![1]
  assert.match(assignments, /"model" = \$3/)
  // Nothing else was touched: a PATCH that rewrote every column would undo a
  // change somebody else made between the load and the save.
  assert.doesNotMatch(assignments, /"name"/)
  assert.deepEqual(calls[0].params, [1, 7, 'ONE'])
})

test('the maker is a row the box points at, and can be cleared', async () => {
  const { calls, pool } = fakePool([[toRow(fields)]])

  await updateCase(1, { brandId: null }, 7, pool)

  assert.match(calls[0].text, /"brand_id" = \$3/)
  assert.equal(calls[0].params[2], null)
})

test('the address a case was read from is a column, not a parameter', async () => {
  // It was a Referencja row on the sheet. A card has exactly one and never
  // two, which is the shape of a field — and on the sheet it sorted among the
  // measurements, where renaming it broke the button that reads it.
  const { calls, pool } = fakePool([[{ ...toRow(fields), id: '1' }]])

  await updateCase(1, { referenceUrl: 'https://qbricksystem.com/product/x/' }, 7, pool)

  assert.match(calls[0].text, /"reference_url" = \$3/)
  assert.equal(calls[0].params[2], 'https://qbricksystem.com/product/x/')
})

test('the shelf is read alphabetically, and the maker comes off a join', async () => {
  // Capacity was a sort option while it was a column. It is a parameter now —
  // free text with its unit in it — and sorting by that would mean a regular
  // expression and a cast in the ORDER BY for a question about six boxes.
  const { calls, pool } = fakePool([[]])

  await listCases(query('name'), pool)

  assert.match(calls[0].text, /ORDER BY lower\("c"\."name"\)/)
  assert.match(calls[0].text, /LEFT JOIN "catalog"\."brand" AS "b" ON "b"\."id" = "c"\."brand_id"/)
})

test('a barcode still finds its box, now that it lives on the sheet', async () => {
  // The EAN and the catalogue number were columns and were searchable. They
  // are parameters now, and they are exactly what somebody types with the box
  // in their hands — so the sheet is searched too.
  const { calls, pool } = fakePool([[]])

  await listCases({ ...query('name'), search: '5901238254232' }, pool)

  assert.match(calls[0].text, /EXISTS \(\s*SELECT 1 FROM "catalog"\."attribute"/)
  assert.equal(calls[0].params[0], '%5901238254232%')
})

function query(sort: 'createdAt' | 'name' | 'updatedAt') {
  return {
    direction: 'desc' as const,
    limit: 10,
    manufacturer: null,
    offset: 0,
    search: null,
    sort,
    model: null,
  }
}

test('a sort key that is not ours cannot reach the query', async () => {
  const { calls, pool } = fakePool([[]])

  await listCases(
    {
      direction: 'asc',
      limit: 10,
      manufacturer: null,
      offset: 0,
      search: null,
      // The parser cannot produce this; the map is what makes it harmless.
      sort: 'name; DROP TABLE "catalog"."tool_case"' as 'name',
      model: null,
    },
    pool,
  )

  assert.doesNotMatch(calls[0].text, /DROP TABLE/)
  assert.match(calls[0].text, /ORDER BY undefined|ORDER BY lower\("name"\)/)
})

test('underscores in a search are searched for, not treated as wildcards', async () => {
  const { calls, pool } = fakePool([[]])

  await listCases(
    {
      direction: 'desc',
      limit: 10,
      manufacturer: null,
      offset: 0,
      search: 'Toolbox_2',
      sort: 'name',
      model: null,
    },
    pool,
  )

  assert.equal(calls[0].params[0], '%Toolbox\\_2%')
})

function toRow(input: typeof fields) {
  return {
    brand_color: '#122447',
    brand_id: String(input.brandId),
    brand_name: 'Qbrick',
    created_at: '2026-01-01T00:00:00.000Z',
    created_by: '7',
    id: '1',
    name: input.name,
    notes: input.notes,
    reference_url: input.referenceUrl,
    model: input.model,
    updated_at: '2026-01-01T00:00:00.000Z',
    updated_by: '7',
  }
}
