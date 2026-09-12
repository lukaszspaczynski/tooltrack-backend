import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_LABEL_LIMIT, MAX_LABEL_LIMIT, parseLabelListQuery } from './labels-input'

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
