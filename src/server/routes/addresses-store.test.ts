import assert from 'node:assert/strict'
import test from 'node:test'

import type { PgPool, PgQueryResult } from '../db'
import {
  AddressNameTakenError,
  createAddress,
  deleteAddress,
  listAddresses,
  updateAddress,
} from './addresses-store'
import { parseAddressCreate, parseAddressPatch, parseAddressQuery } from './addresses-input'

type Call = { params: unknown[]; text: string }

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

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    building: '12A',
    city: 'Warszawa',
    color: '#d0392a',
    created_at: '2026-01-01T00:00:00.000Z',
    created_by: '3',
    id: '4',
    name: 'Magazyn',
    notes: '',
    organizer_count: '2',
    postal_code: '02-566',
    street: 'Puławska',
    item_count: '7',
    unit: '3',
    updated_at: '2026-01-02T00:00:00.000Z',
    updated_by: '3',
  }
}

test('a place comes back with what is kept there counted', async () => {
  const { pool } = fakePool([{ ...row(), total_count: '1' }])

  const page = await listAddresses(parsed(''), pool)

  assert.equal(page.total, 1)
  assert.equal(page.items[0].itemCount, 7)
  assert.equal(page.items[0].organizerCount, 2)
  // snake_case to camelCase, like every other store here.
  assert.equal(page.items[0].postalCode, '02-566')
})

test('an empty page is a total of zero, not an unknown total', async () => {
  const { pool } = fakePool([])

  assert.equal((await listAddresses(parsed('q=nigdzie'), pool)).total, 0)
})

test('the counts are subqueries, not joins', async () => {
  // Two joins against one row multiply each other: three items and two
  // arrangements would read as six of each. The fix is either DISTINCT on
  // every column or this.
  const { calls, pool } = fakePool([])

  await listAddresses(parsed(''), pool)

  assert.match(calls[0].text, /\(SELECT count\(\*\) FROM "catalog"\."item"/)
  assert.match(calls[0].text, /\(SELECT count\(\*\) FROM "catalog"\."organizer"/)
  assert.doesNotMatch(calls[0].text, /JOIN/)
})

test('a sort key that is not ours cannot reach the query', async () => {
  const { calls, pool } = fakePool([])

  await listAddresses(parsed('sort=name%22%3B%20DROP%20TABLE'), pool)

  assert.doesNotMatch(calls[0].text, /DROP/)
  assert.match(calls[0].text, /ORDER BY lower\("a"\."name"\)/)
})

test('underscores in a search are searched for, not treated as wildcards', async () => {
  const { calls, pool } = fakePool([])

  await listAddresses(parsed('q=12_A'), pool)

  assert.equal(calls[0].params[0], '%12\\_A%')
})

test('two places cannot share a name', async () => {
  // Folded and trimmed by the index, so "Magazyn" and "magazyn " are one place.
  // A 409 the screen can point at a field with, rather than a 500.
  const { pool } = fakePool([], Object.assign(new Error('duplicate key'), { code: '23505' }))

  await assert.rejects(
    () => createAddress(fields(), 3, pool),
    (error: unknown) => {
      assert.ok(error instanceof AddressNameTakenError)
      assert.match((error as Error).message, /Magazyn/)
      return true
    },
  )
})

test('a patch writes only what it carries', async () => {
  const { calls, pool } = fakePool([row()])

  await updateAddress(4, { city: 'Kraków' }, 3, pool)

  const assignments = calls[0].text.match(/SET (.*)\n/)![1]
  assert.match(assignments, /"city" = \$3/)
  assert.doesNotMatch(assignments, /"street"/)
  assert.deepEqual(calls[0].params, [4, 3, 'Kraków'])
  // Read back afterwards, because the counts are subqueries an UPDATE cannot
  // produce without repeating both.
  assert.match(calls[1].text, /^\s*\n?\s*SELECT/)
})

test('deleting a place is a plain delete, and the kit is not part of it', async () => {
  // The foreign key sets address_id to null on whatever was here. Closing a
  // site must not take the items out of the catalog.
  const { calls, pool } = fakePool([{}])

  assert.equal(await deleteAddress(4, pool), true)
  assert.match(calls[0].text, /^DELETE FROM "catalog"\."address" WHERE "id" = \$1$/)
})

test('only the name is required, and the rest is blank rather than absent', () => {
  // A yard on a site has a name and no street. Refusing to record it until
  // somebody invents one means it is not recorded at all.
  assert.equal(parseAddressCreate({ city: 'Warszawa' }).ok, false)

  const parsedFields = parseAddressCreate({ name: '  Magazyn  ' })

  assert.ok(parsedFields.ok)
  assert.equal(parsedFields.value.name, 'Magazyn')
  assert.equal(parsedFields.value.street, '')
  assert.equal(parsedFields.value.city, '')
})

test('a colour is stored one way however it was typed', () => {
  // The same rule the makers use, and in the same module, so "is this the same
  // colour" cannot have two answers. A place picked from a swatch sends hex; a
  // place copied off a brand book sends three numbers.
  for (const [typed, stored] of [
    ['#D0392A', '#d0392a'],
    ['d0392a', '#d0392a'],
    ['208 57 42', '#d0392a'],
    ['rgb(208, 57, 42)', '#d0392a'],
  ]) {
    const created = parseAddressCreate({ color: typed, name: 'Magazyn' })
    assert.ok(created.ok, typed)
    assert.equal(created.value.color, stored)
  }

  // Empty is a place nobody has coloured, and is allowed. Nonsense is a 400.
  const uncoloured = parseAddressCreate({ color: '', name: 'Magazyn' })
  assert.ok(uncoloured.ok)
  assert.equal(uncoloured.value.color, '')
  assert.equal(parseAddressCreate({ color: 'czerwony', name: 'Magazyn' }).ok, false)
  assert.equal(parseAddressCreate({ color: '300 0 0', name: 'Magazyn' }).ok, false)
})

test('a patch with nothing in it is refused rather than answered', () => {
  // Answering 200 with the row unchanged looks to the screen like it saved.
  assert.equal(parseAddressPatch({}).ok, false)
  assert.equal(parseAddressPatch({ name: '   ' }).ok, false)
  assert.ok(parseAddressPatch({ notes: '' }).ok)
})

test('the list query clamps rather than refuses, because links get pasted', () => {
  const query = parseAddressQuery(new URLSearchParams('limit=banana&offset=-5&sort=nonsense'))

  assert.ok(query.ok)
  assert.equal(query.value.limit, 100)
  assert.equal(query.value.offset, 0)
  // Name, because a short list of places is read the way a shelf is.
  assert.equal(query.value.sort, 'name')
  assert.equal(query.value.direction, 'asc')
})

function parsed(search: string) {
  const query = parseAddressQuery(new URLSearchParams(search))
  if (!query.ok) throw new Error(query.error)
  return query.value
}

function fields() {
  return {
    building: '',
    city: '',
    color: '',
    name: 'Magazyn',
    notes: '',
    postalCode: '',
    street: '',
    unit: '',
  }
}
