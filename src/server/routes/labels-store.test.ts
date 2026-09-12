import assert from 'node:assert/strict'
import test from 'node:test'

import type { PgPool, PgQueryResult } from '../db'
import { labelFileUrl, labelPreviewUrl, labelsToRedraw } from './labels-store'

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

test('a label with no preview says so rather than pointing at nothing', async () => {
  // An older row, or one the rasteriser could not read. The tile has to cope.
  assert.equal(labelPreviewUrl(4, 9, ''), null)
  assert.equal(labelFileUrl(4, 9, ''), '/api/organizers/4/labels/9/file')
})

test('a redraw takes the labels wherever they are, or only from one organizer', async () => {
  // The cross-organizer screen selects across arrangements; the route under one
  // must not redraw a label belonging to another.
  const anywhere = fakePool([[]])
  await labelsToRedraw([1, 2], null, anywhere.pool)
  assert.deepEqual(anywhere.calls[0].params, [[1, 2], null])

  const scoped = fakePool([[]])
  await labelsToRedraw([1, 2], 4, scoped.pool)
  assert.deepEqual(scoped.calls[0].params, [[1, 2], 4])
  assert.match(scoped.calls[0].text, /"organizer_id" = \$2/)
})

test('a redraw reads the size off the row, not off the slot', async () => {
  // The slot can have been taken off the case since. A label that exists is
  // 30 x 40 mm whatever happened to the list of places it could go.
  const { calls, pool } = fakePool([
    [{ height_mm: '40', id: '9', options: null, organizer_id: '4', width_mm: '30' }],
  ])

  const labels = await labelsToRedraw([9], null, pool)

  assert.doesNotMatch(calls[0].text, /case_label_slot/)
  assert.deepEqual(labels, [{ heightMm: 40, id: 9, options: {}, organizerId: 4, widthMm: 30 }])
})
