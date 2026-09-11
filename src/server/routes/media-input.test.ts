import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_MEDIA_LIMIT,
  MAX_DELETE_IDS,
  MAX_MEDIA_LIMIT,
  parseDeleteIds,
  parseMediaQuery,
} from './media-input'

function query(search: string) {
  const parsed = parseMediaQuery(new URLSearchParams(search))
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.value
}

test('the library opens on the newest photos', () => {
  assert.deepEqual(query(''), {
    // Both kinds by default: the library is everything on disk.
    assigned: null,
    direction: 'desc',
    limit: DEFAULT_MEDIA_LIMIT,
    offset: 0,
    search: null,
    source: null,
  })
})

test('filters are read, nonsense is clamped', () => {
  assert.equal(query('q=makita').search, 'makita')
  assert.equal(query('source=search').source, 'search')
  assert.equal(query('limit=9999').limit, MAX_MEDIA_LIMIT)
  assert.equal(query('limit=banana').limit, DEFAULT_MEDIA_LIMIT)
  assert.equal(query('offset=-3').offset, 0)
  assert.equal(query('q=%20').search, null)
})

test('the assigned filter takes true or false, and nothing else', () => {
  assert.equal(query('assigned=true').assigned, true)
  assert.equal(query('assigned=false').assigned, false)
  assert.equal(query('assigned=').assigned, null)
  assert.equal(parseMediaQuery(new URLSearchParams('assigned=moze')).ok, false)
})

test('an unknown source is an error, not silently ignored', () => {
  // Listing everything would look like an answer rather than a typo.
  assert.equal(parseMediaQuery(new URLSearchParams('source=nieznane')).ok, false)
})

test('a delete needs a list of positive whole numbers', () => {
  const parsed = parseDeleteIds({ ids: [3, 1, 2] })

  assert.ok(parsed.ok)
  assert.deepEqual(parsed.value, [3, 1, 2])
})

test('duplicates in a selection are collapsed', () => {
  // Otherwise the count reported back would say two deletes happened where
  // there was one row.
  const parsed = parseDeleteIds({ ids: [7, 7, 8] })

  assert.ok(parsed.ok)
  assert.deepEqual(parsed.value, [7, 8])
})

test('an empty or malformed selection is refused', () => {
  for (const body of [
    null,
    {},
    { ids: [] },
    { ids: 'nie' },
    { ids: [0] },
    { ids: [-1] },
    { ids: [1.5] },
    { ids: ['abc'] },
  ]) {
    assert.equal(parseDeleteIds(body).ok, false, JSON.stringify(body))
  }
})

test('the batch is capped', () => {
  const tooMany = Array.from({ length: MAX_DELETE_IDS + 1 }, (_, index) => index + 1)

  assert.equal(parseDeleteIds({ ids: tooMany }).ok, false)
  assert.equal(parseDeleteIds({ ids: tooMany.slice(0, MAX_DELETE_IDS) }).ok, true)
})

test('numeric strings from a form are accepted', () => {
  const parsed = parseDeleteIds({ ids: ['4', '5'] })

  assert.ok(parsed.ok)
  assert.deepEqual(parsed.value, [4, 5])
})
