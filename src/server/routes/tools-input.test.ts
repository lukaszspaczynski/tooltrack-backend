import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  parseToolCreate,
  parseToolPatch,
  parseToolQuery,
} from './tools-input'

function query(search: string): ReturnType<typeof parseToolQuery> {
  return parseToolQuery(new URLSearchParams(search))
}

function page(search: string) {
  const parsed = query(search)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.value
}

test('a card needs a name and nothing else', () => {
  const parsed = parseToolCreate({ name: '  Wiertarka udarowa ' })

  assert.ok(parsed.ok)
  assert.deepEqual(parsed.value, {
    brand: '',
    category: '',
    condition: 'good',
    model: '',
    name: 'Wiertarka udarowa',
    notes: '',
    serialNumber: '',
  })
})

test('a card without a usable name is refused', () => {
  for (const body of [{}, { name: '' }, { name: '   ' }, { name: 42 }, null, 'tool']) {
    assert.equal(parseToolCreate(body).ok, false, JSON.stringify(body))
  }
})

test('every card field is kept as typed, trimmed at the ends', () => {
  const parsed = parseToolCreate({
    brand: ' Makita ',
    category: 'Wiertarki',
    condition: 'needs_repair',
    model: 'HR 2470  BLACK',
    name: 'Młotowiertarka',
    notes: ' Szczotki do wymiany ',
    serialNumber: ' 12345-AB ',
  })

  assert.ok(parsed.ok)
  assert.equal(parsed.value.brand, 'Makita')
  assert.equal(parsed.value.model, 'HR 2470  BLACK')
  assert.equal(parsed.value.notes, 'Szczotki do wymiany')
  assert.equal(parsed.value.serialNumber, '12345-AB')
  assert.equal(parsed.value.condition, 'needs_repair')
})

test('an unknown condition is refused rather than defaulted', () => {
  assert.equal(parseToolCreate({ condition: 'broken', name: 'Piła' }).ok, false)
  assert.equal(parseToolPatch({ condition: 'NEW' }).ok, false)
})

test('a patch carries only what was sent', () => {
  const parsed = parseToolPatch({ condition: 'retired' })

  assert.ok(parsed.ok)
  assert.deepEqual(parsed.value, { condition: 'retired' })
})

test('a patch can clear a field but not the name', () => {
  const cleared = parseToolPatch({ brand: '', serialNumber: '' })
  assert.ok(cleared.ok)
  assert.deepEqual(cleared.value, { brand: '', serialNumber: '' })

  assert.equal(parseToolPatch({ name: '  ' }).ok, false)
})

test('an empty patch is refused', () => {
  assert.equal(parseToolPatch({}).ok, false)
})

test('over-long values are refused by field name', () => {
  const parsed = parseToolPatch({ brand: 'x'.repeat(121) })

  assert.equal(parsed.ok, false)
  assert.match(parsed.ok ? '' : parsed.error, /^brand must be at most/)
})

test('the list query has usable defaults', () => {
  const parsed = query('')

  assert.ok(parsed.ok)
  assert.deepEqual(parsed.value, {
    category: null,
    condition: null,
    inOrganizer: null,
    direction: 'desc',
    limit: DEFAULT_LIMIT,
    offset: 0,
    search: null,
    sort: 'updatedAt',
  })
})

test('a nonsense limit falls back and a huge one is clamped', () => {
  // A pasted link with a broken query string still shows the catalog.
  assert.equal(page('limit=banana').limit, DEFAULT_LIMIT)
  assert.equal(page('limit=100000').limit, MAX_LIMIT)
  assert.equal(page('limit=0').limit, 1)
  assert.equal(page('offset=-5').offset, 0)
})

test('an unknown sort key falls back but an unknown condition is an error', () => {
  const sorted = query('sort=serialNumber&order=asc')
  assert.ok(sorted.ok)
  assert.equal(sorted.value.sort, 'updatedAt')
  assert.equal(sorted.value.direction, 'asc')

  assert.equal(query('condition=broken').ok, false)
})

test('blank filters read as no filter', () => {
  const parsed = query('q=%20%20&category=&condition=')

  assert.ok(parsed.ok)
  assert.equal(parsed.value.search, null)
  assert.equal(parsed.value.category, null)
  assert.equal(parsed.value.condition, null)
})
