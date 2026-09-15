import assert from 'node:assert/strict'
import test from 'node:test'

import { parseCaseCreate, parseCasePatch, parseCaseQuery, parseLabelSlot } from './cases-input'

test('a case needs a name, and nothing else is required of it', () => {
  // The maker was required too, until it became a row a case points at: a box
  // whose maker nobody has recorded is still a box, and every measurement is
  // a parameter now rather than a column with a CHECK.
  assert.equal(parseCaseCreate({ system: 'PRO' }).ok, false)

  const parsed = parseCaseCreate({ name: ' Toolbox 2.0 ' })

  assert.ok(parsed.ok)
  assert.equal(parsed.value.name, 'Toolbox 2.0')
  assert.equal(parsed.value.brandId, null)
  assert.equal(parsed.value.system, '')
})

test('a maker is an id, and nonsense in its place is refused', () => {
  assert.ok(parseCasePatch({ brandId: 4 }).ok)
  // A form sends "4"; an emptied select sends '', which is the same null as
  // never having chosen.
  assert.ok(parseCasePatch({ brandId: '4' }).ok)
  const cleared = parseCasePatch({ brandId: null })
  assert.ok(cleared.ok)
  assert.equal(cleared.value.brandId, null)
  assert.equal(parseCasePatch({ brandId: 'Qbrick' }).ok, false)
  assert.equal(parseCasePatch({ brandId: 0 }).ok, false)
})

test('a patch cannot empty the name, and an empty patch is refused', () => {
  assert.equal(parseCasePatch({ name: '   ' }).ok, false)
  assert.equal(parseCasePatch({}).ok, false)
  // Clearing the note is a real edit, unlike sending nothing.
  assert.ok(parseCasePatch({ notes: '' }).ok)
})

test('the list query clamps rather than refuses, because links get pasted', () => {
  const parsed = parseCaseQuery(new URLSearchParams('limit=banana&offset=-5&sort=nonsense'))

  assert.ok(parsed.ok)
  assert.equal(parsed.value.limit, 50)
  assert.equal(parsed.value.offset, 0)
  // Name, because a shelf read alphabetically is the one people point at.
  assert.equal(parsed.value.sort, 'name')
})

test('a link saved before capacity became a parameter still shows the shelf', () => {
  // `sort=capacityL` was an option while capacity was a column. Sorting by it
  // now would mean a regular expression and a cast in the ORDER BY, for a
  // question about six boxes — so it falls through to the name rather than
  // being refused.
  const parsed = parseCaseQuery(new URLSearchParams('sort=capacityL'))

  assert.ok(parsed.ok)
  assert.equal(parsed.value.sort, 'name')
})

test('the filters are read from the query string', () => {
  const parsed = parseCaseQuery(
    new URLSearchParams('q=toolbox&system=PRO&manufacturer=Qbrick&order=asc'),
  )

  assert.ok(parsed.ok)
  assert.deepEqual(
    {
      direction: parsed.value.direction,
      manufacturer: parsed.value.manufacturer,
      search: parsed.value.search,
      system: parsed.value.system,
    },
    { direction: 'asc', manufacturer: 'Qbrick', search: 'toolbox', system: 'PRO' },
  )
})

test('a label slot is two millimetre sizes, and neither may be unknown', () => {
  const parsed = parseLabelSlot({ heightMm: 40, widthMm: 30 })

  assert.ok(parsed.ok)
  assert.deepEqual(parsed.value, { heightMm: 40, widthMm: 30 })

  // The measurements of a box are free text on its sheet now; a label size is
  // not, and stays a checked number — a slot with no width is not a slot.
  for (const body of [{ heightMm: 40 }, { widthMm: 30 }, { heightMm: null, widthMm: 30 }]) {
    assert.equal(parseLabelSlot(body).ok, false, JSON.stringify(body))
  }
})

test('a label slot is whole millimetres, and zero is not a size', () => {
  for (const body of [
    { heightMm: 40, widthMm: 0 },
    { heightMm: -40, widthMm: 30 },
    { heightMm: 40, widthMm: 30.5 },
  ]) {
    assert.equal(parseLabelSlot(body).ok, false, JSON.stringify(body))
  }
})
