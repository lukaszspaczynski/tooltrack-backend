import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_LABEL_LIMIT,
  MAX_LABEL_LIMIT,
  MAX_SHEET_IDS,
  parseLabelListQuery,
  parseSheetIds,
} from './labels-input'

function parse(search: string) {
  const parsed = parseLabelListQuery(new URLSearchParams(search))
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error)
  return parsed.value
}

test('an empty query is the newest page of every label', () => {
  // The screen is opened to find what was printed last, so the default order is
  // the opposite of the organizer list's.
  assert.deepEqual(parse(''), {
    direction: 'desc',
    limit: DEFAULT_LABEL_LIMIT,
    offset: 0,
    organizerId: null,
    search: null,
    template: null,
  })
})

test('an unknown template is refused rather than ignored', () => {
  // Dropping it would answer with every label for a filter that says otherwise,
  // which reads as "there are no others".
  const parsed = parseLabelListQuery(new URLSearchParams('template=sticker'))

  assert.equal(parsed.ok, false)
})

test('both templates are accepted by name', () => {
  assert.equal(parse('template=number').template, 'number')
  assert.equal(parse('template=contents').template, 'contents')
})

test('organizerId must be an id, not a word', () => {
  assert.equal(parse('organizerId=7').organizerId, 7)
  assert.equal(parseLabelListQuery(new URLSearchParams('organizerId=0')).ok, false)
  assert.equal(parseLabelListQuery(new URLSearchParams('organizerId=siedem')).ok, false)
})

test('the limit is clamped rather than trusted', () => {
  assert.equal(parse(`limit=${MAX_LABEL_LIMIT + 500}`).limit, MAX_LABEL_LIMIT)
  assert.equal(parse('limit=0').limit, 1)
  assert.equal(parse('limit=abc').limit, DEFAULT_LABEL_LIMIT)
  assert.equal(parse('offset=-10').offset, 0)
})

test('a blank search is no search', () => {
  // An empty box on the screen must not become a filter matching nothing.
  assert.equal(parse('q=%20%20').search, null)
  assert.equal(parse('q=wiertarki').search, 'wiertarki')
})

function sheet(search: string) {
  return parseSheetIds(new URLSearchParams(search))
}

test('a sheet takes as many labels as the list will show at once', () => {
  // The screen's "show everything, tick everything, print it" ends in a refusal
  // the moment this falls behind the list's own ceiling, and the two live in
  // different repositories — so the coupling is asserted rather than assumed.
  assert.equal(MAX_SHEET_IDS, MAX_LABEL_LIMIT)

  const ids = Array.from({ length: MAX_SHEET_IDS }, (_, index) => index + 1)
  const parsed = sheet(`ids=${ids.join(',')}`)

  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error)
  assert.equal(parsed.value.length, MAX_SHEET_IDS)
})

test('one label past the ceiling is refused rather than trimmed', () => {
  // Silently dropping the last one prints a sheet that looks complete and is
  // not, which is the one failure nobody notices before cutting.
  const ids = Array.from({ length: MAX_SHEET_IDS + 1 }, (_, index) => index + 1)

  assert.equal(sheet(`ids=${ids.join(',')}`).ok, false)
})

test('an empty selection is not a sheet', () => {
  assert.equal(sheet('').ok, false)
  assert.equal(sheet('ids=').ok, false)
  assert.equal(sheet('ids=%20,%20').ok, false)
})

test('an id that is not an id is refused, not skipped', () => {
  assert.equal(sheet('ids=4,cztery').ok, false)
  assert.equal(sheet('ids=4,0').ok, false)
  assert.equal(sheet('ids=4,-2').ok, false)
  assert.equal(sheet('ids=4,1.5').ok, false)
})

test('the same label twice is one place on the paper', () => {
  const parsed = sheet('ids=7,4,7,%204%20')

  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error)
  assert.deepEqual(parsed.value, [7, 4])
})
