import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseOrganizerCreate,
  parseOrganizerPatch,
  parseOrganizerQuery,
  parseToolIds,
} from './organizers-input'

test('an organizer needs a name and a case', () => {
  assert.equal(parseOrganizerCreate({ caseId: 2 }).ok, false)
  // An arrangement of nothing is not an arrangement. The wizard asks for the
  // case first for the same reason.
  assert.equal(parseOrganizerCreate({ name: 'Wiertarki' }).ok, false)

  const parsed = parseOrganizerCreate({ caseId: 2, name: ' Wiertarki ' })

  assert.ok(parsed.ok)
  assert.equal(parsed.value.name, 'Wiertarki')
  assert.equal(parsed.value.caseId, 2)
  assert.equal(parsed.value.description, '')
})

test('no number means the store picks the next free one', () => {
  // Null rather than a guess here: only the database can see what is taken.
  const parsed = parseOrganizerCreate({ caseId: 2, name: 'Wiertarki' })

  assert.ok(parsed.ok)
  assert.equal(parsed.value.number, null)
})

test('a number that was asked for is kept, and nonsense is refused', () => {
  const parsed = parseOrganizerCreate({ caseId: 2, name: 'Wiertarki', number: 7 })
  assert.ok(parsed.ok)
  assert.equal(parsed.value.number, 7)

  for (const number of [0, -1, 2.5, 'cztery', 999_999_999]) {
    assert.equal(parseOrganizerCreate({ caseId: 2, name: 'X', number }).ok, false, String(number))
  }
})

test('a patch can move an organizer to another case but not empty it', () => {
  assert.ok(parseOrganizerPatch({ caseId: 5 }).ok)
  assert.equal(parseOrganizerPatch({ caseId: null }).ok, false)
  assert.equal(parseOrganizerPatch({}).ok, false)
})

test('tool ids are whole numbers, deduplicated, and not an empty list', () => {
  const parsed = parseToolIds({ toolIds: [3, 3, 9] })

  assert.ok(parsed.ok)
  assert.deepEqual(parsed.value, [3, 9])
  assert.equal(parseToolIds({ toolIds: [] }).ok, false)
  assert.equal(parseToolIds({ toolIds: ['siedem'] }).ok, false)
  assert.equal(parseToolIds({}).ok, false)
})

test('the list reads by number, because that is the order they are stacked in', () => {
  const parsed = parseOrganizerQuery(new URLSearchParams(''))

  assert.ok(parsed.ok)
  assert.equal(parsed.value.sort, 'number')
  assert.equal(parsed.value.direction, 'asc')
})

test('the case filter is what the delete confirmation asks with', () => {
  const parsed = parseOrganizerQuery(new URLSearchParams('caseId=4'))

  assert.ok(parsed.ok)
  assert.equal(parsed.value.caseId, 4)
  // Nonsense is dropped rather than refused: this is a link somebody pasted.
  assert.equal(parseOrganizerQuery(new URLSearchParams('caseId=abc')).ok, true)
})
