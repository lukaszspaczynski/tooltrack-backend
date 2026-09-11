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
  capacityL: 19,
  diagonalMm: 497,
  ean: '5901238254249',
  innerHeightMm: 189,
  innerLengthMm: 331,
  innerWidthMm: 245,
  loadKg: 20,
  manufacturer: 'Qbrick',
  name: 'Qbrick System PRO Toolbox 2.0',
  notes: '',
  outerHeightMm: 240,
  outerLengthMm: 450,
  outerWidthMm: 331,
  sku: 'SKRQTBPRO2CZAPG001',
  system: 'PRO',
}

test('the insert builds its columns and its parameters together', async () => {
  // Built apart, one list grows and the other does not, and Postgres answers
  // "could not determine data type of parameter $13" on a Friday.
  const { calls, pool } = fakePool([[{ ...toRow(fields), id: '1' }]])

  await createCase(fields, 7, pool)

  const columns = calls[0].text.match(/\(([^)]*)\)\s*VALUES/)![1].split(',').length
  const placeholders = calls[0].text.match(/VALUES \(([^)]*)\)/)![1].split(',').length
  assert.equal(columns, placeholders)
  // The actor is $1 and appears twice, as created_by and updated_by.
  assert.equal(calls[0].params[0], 7)
  assert.match(calls[0].text, /\$1, \$1/)
})

test('a patch writes only what was sent, and null really clears', async () => {
  const { calls, pool } = fakePool([[{ ...toRow(fields), diagonal_mm: null, id: '1' }]])

  await updateCase(1, { diagonalMm: null, system: 'ONE' }, 7, pool)

  // The SET clause only: RETURNING names every column, which is a different
  // statement about what comes back.
  const assignments = calls[0].text.match(/SET (.*)\n/)![1]
  assert.match(assignments, /"diagonal_mm" = \$3/)
  assert.match(assignments, /"system" = \$4/)
  // Nothing else was touched: a PATCH that rewrote every column would undo a
  // change somebody else made between the load and the save.
  assert.doesNotMatch(assignments, /"capacity_l"/)
  assert.deepEqual(calls[0].params, [1, 7, null, 'ONE'])
})

test('sorting by capacity puts the unmeasured cases last', async () => {
  const { calls, pool } = fakePool([[]])

  await listCases(
    {
      direction: 'desc',
      limit: 10,
      manufacturer: null,
      offset: 0,
      search: null,
      sort: 'capacityL',
      system: null,
    },
    pool,
  )

  // NULLS LAST, or the cases nobody has measured would head the list of the
  // biggest ones.
  assert.match(calls[0].text, /ORDER BY "capacity_l" DESC NULLS LAST/)
})

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
      system: null,
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
      system: null,
    },
    pool,
  )

  assert.equal(calls[0].params[0], '%Toolbox\\_2%')
})

function toRow(input: typeof fields) {
  return {
    capacity_l: String(input.capacityL),
    created_at: '2026-01-01T00:00:00.000Z',
    created_by: '7',
    diagonal_mm: input.diagonalMm,
    ean: input.ean,
    id: '1',
    inner_height_mm: input.innerHeightMm,
    inner_length_mm: input.innerLengthMm,
    inner_width_mm: input.innerWidthMm,
    load_kg: String(input.loadKg),
    manufacturer: input.manufacturer,
    name: input.name,
    notes: input.notes,
    outer_height_mm: input.outerHeightMm,
    outer_length_mm: input.outerLengthMm,
    outer_width_mm: input.outerWidthMm,
    sku: input.sku,
    system: input.system,
    updated_at: '2026-01-01T00:00:00.000Z',
    updated_by: '7',
  }
}
