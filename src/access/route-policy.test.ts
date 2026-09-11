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

test('search settings: everyone who searches reads them, only an admin edits the keys', () => {
  assert.equal(allows('/api/settings/search-engines', 'GET', user('viewer')), true)
  assert.equal(allows('/api/settings/search-engines', 'GET', null), false)

  // The keys are one installation's property.
  assert.equal(allows('/api/settings/search-engines/google', 'PATCH', user('editor')), false)
  assert.equal(allows('/api/settings/search-engines/google', 'PATCH', user('admin')), true)

  // Which engines I search with is my own business.
  assert.equal(allows('/api/me/search-engines/google', 'PATCH', user('viewer')), false)
  assert.equal(allows('/api/me/search-engines/google', 'PATCH', user('editor')), true)

  // The list is read-only; there is no way to write the whole thing at once.
  assert.equal(routeRequirement('/api/settings/search-engines', 'PATCH').check.kind, 'deny')
  assert.equal(routeRequirement('/api/me/search-engines/google', 'DELETE').check.kind, 'deny')
})

test('cutout settings: everyone reads, only an admin changes', () => {
  assert.equal(allows('/api/settings/cutout', 'GET', user('viewer')), true)
  assert.equal(allows('/api/settings/cutout', 'PATCH', user('editor')), false)
  assert.equal(allows('/api/settings/cutout', 'PATCH', user('admin')), true)
  // There is no per-account variant of this one, unlike the engines.
  assert.equal(routeRequirement('/api/me/cutout', 'PATCH').check.kind, 'deny')
})

test('the photo library reads with the catalog and deletes with catalog.write', () => {
  assert.equal(allows('/api/photos', 'GET', user('viewer')), true)
  // Uploading a photo that belongs to no tool is still writing to the catalog.
  assert.equal(allows('/api/photos', 'POST', user('viewer')), false)
  assert.equal(allows('/api/photos', 'POST', user('editor')), true)
  // Bytes by photo id, for the photos that have no tool to be reached through.
  assert.equal(allows('/api/photos/7/file', 'GET', user('viewer')), true)
  assert.equal(allows('/api/photos/7/file', 'GET', null), false)
  assert.equal(allows('/api/photos', 'GET', null), false)
  assert.equal(allows('/api/photos/delete', 'POST', user('viewer')), false)
  assert.equal(allows('/api/photos/delete', 'POST', user('editor')), true)
  assert.equal(allows('/api/photos/delete', 'POST', user('admin')), true)
  // Deleting is a POST with a list in it; nothing else lives on that path.
  assert.equal(routeRequirement('/api/photos/delete', 'GET').check.kind, 'deny')
  assert.equal(routeRequirement('/api/photos', 'DELETE').check.kind, 'deny')
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

test('photo bytes are readable by anyone who may read the catalog', () => {
  assert.equal(allows('/api/tools/42/photos', 'GET', user('viewer')), true)
  assert.equal(allows('/api/tools/42/photos/7/file', 'GET', user('viewer')), true)
})

test('adding, promoting and removing a photo needs catalog.write', () => {
  assert.equal(allows('/api/tools/42/photos', 'POST', user('viewer')), false)
  assert.equal(allows('/api/tools/42/photos', 'POST', user('editor')), true)
  assert.equal(allows('/api/tools/42/photos/7', 'PATCH', user('viewer')), false)
  assert.equal(allows('/api/tools/42/photos/7', 'PATCH', user('editor')), true)
  assert.equal(allows('/api/tools/42/photos/7', 'DELETE', user('editor')), true)
})

test('attaching an existing photo changes the card, so it needs catalog.write', () => {
  assert.equal(allows('/api/tools/42/photos/attach', 'POST', user('viewer')), false)
  assert.equal(allows('/api/tools/42/photos/attach', 'POST', user('editor')), true)
  assert.equal(routeRequirement('/api/tools/42/photos/attach', 'GET').check.kind, 'deny')
})

test('the AI cutout needs catalog.write', () => {
  assert.equal(allows('/api/tools/42/photos/7/cutout', 'POST', user('viewer')), false)
  assert.equal(allows('/api/tools/42/photos/7/cutout', 'POST', user('editor')), true)
  // It writes a photo; reading one is not a way to trigger it.
  assert.equal(routeRequirement('/api/tools/42/photos/7/cutout', 'GET').check.kind, 'deny')
})

test('the cutout preview is not a cheaper way in than the cutout itself', () => {
  const checksum = 'a'.repeat(64)

  for (const path of [
    '/api/tools/42/photos/7/cutout',
    '/api/tools/42/photos/7/cutout/preview',
    '/api/tools/42/photos/7/cutout/commit',
  ]) {
    assert.equal(allows(path, 'POST', user('viewer')), false, path)
    assert.equal(allows(path, 'POST', user('editor')), true, path)
  }

  assert.equal(
    allows(`/api/tools/42/photos/7/cutout/preview/${checksum}`, 'GET', user('editor')),
    true,
  )
  assert.equal(
    allows(`/api/tools/42/photos/7/cutout/preview/${checksum}`, 'GET', user('viewer')),
    false,
  )
  // Anything that is not a checksum is not a preview.
  assert.equal(
    routeRequirement('/api/tools/42/photos/7/cutout/preview/abc', 'GET').check.kind,
    'deny',
  )
})

test('searching the web for photos needs catalog.write, not catalog.read', () => {
  // It costs an API call and only exists to add a photo. A viewer, who could
  // not save the result, has no use for it.
  assert.equal(allows('/api/tools/42/photo-suggestions', 'GET', user('viewer')), false)
  assert.equal(allows('/api/tools/42/photo-suggestions', 'GET', user('editor')), true)
  assert.equal(allows('/api/tools/42/photo-suggestions', 'GET', null), false)
})

test('a photo path with a non-numeric id is not classified', () => {
  // The router only matches digits, so these can only arrive by hand. They
  // fall through to the fail-closed default rather than to the tools rule.
  assert.equal(routeRequirement('/api/tools/42/photos/abc', 'DELETE').check.kind, 'deny')
  assert.equal(routeRequirement('/api/tools/abc/photos', 'POST').check.kind, 'deny')
})

test('the tools rule does not leak onto a longer path', () => {
  // /api/tools/:id is one segment. Anything deeper has to be classified on its
  // own before it can be reached.
  assert.equal(routeRequirement('/api/tools/42/attachments', 'GET').check.kind, 'deny')
})

test('the domain label survives an unclassified path', () => {
  assert.equal(routeRequirement('/api/users/7/sessions', 'DELETE').domain, 'users')
})

test('cases are the catalog, read to look and write to change', () => {
  for (const path of ['/api/cases', '/api/cases/42', '/api/cases/systems']) {
    assert.equal(allows(path, 'GET', user('viewer')), true, path)
  }

  assert.equal(allows('/api/cases', 'POST', user('viewer')), false)
  assert.equal(allows('/api/cases', 'POST', user('editor')), true)
  assert.equal(allows('/api/cases/42', 'PATCH', user('viewer')), false)
  assert.equal(allows('/api/cases/42', 'DELETE', user('editor')), true)
})

test('the list of systems sits above the case detail pattern', () => {
  // Or the request would be read as a case named "systems". Both rules happen
  // to ask for the same thing today, which is exactly why the order has to be
  // asserted rather than trusted.
  assert.equal(routeRequirement('/api/cases/systems', 'GET').check.kind, 'capability')
  assert.equal(routeRequirement('/api/cases/systems', 'DELETE').check.kind, 'deny')
})

test('a photo of a case is guarded exactly like a photo of a tool', () => {
  // One handler serves both paths. A rule covering only one of them would
  // leave the other unclassified, and the guard turns unclassified into a 403
  // nobody can explain.
  for (const kind of ['tools', 'cases']) {
    assert.equal(allows(`/api/${kind}/4/photos`, 'GET', user('viewer')), true, kind)
    assert.equal(allows(`/api/${kind}/4/photos`, 'POST', user('viewer')), false, kind)
    assert.equal(allows(`/api/${kind}/4/photos`, 'POST', user('editor')), true, kind)

    // The bytes are part of the card, so anyone who may read it may see them.
    assert.equal(allows(`/api/${kind}/4/photos/9/file`, 'GET', user('viewer')), true, kind)

    // Everything that changes a card, or spends a search or cutout call.
    for (const path of [
      `/api/${kind}/4/photos/attach`,
      `/api/${kind}/4/photos/9/cutout`,
      `/api/${kind}/4/photos/9/cutout/preview`,
      `/api/${kind}/4/photos/9/cutout/commit`,
    ]) {
      assert.equal(allows(path, 'POST', user('viewer')), false, path)
      assert.equal(allows(path, 'POST', user('editor')), true, path)
    }

    assert.equal(allows(`/api/${kind}/4/photos/9`, 'DELETE', user('editor')), true, kind)
    assert.equal(allows(`/api/${kind}/4/photo-suggestions`, 'GET', user('viewer')), false, kind)
    assert.equal(allows(`/api/${kind}/4/photo-suggestions`, 'GET', user('editor')), true, kind)
  }
})

test('duplicating a tool writes a card, so it asks what writing a card asks', () => {
  assert.equal(allows('/api/tools/42/duplicate', 'POST', user('viewer')), false)
  assert.equal(allows('/api/tools/42/duplicate', 'POST', user('editor')), true)
  // There is no way to duplicate by GET, which would make a copy every time a
  // link was followed.
  assert.equal(routeRequirement('/api/tools/42/duplicate', 'GET').check.kind, 'deny')
})

test('organizers are the catalog: read to look, write to arrange', () => {
  assert.equal(allows('/api/organizers', 'GET', user('viewer')), true)
  assert.equal(allows('/api/organizers', 'POST', user('viewer')), false)
  assert.equal(allows('/api/organizers', 'POST', user('editor')), true)
  assert.equal(allows('/api/organizers/4', 'PATCH', user('editor')), true)
  assert.equal(allows('/api/organizers/4', 'DELETE', user('editor')), true)
})

test('putting a tool into an organizer is a write, and taking it out too', () => {
  // Neither touches a tool card, but both change what the catalog says is
  // where — which a viewer must not be able to do.
  assert.equal(allows('/api/organizers/4/tools', 'POST', user('viewer')), false)
  assert.equal(allows('/api/organizers/4/tools', 'POST', user('editor')), true)
  assert.equal(allows('/api/organizers/4/tools/9', 'DELETE', user('viewer')), false)
  assert.equal(allows('/api/organizers/4/tools/9', 'DELETE', user('editor')), true)
  // There is no way to read one tool's link on its own.
  assert.equal(routeRequirement('/api/organizers/4/tools/9', 'GET').check.kind, 'deny')
})
