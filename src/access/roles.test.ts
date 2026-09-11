import assert from 'node:assert/strict'
import test from 'node:test'

import {
  capabilitiesFor,
  canManageUsers,
  canReadCatalog,
  canWriteCatalog,
  DEFAULT_ROLE,
  effectiveRole,
  isRole,
  normalizeEmail,
  ROLE_CAPABILITIES,
  type Role,
  type User,
} from './roles'

function user(overrides: Partial<User> = {}): User {
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    displayName: 'Ola',
    email: 'ola@example.com',
    id: 1,
    role: 'viewer',
    status: 'active',
    ...overrides,
  }
}

test('a new account is a viewer', () => {
  assert.equal(DEFAULT_ROLE, 'viewer')
  assert.deepEqual(ROLE_CAPABILITIES.viewer, ['catalog.read'])
})

test('viewer reads, editor writes, only admin manages users', () => {
  const viewer = user({ role: 'viewer' })
  const editor = user({ role: 'editor' })
  const admin = user({ role: 'admin' })

  assert.deepEqual(
    [canReadCatalog(viewer), canWriteCatalog(viewer), canManageUsers(viewer)],
    [true, false, false],
  )
  assert.deepEqual(
    [canReadCatalog(editor), canWriteCatalog(editor), canManageUsers(editor)],
    [true, true, false],
  )
  assert.deepEqual(
    [canReadCatalog(admin), canWriteCatalog(admin), canManageUsers(admin)],
    [true, true, true],
  )
})

test('an admin holds every capability an editor holds', () => {
  for (const capability of ROLE_CAPABILITIES.editor) {
    assert.ok(ROLE_CAPABILITIES.admin.includes(capability), capability)
  }
})

test('a disabled account holds nothing, whatever its role says', () => {
  const disabled = user({ role: 'admin', status: 'disabled' })

  assert.deepEqual(capabilitiesFor(disabled), [])
  assert.equal(effectiveRole(disabled), null)
  assert.equal(canReadCatalog(disabled), false)
})

test('no user holds anything', () => {
  assert.deepEqual(capabilitiesFor(null), [])
  assert.equal(canReadCatalog(undefined), false)
})

test('the bootstrap allowlist resolves an account as admin', (t) => {
  t.after(() => {
    delete process.env.TOOLTRACK_BOOTSTRAP_ADMIN_EMAILS
  })

  const viewer = user({ email: 'Boss@Example.com ', role: 'viewer' })
  assert.equal(effectiveRole(viewer), 'viewer')

  process.env.TOOLTRACK_BOOTSTRAP_ADMIN_EMAILS = 'boss@example.com, other@example.com'
  assert.equal(effectiveRole(user({ email: 'boss@example.com' })), 'admin')
  assert.equal(canManageUsers(user({ email: 'boss@example.com' })), true)

  // Membership is not a way past being disabled.
  assert.equal(effectiveRole(user({ email: 'boss@example.com', status: 'disabled' })), null)
})

test('the bootstrap allowlist is read per call, not at import', (t) => {
  t.after(() => {
    delete process.env.TOOLTRACK_BOOTSTRAP_ADMIN_EMAILS
  })

  const account = user({ email: 'late@example.com' })
  assert.equal(effectiveRole(account), 'viewer')

  process.env.TOOLTRACK_BOOTSTRAP_ADMIN_EMAILS = 'late@example.com'
  assert.equal(effectiveRole(account), 'admin')

  process.env.TOOLTRACK_BOOTSTRAP_ADMIN_EMAILS = ''
  assert.equal(effectiveRole(account), 'viewer')
})

test('isRole refuses anything outside the three roles', () => {
  const roles: Role[] = ['admin', 'editor', 'viewer']
  for (const role of roles) assert.ok(isRole(role))

  assert.equal(isRole('owner'), false)
  assert.equal(isRole('ADMIN'), false)
  assert.equal(isRole(undefined), false)
  // Inherited object keys are not roles.
  assert.equal(isRole('toString'), false)
})

test('emails are compared lowercased and trimmed', () => {
  assert.equal(normalizeEmail('  Ola@Example.COM '), 'ola@example.com')
  assert.equal(normalizeEmail(null), '')
})
