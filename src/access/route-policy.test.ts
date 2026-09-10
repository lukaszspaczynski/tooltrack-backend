import assert from 'node:assert/strict'
import test from 'node:test'

import { routeRequirement, satisfiesRequirement } from './route-policy'
import type { Role, User } from './roles'

function user(role: Role, status: User['status'] = 'active'): User {
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    displayName: 'Ola',
    email: 'ola@example.com',
    id: 1,
    role,
    status,
  }
}

function allows(pathname: string, method: string, actor: null | User): boolean {
  return satisfiesRequirement(actor, routeRequirement(pathname, method))
}

test('the catalog is readable by every role and writable by editor and admin', () => {
  for (const path of ['/api/tools', '/api/tools/42', '/api/tools/categories']) {
    assert.equal(allows(path, 'GET', user('viewer')), true, path)
  }

  assert.equal(allows('/api/tools', 'POST', user('viewer')), false)
  assert.equal(allows('/api/tools', 'POST', user('editor')), true)
  assert.equal(allows('/api/tools/42', 'PATCH', user('viewer')), false)
  assert.equal(allows('/api/tools/42', 'PATCH', user('editor')), true)
  assert.equal(allows('/api/tools/42', 'DELETE', user('editor')), true)
  assert.equal(allows('/api/tools/42', 'DELETE', user('admin')), true)
})

test('user management is admin only', () => {
  assert.equal(allows('/api/users', 'GET', user('editor')), false)
  assert.equal(allows('/api/users', 'GET', user('admin')), true)
  assert.equal(allows('/api/users/7', 'PATCH', user('editor')), false)
  assert.equal(allows('/api/users/7', 'PATCH', user('admin')), true)
})

test('nothing in the catalog is reachable without a session', () => {
  for (const [path, method] of [
    ['/api/tools', 'GET'],
    ['/api/tools', 'POST'],
    ['/api/tools/42', 'GET'],
    ['/api/users', 'GET'],
  ] as const) {
    assert.equal(allows(path, method, null), false, `${method} ${path}`)
  }
})

test('a disabled account is refused even where its role would allow it', () => {
  assert.equal(allows('/api/tools', 'GET', user('admin', 'disabled')), false)
})

test('auth and version routes stay open', () => {
  for (const [path, method] of [
    ['/api/auth/register', 'POST'],
    ['/api/auth/login', 'POST'],
    ['/api/auth/logout', 'POST'],
    ['/api/auth/me', 'GET'],
    ['/api/version', 'GET'],
    ['/healthz', 'GET'],
  ] as const) {
    assert.equal(allows(path, method, null), true, `${method} ${path}`)
  }
})

test('an unclassified route is denied, not allowed', () => {
  const requirement = routeRequirement('/api/tools/42/history', 'GET')

  assert.equal(requirement.check.kind, 'deny')
  assert.equal(satisfiesRequirement(user('admin'), requirement), false)
})

test('a method a route does not implement is denied', () => {
  assert.equal(routeRequirement('/api/tools', 'DELETE').check.kind, 'deny')
  assert.equal(routeRequirement('/api/users', 'POST').check.kind, 'deny')
  assert.equal(allows('/api/users', 'POST', user('admin')), false)
})

test('a trailing slash is the same route', () => {
  assert.deepEqual(routeRequirement('/api/tools/', 'GET'), routeRequirement('/api/tools', 'GET'))
})

test('the tools rule does not leak onto a longer path', () => {
  // /api/tools/:id is one segment. Anything deeper has to be classified on its
  // own before it can be reached.
  assert.equal(routeRequirement('/api/tools/42/attachments', 'GET').check.kind, 'deny')
})

test('the domain label survives an unclassified path', () => {
  assert.equal(routeRequirement('/api/users/7/sessions', 'DELETE').domain, 'users')
})
