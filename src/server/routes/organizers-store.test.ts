import assert from 'node:assert/strict'
import test from 'node:test'

import type { PgClient, PgPool, PgQueryResult } from '../db'
import { listOrganizers, removeItem, ItemAlreadyInOrganizerError } from './organizers-store'
import { addItems } from './organizers-store'

type Call = { params: unknown[]; text: string }

function fakePool(results: unknown[][] = [], error?: unknown): { calls: Call[]; pool: PgPool } {
  const calls: Call[] = []
  const queue = [...results]

  const answer = (text: string, params: unknown[] = []) => {
    calls.push({ params, text })
    if (error && /INSERT INTO "catalog"\."organizer_item"/.test(text)) return Promise.reject(error)
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
  caseId: null,
  direction: 'asc' as const,
  limit: 50,
  offset: 0,
  search: null,
  sort: 'number' as const,
}

test('the tile is one query: the case, its photo, and every item with its own', async () => {
  // A screen of twenty organizers would otherwise be forty-one requests.
  const { calls, pool } = fakePool([[]])

  await listOrganizers(query, pool)

  assert.match(calls[0].text, /JOIN "catalog"\."item"/)
  assert.match(calls[0].text, /FROM "catalog"\."photo_item"/)
  assert.match(calls[0].text, /FROM "catalog"\."organizer_item"/)
  assert.match(calls[0].text, /FROM "catalog"\."photo_item"/)
  assert.equal(calls.length, 1)
})

test('the count sits between the columns and the FROM, not after it', async () => {
  // Appending it after the FROM is invalid SQL, and it answered 500 for every
  // request until the two halves were split apart.
  const { calls, pool } = fakePool([[]])

  await listOrganizers(query, pool)

  const columns = calls[0].text.indexOf('count(*) OVER ()')
  const from = calls[0].text.indexOf('FROM "catalog"."organizer"')
  assert.ok(columns > 0 && from > columns, 'count(*) OVER () must come before FROM')
})

test('an item already in another organizer is a conflict, not a silent move', async () => {
  // Moving an item out of somebody else's arrangement is a decision, so the
  // unique index refusing it is reported rather than worked around.
  const { pool } = fakePool([[{}], []], { code: '23505' })

  await assert.rejects(
    () => addItems(1, [5], 7, pool),
    (error) => error instanceof ItemAlreadyInOrganizerError,
  )
})

test('adding items to an organizer that is not there is not found', async () => {
  const { pool } = fakePool([[]])

  assert.equal(await addItems(404, [5], 7, pool), null)
})

test('taking an item out touches the link and nothing else', async () => {
  const { calls, pool } = fakePool([[{}]])

  assert.equal(await removeItem(1, 5, pool), true)
  assert.match(calls[0].text, /DELETE FROM "catalog"\."organizer_item"/)
  // The item card is not touched. That is the whole point of the link table.
  assert.doesNotMatch(calls[0].text, /"catalog"\."item"\b/)
})

test('the search matches the organizer and the case it is in', async () => {
  const { calls, pool } = fakePool([[]])

  await listOrganizers({ ...query, search: 'wiertarki' }, pool)

  assert.equal(calls[0].params[0], '%wiertarki%')
  assert.match(calls[0].text, /"c"\."name" ILIKE \$1/)
})
