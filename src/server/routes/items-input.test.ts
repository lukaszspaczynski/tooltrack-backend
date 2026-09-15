import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_LIMIT,
  MAX_ATTRIBUTE_NAME_LENGTH,
  MAX_ATTRIBUTE_VALUE_LENGTH,
  MAX_LIMIT,
  parseAttributeCreate,
  parseAttributePatch,
  parseItemCreate,
  parseItemPatch,
  parseItemQuery,
} from './items-input'

function query(search: string): ReturnType<typeof parseItemQuery> {
  return parseItemQuery(new URLSearchParams(search))
}

function page(search: string) {
  const parsed = query(search)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.value
}

test('a card needs a name and nothing else', () => {
  const parsed = parseItemCreate({ name: '  Wiertarka udarowa ' })

  assert.ok(parsed.ok)
  assert.deepEqual(parsed.value, {
    brandId: null,
    category: '',
    condition: 'good',
    kind: 'tool',
    model: '',
    addressId: null,
    name: 'Wiertarka udarowa',
    notes: '',
    referenceUrl: '',
    serialNumber: '',
  })
})

test('a card without a usable name is refused', () => {
  for (const body of [{}, { name: '' }, { name: '   ' }, { name: 42 }, null, 'item']) {
    assert.equal(parseItemCreate(body).ok, false, JSON.stringify(body))
  }
})

test('every card field is kept as typed, trimmed at the ends', () => {
  const parsed = parseItemCreate({
    category: 'Wiertarki',
    condition: 'needs_repair',
    model: 'HR 2470  BLACK',
    name: 'Młotowiertarka',
    notes: ' Szczotki do wymiany ',
    serialNumber: ' 12345-AB ',
  })

  assert.ok(parsed.ok)
  assert.equal(parsed.value.model, 'HR 2470  BLACK')
  assert.equal(parsed.value.notes, 'Szczotki do wymiany')
  assert.equal(parsed.value.serialNumber, '12345-AB')
  assert.equal(parsed.value.condition, 'needs_repair')
})

test('an unknown condition is refused rather than defaulted', () => {
  assert.equal(parseItemCreate({ condition: 'broken', name: 'Piła' }).ok, false)
  assert.equal(parseItemPatch({ condition: 'NEW' }).ok, false)
})

test('a patch carries only what was sent', () => {
  const parsed = parseItemPatch({ condition: 'retired' })

  assert.ok(parsed.ok)
  assert.deepEqual(parsed.value, { condition: 'retired' })
})

test('a patch can clear a field but not the name', () => {
  const cleared = parseItemPatch({ brandId: null, serialNumber: '' })
  assert.ok(cleared.ok)
  // The maker clears to null and the serial number to '': one is a row this
  // card points at, the other is a string on the card itself.
  assert.deepEqual(cleared.value, { brandId: null, serialNumber: '' })

  assert.equal(parseItemPatch({ name: '  ' }).ok, false)
})

test('an empty patch is refused', () => {
  assert.equal(parseItemPatch({}).ok, false)
})

test('over-long values are refused by field name', () => {
  const parsed = parseItemPatch({ model: 'x'.repeat(121) })

  assert.equal(parsed.ok, false)
  assert.match(parsed.ok ? '' : parsed.error, /^model must be at most/)
})

test('a maker is an id, and nonsense in its place is refused', () => {
  // It was free text, matched back to a row on the way in. A card pointing at
  // a maker that does not exist is now a 404 rather than a string nobody can
  // count, and "no maker" is null rather than an empty name.
  assert.ok(parseItemPatch({ brandId: 4 }).ok)
  assert.ok(parseItemPatch({ brandId: '4' }).ok)
  assert.ok(parseItemPatch({ brandId: null }).ok)
  assert.equal(parseItemPatch({ brandId: 'Makita' }).ok, false)
  assert.equal(parseItemPatch({ brandId: -1 }).ok, false)
})

test('a kind is one of the sorts the catalog knows', () => {
  assert.ok(parseItemCreate({ kind: 'appliance', name: 'Pralka' }).ok)
  assert.ok(parseItemCreate({ kind: 'case', name: 'Skrzynka' }).ok)
  // Unset is a tool: this catalog was a tool shed, and most of what is added
  // to it still is one.
  const unset = parseItemCreate({ name: 'Wiertarka' })
  assert.ok(unset.ok)
  assert.equal(unset.value.kind, 'tool')

  assert.equal(parseItemCreate({ kind: 'furniture', name: 'Szafa' }).ok, false)
})

test('the list query has usable defaults', () => {
  const parsed = query('')

  assert.ok(parsed.ok)
  assert.deepEqual(parsed.value, {
    addressId: null,
    category: null,
    kind: null,
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

test('a parameter needs both halves, and neither may be blank', () => {
  // A parameter with no name says nothing; one with no value is a question
  // rather than an answer.
  assert.equal(parseAttributeCreate({ name: 'Napięcie sieciowe', value: '230 V' }).ok, true)
  assert.equal(parseAttributeCreate({ name: 'Napięcie sieciowe' }).ok, false)
  assert.equal(parseAttributeCreate({ value: '230 V' }).ok, false)
  assert.equal(parseAttributeCreate({ name: '  ', value: '230 V' }).ok, false)
  assert.equal(parseAttributeCreate({ name: 'Napięcie', value: '   ' }).ok, false)
  assert.equal(parseAttributeCreate('napięcie').ok, false)
})

test('a parameter arrives trimmed, the way it will be compared', () => {
  // The unique index folds case and trims, so storing the untrimmed version
  // would mean a name that looks different from the one that blocked it.
  const parsed = parseAttributeCreate({ name: '  Napięcie sieciowe ', value: '  230 V ' })

  assert.ok(parsed.ok)
  assert.deepEqual(parsed.value, { name: 'Napięcie sieciowe', value: '230 V' })
})

test('one space is one space, however many were typed', () => {
  // The unique index folds case and trims the ends; without collapsing the
  // middle, "napięcie  sieciowe" would be a second parameter beside the first.
  const parsed = parseAttributeCreate({ name: 'Napięcie\t sieciowe', value: '230   V' })

  assert.ok(parsed.ok)
  assert.deepEqual(parsed.value, { name: 'Napięcie sieciowe', value: '230 V' })
})

test('a parameter is a line off a rating plate, not a paragraph', () => {
  assert.equal(
    parseAttributeCreate({ name: 'x'.repeat(MAX_ATTRIBUTE_NAME_LENGTH + 1), value: '230 V' }).ok,
    false,
  )
  assert.equal(
    parseAttributeCreate({ name: 'Napięcie', value: 'x'.repeat(MAX_ATTRIBUTE_VALUE_LENGTH + 1) })
      .ok,
    false,
  )
})

test('editing a parameter takes either half, but not neither', () => {
  assert.equal(parseAttributePatch({ value: '400 V' }).ok, true)
  assert.equal(parseAttributePatch({ name: 'Napięcie' }).ok, true)
  // Answering an empty patch with the row unchanged would look to the screen
  // like it saved something.
  assert.equal(parseAttributePatch({}).ok, false)
  assert.equal(parseAttributePatch({ name: '' }).ok, false)
})
