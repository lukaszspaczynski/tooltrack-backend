import assert from 'node:assert/strict'
import test from 'node:test'

import { parseCaseCreate, parseCasePatch, parseCaseQuery, parseLabelSlot } from './cases-input'

test('a case needs a name and a maker', () => {
  assert.equal(parseCaseCreate({ manufacturer: 'Qbrick' }).ok, false)
  assert.equal(parseCaseCreate({ name: 'Toolbox 2.0' }).ok, false)

  const parsed = parseCaseCreate({ manufacturer: ' Qbrick ', name: ' Toolbox 2.0 ' })

  assert.ok(parsed.ok)
  assert.equal(parsed.value.name, 'Toolbox 2.0')
  assert.equal(parsed.value.manufacturer, 'Qbrick')
  // Everything else is off a spec sheet, and a spec sheet is optional.
  assert.equal(parsed.value.system, '')
  assert.equal(parsed.value.outerLengthMm, null)
  assert.equal(parsed.value.capacityL, null)
})

test('measurements arrive as numbers, as strings, and with a Polish comma', () => {
  const parsed = parseCaseCreate({
    capacityL: '4,5',
    diagonalMm: 497,
    manufacturer: 'Qbrick',
    name: 'Toolbox',
    outerLengthMm: '450',
  })

  assert.ok(parsed.ok)
  assert.equal(parsed.value.outerLengthMm, 450)
  assert.equal(parsed.value.diagonalMm, 497)
  // 4,5 L is what the label says; 4.5 is what the column holds.
  assert.equal(parsed.value.capacityL, 4.5)
})

test('a millimetre is a whole number, a litre is not', () => {
  assert.equal(parseCasePatch({ outerLengthMm: 450.5 }).ok, false)

  const litres = parseCasePatch({ capacityL: 9.55 })
  assert.ok(litres.ok)
  assert.equal(litres.value.capacityL, 9.55)
})

test('zero and negative measurements are refused, because they are not measurements', () => {
  // A box with no height does not exist. "Not measured" is null, below.
  for (const body of [{ outerHeightMm: 0 }, { outerHeightMm: -10 }, { loadKg: 0 }]) {
    assert.equal(parseCasePatch(body).ok, false, JSON.stringify(body))
  }
})

test('null clears a measurement, and is not the same as leaving it out', () => {
  const cleared = parseCasePatch({ diagonalMm: null })
  assert.ok(cleared.ok)
  assert.equal(cleared.value.diagonalMm, null)

  // Absent means "leave it alone", which is a patch with nothing in it.
  assert.equal(parseCasePatch({}).ok, false)
})

test('an empty string clears a measurement too, because that is what a form sends', () => {
  const parsed = parseCasePatch({ capacityL: '' })

  assert.ok(parsed.ok)
  assert.equal(parsed.value.capacityL, null)
})

test('nonsense in a measurement is a 400, not a silent null', () => {
  for (const body of [{ capacityL: 'dużo' }, { outerWidthMm: 'szeroki' }, { loadKg: {} }]) {
    assert.equal(parseCasePatch(body).ok, false, JSON.stringify(body))
  }
})

test('a patch cannot empty the name or the maker', () => {
  assert.equal(parseCasePatch({ name: '   ' }).ok, false)
  assert.equal(parseCasePatch({ manufacturer: '' }).ok, false)
})

test('the list query clamps rather than refuses, because links get pasted', () => {
  const parsed = parseCaseQuery(new URLSearchParams('limit=banana&offset=-5&sort=nonsense'))

  assert.ok(parsed.ok)
  assert.equal(parsed.value.limit, 50)
  assert.equal(parsed.value.offset, 0)
  // Name, because a shelf read alphabetically is the one people point at.
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

  // Null means "not measured" elsewhere in this file; a label with no width is
  // not a label, so here it is refused rather than stored.
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
