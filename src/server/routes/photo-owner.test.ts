import assert from 'node:assert/strict'
import test from 'node:test'

import { ownerPath, parsePhotoOwner, sameOwner } from './photo-owner'

test('the owner is the id in the path', () => {
  assert.deepEqual(parsePhotoOwner({ id: '7' }), { id: 7 })
})

test('an id that is not digits is a path that does not exist', () => {
  // Answering 400 would tell a client to fix a URL it was given by a link.
  assert.equal(parsePhotoOwner({ id: 'abc' }), null)
  assert.equal(parsePhotoOwner({ id: '' }), null)
  assert.equal(parsePhotoOwner({}), null)
})

test('a photo URL is built from the owner, and there is one path left', () => {
  // It used to be two, because a case was a table of its own and its pictures
  // hung under /api/cases. One card, one address.
  assert.equal(ownerPath({ id: 4 }), '/api/items/4')
})

test('two owners are the same when the ids match', () => {
  assert.equal(sameOwner({ id: 4 }, { id: 4 }), true)
  assert.equal(sameOwner({ id: 4 }, { id: 5 }), false)
  assert.equal(sameOwner(null, null), false)
})
