import assert from 'node:assert/strict'
import test from 'node:test'

import type { PgPool, PgQueryResult } from '../db'
import {
  createItem,
  duplicateItem,
  listItems,
  SerialNumberTakenError,
  updateItem,
} from './items-store'
import {
  addAttribute,
  AttributeNameTakenError,
  deleteAttribute,
  listAttributes,
  updateAttribute,
} from './attributes-store'
import { parseItemQuery } from './items-input'

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

function itemRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    address_id: null,
    brand_color: '#00a3a1',
    brand_id: '9',
    brand_name: 'Makita',
    category: 'Wiertarki',
    condition: 'good',
    kind: 'tool',
    created_at: '2026-01-01T00:00:00.000Z',
    created_by: '3',
    id: '7',
    model: 'HR2470',
    name: 'Młotowiertarka',
    notes: '',
    reference_url: '',
    serial_number: '12345-AB',
    total_count: '1',
    updated_at: '2026-01-02T00:00:00.000Z',
    updated_by: '3',
    ...overrides,
  }
}

test('a listed row is mapped to camelCase with numeric ids', async () => {
  const { pool } = fakePool([itemRow()])

  const page = await listItems(query(''), pool)

  assert.equal(page.total, 1)
  assert.deepEqual(page.items[0], {
    addressId: null,
    brand: { color: '#00a3a1', id: 9, name: 'Makita' },
    category: 'Wiertarki',
    condition: 'good',
    kind: 'tool',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 3,
    id: 7,
    model: 'HR2470',
    name: 'Młotowiertarka',
    notes: '',
    referenceUrl: '',
    serialNumber: '12345-AB',
    updatedAt: '2026-01-02T00:00:00.000Z',
    updatedBy: 3,
  })
})

test('no rows means a total of zero, not an unknown total', async () => {
  const { pool } = fakePool([])

  const page = await listItems(query('q=nic'), pool)

  assert.equal(page.total, 0)
  assert.deepEqual(page.items, [])
})

test('a search becomes one escaped ILIKE pattern', async () => {
  const { calls, pool } = fakePool([])

  await listItems(query('q=50%25 rabat_x'), pool)

  // The wildcards someone typed are literal characters, not a query for
  // everything.
  assert.equal(calls[0].params[0], '%50\\% rabat\\_x%')
})

test('a filter that was not asked for is passed as null, not as SQL', async () => {
  const { calls, pool } = fakePool([])

  await listItems(query('category=Piły&condition=retired&limit=10&offset=20'), pool)

  // The organizer filter is null too: "do not filter" is not the same as
  // "items that are in no organizer".
  assert.deepEqual(calls[0].params, [null, 'Piły', 'retired', 10, 20, null, null, null, null, null])
})

test('the sort key is chosen from a fixed map, never interpolated', async () => {
  const { calls, pool } = fakePool([])

  await listItems(query('sort=name&order=asc'), pool)
  assert.match(calls[0].text, /ORDER BY lower\("i"\."name"\) ASC/)

  // Anything unrecognised in the query string cannot reach the statement.
  await listItems(query('sort=name%22%3B%20DROP%20TABLE'), pool)
  assert.match(calls[1].text, /ORDER BY "i"\."updated_at" DESC/)
  assert.doesNotMatch(calls[1].text, /DROP/)
})

test('a patch touches only the fields it carries, plus the audit columns', async () => {
  const { calls, pool } = fakePool([itemRow({ condition: 'retired' })])

  await updateItem(7, { condition: 'retired', serialNumber: '' }, 3, pool)

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

  assert.equal(await updateItem(7, { name: 'Nowa' }, 3, pool), null)
})

test('a new card records its author as both creator and last editor', async () => {
  const { calls, pool } = fakePool([itemRow()])

  await createItem(
    {
      addressId: null,
      brandId: null,
      category: 'Wiertarki',
      condition: 'good',
      kind: 'tool',
      model: 'HR2470',
      name: 'Młotowiertarka',
      notes: '',
      referenceUrl: '',
      serialNumber: '12345-AB',
    },
    3,
    pool,
  )

  // One statement, and then the card is read back through the same join every
  // other read uses: RETURNING cannot reach a maker that lives in another
  // table, and two definitions of what a card looks like agree until somebody
  // edits one of them.
  //
  // The columns and the placeholders are counted rather than matched. Built
  // apart, one list grows and the other does not, and Postgres answers "INSERT
  // has more target columns than expressions" on a Friday — a recording fake
  // will not notice, which is exactly how that slipped through here once.
  const written = calls[0].text.match(/INSERT INTO [\s\S]*?\(([\s\S]*?)\)\s*VALUES/)![1]
  const values = calls[0].text.match(/VALUES \(([^)]*)\)/)![1]

  assert.equal(written.split(',').length, values.split(',').length)
  // One value written into two columns: the author is both creator and last
  // editor, so there is one distinct placeholder fewer than there are columns.
  assert.equal(new Set(values.split(',').map((one) => one.trim())).size, 11)
  assert.equal(calls[0].params[9], 3)
  assert.match(calls[1].text, /LEFT JOIN "catalog"\."brand"/)
})

test('the maker comes off a join, so a card can have none', async () => {
  // It used to be a string on the card and a pointer beside it, kept in step by
  // three separate mechanisms. One pointer and a LEFT JOIN — left, because a
  // card with no maker is normal and an inner join would drop it out of the
  // catalog.
  const { calls, pool } = fakePool([itemRow()])

  await listItems(query(''), pool)

  assert.match(calls[0].text, /LEFT JOIN "catalog"\."brand" AS "b" ON "b"\."id" = "i"\."brand_id"/)
  // Searching for a maker still works, and now it reaches the row rather than
  // a copy of its name.
  assert.match(calls[0].text, /"b"\."name" ILIKE \$1/)
})

test('a card with no maker reads as null, not as an empty name', async () => {
  const { pool } = fakePool([{ ...itemRow(), brand_color: null, brand_id: null, brand_name: null }])

  const page = await listItems(query(''), pool)

  assert.equal(page.items[0].brand, null)
})

test('a duplicate serial number is a named error, not a raw pg failure', async () => {
  const { pool } = fakePool([], Object.assign(new Error('duplicate key'), { code: '23505' }))

  await assert.rejects(
    () =>
      createItem(
        {
          addressId: null,
          brandId: null,
          category: '',
          condition: 'good',
          kind: 'tool',
          model: '',
          name: 'Druga karta',
          notes: '',
          referenceUrl: '',
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

  await assert.rejects(() => listItems(query(''), pool), original)
})

function query(search: string) {
  const parsed = parseItemQuery(new URLSearchParams(search))
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.value
}

test('duplicating copies the card but not the serial number', async () => {
  // A serial number is one physical machine. Copying it would mean two cards
  // claiming the same one — which the unique index refuses anyway, so the copy
  // would simply fail instead of starting blank.
  const { calls, pool } = fakePool([itemRow({ id: '12', serial_number: '' })])

  const copy = await duplicateItem(7, 3, pool)

  assert.equal(copy?.id, 12)
  assert.equal(copy?.serialNumber, '')
  // One statement, so the copy cannot drift from the original between a read
  // and a write.
  assert.match(calls[0].text, /INSERT INTO "catalog"\."item"[\s\S]*SELECT/)
  assert.match(calls[0].text, /"model", '', "condition"/)
  assert.deepEqual(calls[0].params, [7, 3])
})

test('duplicating a card that is not there is not found, not a copy of nothing', async () => {
  const { pool } = fakePool([])

  assert.equal(await duplicateItem(404, 3, pool), null)
})

function attributeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: '5', name: 'Napięcie sieciowe', value: '230 V', ...overrides }
}

test('the parameters of an item come back in the order they were typed', async () => {
  // A spec sheet is copied from the top down. Sorting by name would shuffle it
  // into an order nobody wrote and nobody reads.
  const { calls, pool } = fakePool([attributeRow(), attributeRow({ id: '6', name: 'Moc' })])

  const attributes = await listAttributes('item', 7, pool)

  assert.deepEqual(attributes, [
    { id: 5, name: 'Napięcie sieciowe', value: '230 V' },
    { id: 6, name: 'Moc', value: '230 V' },
  ])
  assert.match(calls[0].text, /ORDER BY "id" ASC/)
  assert.deepEqual(calls[0].params, ['item', 7])
})

test('the same parameter twice on one card is a named error', async () => {
  // The second "napięcie" is somebody correcting the first, not a second fact
  // about the machine — a 409 the screen can point at a row with.
  const { pool } = fakePool([], Object.assign(new Error('duplicate key'), { code: '23505' }))

  await assert.rejects(
    () => addAttribute('item', 7, { name: 'Napięcie', value: '230 V' }, 3, pool),
    AttributeNameTakenError,
  )
})

test('editing a parameter only touches this card’s row', async () => {
  // The id in the path came from somewhere, but not necessarily from this
  // card. Scoping the UPDATE by item as well is what keeps a stale link from
  // editing somebody else's parameter.
  const { calls, pool } = fakePool([attributeRow({ value: '400 V' })])

  const updated = await updateAttribute('item', 7, 5, { value: '400 V' }, pool)

  assert.equal(updated?.value, '400 V')
  assert.match(calls[0].text, /WHERE "reference" = \$1 AND "reference_id" = \$2 AND "id" = \$3/)
  assert.deepEqual(calls[0].params, ['item', 7, 5, '400 V'])
})

test('a parameter that is not this card’s reads as not found', async () => {
  const { pool } = fakePool([])

  assert.equal(await updateAttribute('item', 7, 404, { value: '400 V' }, pool), null)
  assert.equal(await deleteAttribute('item', 7, 404, pool), false)
})

test('an empty patch reads the row rather than writing an empty UPDATE', async () => {
  const { calls, pool } = fakePool([attributeRow()])

  await updateAttribute('item', 7, 5, {}, pool)

  assert.match(calls[0].text, /^\s*SELECT/)
})

test('a duplicated card carries the spec sheet with it', async () => {
  // The parameters describe the model rather than this particular machine: a
  // second identical grinder is still 230 V, and retyping them is the reason
  // somebody presses Duplicate in the first place.
  const { calls, pool } = fakePool([itemRow({ id: '12', serial_number: '' })])

  const copy = await duplicateItem(7, 3, pool)

  assert.equal(copy?.id, 12)
  const insert = calls.find((call) => call.text.includes('"catalog"."attribute"'))
  assert.ok(insert, 'the parameters are copied')
  assert.match(insert.text, /INSERT INTO "catalog"\."attribute"[\s\S]*SELECT 'item'/)
  assert.deepEqual(insert.params, [7, 12, 3])
})
