import assert from 'node:assert/strict'
import test from 'node:test'

import { parseUserPatch } from './users-input'

test('a role change carries only the role', () => {
  const parsed = parseUserPatch({ role: 'editor' })

  assert.ok(parsed.ok)
  assert.deepEqual(parsed.value, { role: 'editor' })
})

test('only the three roles are accepted', () => {
  for (const role of ['owner', 'ADMIN', '', null, 'toString']) {
    assert.equal(parseUserPatch({ role }).ok, false, JSON.stringify(role))
  }
})

test('status is active or disabled and nothing else', () => {
  assert.ok(parseUserPatch({ status: 'disabled' }).ok)
  assert.equal(parseUserPatch({ status: 'deleted' }).ok, false)
})

test('the email is not editable here', () => {
  // It is the login identity and the unique key; changing it is an account
  // migration, not a field edit. A body that only tries to change it is
  // refused rather than silently ignored.
  assert.equal(parseUserPatch({ email: 'nowy@example.com' }).ok, false)
})

test('an empty patch is refused', () => {
  assert.equal(parseUserPatch({}).ok, false)
  assert.equal(parseUserPatch(null).ok, false)
})
