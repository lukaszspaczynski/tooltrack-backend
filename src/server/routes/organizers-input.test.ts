import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseLabelIds,
  parseLabelRequest,
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

test('an empty text on a contents label means "work it out"', () => {
  // Empty is the absence of a value, not a value — the same convention as
  // brand.color. It is what makes a label made before these fields existed
  // still redraw with the catalog's own words on it.
  const parsed = parseLabelRequest({
    slotId: 4,
    template: 'contents',
    withNames: true,
    withTitle: true,
  })

  assert.ok(parsed.ok)
  assert.equal(parsed.value.options.titleText, '')
  assert.equal(parsed.value.options.namesText, '')
})

test('the caption says outright where it comes from', () => {
  const models = parseLabelRequest({
    namesSource: 'models',
    slotId: 4,
    template: 'contents',
    withNames: true,
  })

  assert.ok(models.ok)
  assert.equal(models.value.options.namesSource, 'models')

  // Nonsense in the field is not a source. It falls back the same way a row
  // with no source at all does, rather than reaching the query that turns a
  // source into a column name.
  const rubbish = parseLabelRequest({
    namesSource: "name'; DROP TABLE",
    slotId: 4,
    template: 'contents',
    withNames: true,
  })

  assert.ok(rubbish.ok)
  assert.equal(rubbish.value.options.namesSource, 'tools')
})

test('a request from before the choice existed still means what it meant', () => {
  // A typed text meant a typed line; its absence meant the tool names.
  const typed = parseLabelRequest({
    namesText: '18 V, Li-Ion',
    slotId: 4,
    template: 'contents',
    withNames: true,
  })
  const plain = parseLabelRequest({ slotId: 4, template: 'contents', withNames: true })

  assert.ok(typed.ok)
  assert.ok(plain.ok)
  assert.equal(typed.value.options.namesSource, 'text')
  assert.equal(plain.value.options.namesSource, 'tools')
})

test('a typed line travels as itself, trimmed', () => {
  const parsed = parseLabelRequest({
    namesText: '  18 V + 12 V, Li-Ion  ',
    slotId: 4,
    template: 'contents',
    titleText: 'Akumulatory',
    withNames: true,
    withTitle: true,
  })

  assert.ok(parsed.ok)
  assert.equal(parsed.value.options.titleText, 'Akumulatory')
  assert.equal(parsed.value.options.namesText, '18 V + 12 V, Li-Ion')
})

test('a line longer than the label could ever hold is refused here', () => {
  // Refused rather than drawn as far as it goes: a 30 mm label can only shrink
  // the type until nobody can read it, and a drawing that quietly gives up is
  // worse than a message.
  const parsed = parseLabelRequest({
    slotId: 4,
    template: 'contents',
    titleText: 'a'.repeat(121),
    withTitle: true,
  })

  assert.equal(parsed.ok, false)
})

test('the number template carries no text of its own', () => {
  const parsed = parseLabelRequest({ slotId: 4, template: 'number', titleText: 'Cokolwiek' })

  assert.ok(parsed.ok)
  assert.equal('titleText' in parsed.value.options, false)
})

test('refreshing takes ids, once each, and never an empty list', () => {
  const parsed = parseLabelIds({ labelIds: [7, 7, 9] })

  assert.ok(parsed.ok)
  assert.deepEqual(parsed.value, [7, 9])
  assert.equal(parseLabelIds({ labelIds: [] }).ok, false)
  assert.equal(parseLabelIds({ labelIds: ['siedem'] }).ok, false)
  assert.equal(parseLabelIds({}).ok, false)
})
