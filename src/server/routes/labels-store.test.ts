import assert from 'node:assert/strict'
import test from 'node:test'

import type { PgPool, PgQueryResult } from '../db'
import { labelFileUrl, labelPreviewUrl, labelsToRedraw, listAllLabels } from './labels-store'

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

const query = {
  direction: 'desc' as const,
  limit: 48,
  offset: 0,
  organizerId: null,
  search: null,
  template: null,
}

test('a label carries the arrangement and the box it belongs to', async () => {
  // A label has no name of its own. Without the two joins the screen would be a
  // grid of pictures nobody can place.
  const { calls, pool } = fakePool([[]])

  await listAllLabels(query, pool)

  assert.match(calls[0].text, /FROM "catalog"\."organizer_label"/)
  assert.match(calls[0].text, /JOIN "catalog"\."organizer"/)
  assert.match(calls[0].text, /JOIN "catalog"\."tool_case"/)
  assert.equal(calls.length, 1)
})

test('the count sits between the columns and the FROM, not after it', async () => {
  // The same mistake the organizer list made: appended after the FROM it is
  // invalid SQL, and every request answers 500.
  const { calls, pool } = fakePool([[]])

  await listAllLabels(query, pool)

  const columns = calls[0].text.indexOf('count(*) OVER ()')
  const from = calls[0].text.indexOf('FROM "catalog"."organizer_label"')

  assert.ok(columns > 0 && columns < from)
})

test('the filters are parameters, never query text', async () => {
  const { calls, pool } = fakePool([[]])

  await listAllLabels({ ...query, organizerId: 4, search: '50%_off', template: 'contents' }, pool)

  // The wildcards a person typed are escaped, or "%" would match everything.
  assert.deepEqual(calls[0].params, ['%50\\%\\_off%', 'contents', 4, 48, 0])
  assert.doesNotMatch(calls[0].text, /contents/)
})

test('the total comes off the window count, not off the page', async () => {
  const { pool } = fakePool([
    [
      {
        byte_size: '1024',
        case_id: '2',
        case_manufacturer: 'Qbrick',
        case_name: 'Skrzynka 4',
        created_at: '2026-09-12T08:00:00.000Z',
        created_by: '1',
        height_mm: '40',
        id: '9',
        options: { printReady: true },
        organizer_id: '4',
        organizer_name: 'Wiertarki',
        organizer_number: '4',
        pdf_path: 'labels/ab12cd34ef56789.pdf',
        preview_path: 'labels/ab12cd34ef56789.pdf.png',
        template: 'contents',
        total_count: '112',
        width_mm: '30',
      },
    ],
  ])

  const page = await listAllLabels(query, pool)

  assert.equal(page.total, 112)
  assert.equal(page.items.length, 1)
  assert.deepEqual(page.items[0].organizer, { id: 4, name: 'Wiertarki', number: 4 })
  assert.equal(page.items[0].case.name, 'Skrzynka 4')
  assert.equal(page.items[0].url, '/api/organizers/4/labels/9/file?v=ab12cd34ef56')
  assert.equal(page.items[0].previewUrl, '/api/organizers/4/labels/9/preview?v=ab12cd34ef56')
})

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
