import assert from 'node:assert/strict'
import test from 'node:test'

import { isPhotoOwnerKind, ownerColumn, ownerPath, parsePhotoOwner, sameOwner } from './photo-owner'

test('the owner comes from the path segment the router matched', () => {
  assert.deepEqual(parsePhotoOwner({ id: '7', owner: 'items' }), { id: 7, kind: 'item' })
  assert.deepEqual(parsePhotoOwner({ id: '7', owner: 'cases' }), { id: 7, kind: 'case' })
})

test('an unknown segment is nothing, not a guess', () => {
  // The router cannot produce this, but the store would otherwise be one typo
  // away from writing to a column chosen by a URL.
  assert.equal(parsePhotoOwner({ id: '7', owner: 'boxes' }), null)
  assert.equal(parsePhotoOwner({ id: '7' }), null)
})

test('an id that is not digits is a path that does not exist', () => {
  assert.equal(parsePhotoOwner({ id: 'abc', owner: 'items' }), null)
  assert.equal(parsePhotoOwner({ id: '', owner: 'items' }), null)
})

test('only the two known kinds map to a column', () => {
  assert.equal(ownerColumn('item'), 'item_id')
  assert.equal(ownerColumn('case'), 'case_id')
  // hasOwn, not `in`: `in` walks the prototype, so 'toString' would pass as an
  // owner kind and reach SQL as a column name.
  assert.equal(isPhotoOwnerKind('toString'), false)
})

test('a photo URL is built from the owner, so a case never links through /items', () => {
  assert.equal(ownerPath({ id: 4, kind: 'case' }), '/api/cases/4')
  assert.equal(ownerPath({ id: 4, kind: 'item' }), '/api/items/4')
})

test('two owners are the same only when both halves match', () => {
  assert.equal(sameOwner({ id: 4, kind: 'item' }, { id: 4, kind: 'item' }), true)
  // Item 4 and case 4 are different cards that happen to share a number.
  assert.equal(sameOwner({ id: 4, kind: 'item' }, { id: 4, kind: 'case' }), false)
  assert.equal(sameOwner(null, null), false)
})
