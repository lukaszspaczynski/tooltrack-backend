import assert from 'node:assert/strict'
import test from 'node:test'

import type { PgClient, PgPool, PgQueryResult } from '../db'
import { listOrganizers, removeTool, ToolAlreadyInOrganizerError } from './organizers-store'
import { addTools } from './organizers-store'

type Call = { params: unknown[]; text: string }

function fakePool(results: unknown[][] = [], error?: unknown): { calls: Call[]; pool: PgPool } {
  const calls: Call[] = []
  const queue = [...results]

  const answer = (text: string, params: unknown[] = []) => {
    calls.push({ params, text })
    if (error && /INSERT INTO "catalog"\."organizer_tool"/.test(text)) return Promise.reject(error)
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

test('the tile is one query: the case, its photo, and every tool with its own', async () => {
  // A screen of twenty organizers would otherwise be forty-one requests.
  const { calls, pool } = fakePool([[]])

  await listOrganizers(query, pool)

  assert.match(calls[0].text, /JOIN "catalog"\."tool_case"/)
  assert.match(calls[0].text, /FROM "catalog"\."photo_case"/)
  assert.match(calls[0].text, /FROM "catalog"\."organizer_tool"/)
  assert.match(calls[0].text, /FROM "catalog"\."photo_tool"/)
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

test('a tool already in another organizer is a conflict, not a silent move', async () => {
  // Moving a tool out of somebody else's arrangement is a decision, so the
  // unique index refusing it is reported rather than worked around.
  const { pool } = fakePool([[{}], []], { code: '23505' })

  await assert.rejects(
    () => addTools(1, [5], 7, pool),
    (error) => error instanceof ToolAlreadyInOrganizerError,
  )
})

test('adding tools to an organizer that is not there is not found', async () => {
  const { pool } = fakePool([[]])

  assert.equal(await addTools(404, [5], 7, pool), null)
})

test('taking a tool out touches the link and nothing else', async () => {
  const { calls, pool } = fakePool([[{}]])

  assert.equal(await removeTool(1, 5, pool), true)
  assert.match(calls[0].text, /DELETE FROM "catalog"\."organizer_tool"/)
  // The tool card is not touched. That is the whole point of the link table.
  assert.doesNotMatch(calls[0].text, /"catalog"\."tool"\b/)
})

test('the search matches the organizer and the case it is in', async () => {
  const { calls, pool } = fakePool([[]])

  await listOrganizers({ ...query, search: 'wiertarki' }, pool)

  assert.equal(calls[0].params[0], '%wiertarki%')
  assert.match(calls[0].text, /"c"\."name" ILIKE \$1/)
})
