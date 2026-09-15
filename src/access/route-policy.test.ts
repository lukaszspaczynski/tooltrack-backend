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
    language: 'pl',
    role,
    status,
  }
}

function allows(pathname: string, method: string, actor: null | User): boolean {
  return satisfiesRequirement(actor, routeRequirement(pathname, method))
}

test('the catalog is readable by every role and writable by editor and admin', () => {
  for (const path of ['/api/items', '/api/items/42', '/api/items/categories']) {
    assert.equal(allows(path, 'GET', user('viewer')), true, path)
  }

  assert.equal(allows('/api/items', 'POST', user('viewer')), false)
  assert.equal(allows('/api/items', 'POST', user('editor')), true)
  assert.equal(allows('/api/items/42', 'PATCH', user('viewer')), false)
  assert.equal(allows('/api/items/42', 'PATCH', user('editor')), true)
  assert.equal(allows('/api/items/42', 'DELETE', user('editor')), true)
  assert.equal(allows('/api/items/42', 'DELETE', user('admin')), true)
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
  // Uploading a photo that belongs to no item is still writing to the catalog.
  assert.equal(allows('/api/photos', 'POST', user('viewer')), false)
  assert.equal(allows('/api/photos', 'POST', user('editor')), true)
  // Bytes by photo id, for the photos that have no item to be reached through.
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
    ['/api/items', 'GET'],
    ['/api/items', 'POST'],
    ['/api/items/42', 'GET'],
    ['/api/users', 'GET'],
  ] as const) {
    assert.equal(allows(path, method, null), false, `${method} ${path}`)
  }
})

test('a disabled account is refused even where its role would allow it', () => {
  assert.equal(allows('/api/items', 'GET', user('admin', 'disabled')), false)
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
  const requirement = routeRequirement('/api/items/42/history', 'GET')

  assert.equal(requirement.check.kind, 'deny')
  assert.equal(satisfiesRequirement(user('admin'), requirement), false)
})

test('a method a route does not implement is denied', () => {
  assert.equal(routeRequirement('/api/items', 'DELETE').check.kind, 'deny')
  assert.equal(routeRequirement('/api/users', 'POST').check.kind, 'deny')
  assert.equal(allows('/api/users', 'POST', user('admin')), false)
})

test('a trailing slash is the same route', () => {
  assert.deepEqual(routeRequirement('/api/items/', 'GET'), routeRequirement('/api/items', 'GET'))
})

test('photo bytes are readable by anyone who may read the catalog', () => {
  assert.equal(allows('/api/items/42/photos', 'GET', user('viewer')), true)
  assert.equal(allows('/api/items/42/photos/7/file', 'GET', user('viewer')), true)
})

test('adding, promoting and removing a photo needs catalog.write', () => {
  assert.equal(allows('/api/items/42/photos', 'POST', user('viewer')), false)
  assert.equal(allows('/api/items/42/photos', 'POST', user('editor')), true)
  assert.equal(allows('/api/items/42/photos/7', 'PATCH', user('viewer')), false)
  assert.equal(allows('/api/items/42/photos/7', 'PATCH', user('editor')), true)
  assert.equal(allows('/api/items/42/photos/7', 'DELETE', user('editor')), true)
})

test('attaching an existing photo changes the card, so it needs catalog.write', () => {
  assert.equal(allows('/api/items/42/photos/attach', 'POST', user('viewer')), false)
  assert.equal(allows('/api/items/42/photos/attach', 'POST', user('editor')), true)
  assert.equal(routeRequirement('/api/items/42/photos/attach', 'GET').check.kind, 'deny')
})

test('the AI cutout needs catalog.write', () => {
  assert.equal(allows('/api/items/42/photos/7/cutout', 'POST', user('viewer')), false)
  assert.equal(allows('/api/items/42/photos/7/cutout', 'POST', user('editor')), true)
  // It writes a photo; reading one is not a way to trigger it.
  assert.equal(routeRequirement('/api/items/42/photos/7/cutout', 'GET').check.kind, 'deny')
})

test('the cutout preview is not a cheaper way in than the cutout itself', () => {
  const checksum = 'a'.repeat(64)

  for (const path of [
    '/api/items/42/photos/7/cutout',
    '/api/items/42/photos/7/cutout/preview',
    '/api/items/42/photos/7/cutout/commit',
  ]) {
    assert.equal(allows(path, 'POST', user('viewer')), false, path)
    assert.equal(allows(path, 'POST', user('editor')), true, path)
  }

  assert.equal(
    allows(`/api/items/42/photos/7/cutout/preview/${checksum}`, 'GET', user('editor')),
    true,
  )
  assert.equal(
    allows(`/api/items/42/photos/7/cutout/preview/${checksum}`, 'GET', user('viewer')),
    false,
  )
  // Anything that is not a checksum is not a preview.
  assert.equal(
    routeRequirement('/api/items/42/photos/7/cutout/preview/abc', 'GET').check.kind,
    'deny',
  )
})

test('searching the web for photos needs catalog.write, not catalog.read', () => {
  // It costs an API call and only exists to add a photo. A viewer, who could
  // not save the result, has no use for it.
  assert.equal(allows('/api/items/42/photo-suggestions', 'GET', user('viewer')), false)
  assert.equal(allows('/api/items/42/photo-suggestions', 'GET', user('editor')), true)
  assert.equal(allows('/api/items/42/photo-suggestions', 'GET', null), false)
})

test('a photo path with a non-numeric id is not classified', () => {
  // The router only matches digits, so these can only arrive by hand. They
  // fall through to the fail-closed default rather than to the items rule.
  assert.equal(routeRequirement('/api/items/42/photos/abc', 'DELETE').check.kind, 'deny')
  assert.equal(routeRequirement('/api/items/abc/photos', 'POST').check.kind, 'deny')
})

test('the items rule does not leak onto a longer path', () => {
  // /api/items/:id is one segment. Anything deeper has to be classified on its
  // own before it can be reached.
  assert.equal(routeRequirement('/api/items/42/attachments', 'GET').check.kind, 'deny')
})

test('the domain label survives an unclassified path', () => {
  assert.equal(routeRequirement('/api/users/7/sessions', 'DELETE').domain, 'users')
})

test('the boxes are the catalog too, under the one set of item rules', () => {
  // /api/cases is gone: a case is a card, so it is read and written by the
  // rules every other card is. Nothing here is about a kind — the routes are
  // the same routes.
  assert.equal(routeRequirement('/api/cases', 'GET').check.kind, 'deny')
  assert.equal(routeRequirement('/api/cases/42', 'GET').check.kind, 'deny')
})

test('the list of models sits above the item detail pattern', () => {
  // Or the request would be read as a card named "models". Both rules happen
  // to ask for the same thing today, which is exactly why the order has to be
  // asserted rather than trusted.
  assert.equal(routeRequirement('/api/items/models', 'GET').check.kind, 'capability')
  assert.equal(allows('/api/items/models', 'GET', user('viewer')), true)
  assert.equal(routeRequirement('/api/items/models', 'DELETE').check.kind, 'deny')
})

test('a photograph is guarded like the card it hangs on', () => {
  // These were two sets of paths while a case was a table of its own, and one
  // handler served both. One card now, one set — and the loop stays because
  // the list of what must be classified is the point.
  for (const kind of ['items']) {
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

test('duplicating an item writes a card, so it asks what writing a card asks', () => {
  assert.equal(allows('/api/items/42/duplicate', 'POST', user('viewer')), false)
  assert.equal(allows('/api/items/42/duplicate', 'POST', user('editor')), true)
  // There is no way to duplicate by GET, which would make a copy every time a
  // link was followed.
  assert.equal(routeRequirement('/api/items/42/duplicate', 'GET').check.kind, 'deny')
})

test('organizers are the catalog: read to look, write to arrange', () => {
  assert.equal(allows('/api/organizers', 'GET', user('viewer')), true)
  assert.equal(allows('/api/organizers', 'POST', user('viewer')), false)
  assert.equal(allows('/api/organizers', 'POST', user('editor')), true)
  assert.equal(allows('/api/organizers/4', 'PATCH', user('editor')), true)
  assert.equal(allows('/api/organizers/4', 'DELETE', user('editor')), true)
})

test('putting an item into an organizer is a write, and taking it out too', () => {
  // Neither touches an item card, but both change what the catalog says is
  // where — which a viewer must not be able to do.
  assert.equal(allows('/api/organizers/4/items', 'POST', user('viewer')), false)
  assert.equal(allows('/api/organizers/4/items', 'POST', user('editor')), true)
  assert.equal(allows('/api/organizers/4/items/9', 'DELETE', user('viewer')), false)
  assert.equal(allows('/api/organizers/4/items/9', 'DELETE', user('editor')), true)
  // There is no way to read one item's link on its own.
  assert.equal(routeRequirement('/api/organizers/4/items/9', 'GET').check.kind, 'deny')
})

test('makers are the catalog: read to look, write to change', () => {
  assert.equal(allows('/api/brands', 'GET', user('viewer')), true)
  assert.equal(allows('/api/brands', 'POST', user('viewer')), false)
  assert.equal(allows('/api/brands', 'POST', user('editor')), true)
  assert.equal(allows('/api/brands/4', 'PATCH', user('editor')), true)
  assert.equal(allows('/api/brands/4', 'DELETE', user('editor')), true)
})

test('pointing a logo at a picture is a write, and so is taking it away', () => {
  assert.equal(allows('/api/brands/4/logo', 'PUT', user('viewer')), false)
  assert.equal(allows('/api/brands/4/logo', 'PUT', user('editor')), true)
  assert.equal(allows('/api/brands/4/logo', 'DELETE', user('editor')), true)
  // There is no reading of a logo on its own — it comes with the brand.
  assert.equal(routeRequirement('/api/brands/4/logo', 'GET').check.kind, 'deny')
})

test('where labels go is part of the card, and guarded like one', () => {
  assert.equal(allows('/api/items/4/label-slots', 'POST', user('viewer')), false)
  assert.equal(allows('/api/items/4/label-slots', 'POST', user('editor')), true)
  assert.equal(allows('/api/items/4/label-slots/9', 'DELETE', user('editor')), true)
  // They come with the card, so there is nothing to read on its own.
  assert.equal(routeRequirement('/api/items/4/label-slots', 'GET').check.kind, 'deny')
})

test('labels are read with the catalog and drawn with a write', () => {
  assert.equal(allows('/api/organizers/4/label-slots', 'GET', user('viewer')), true)
  assert.equal(allows('/api/organizers/4/labels', 'POST', user('viewer')), false)
  assert.equal(allows('/api/organizers/4/labels', 'POST', user('editor')), true)
  // The PDF itself is part of the catalog, like the bytes of a photo, and so
  // is the picture of it the list shows.
  assert.equal(allows('/api/organizers/4/labels/9/file', 'GET', user('viewer')), true)
  assert.equal(allows('/api/organizers/4/labels/9/preview', 'GET', user('viewer')), true)
  assert.equal(allows('/api/organizers/4/labels/9', 'DELETE', user('editor')), true)

  // Drawing them again writes the same files, so it costs the same capability
  // — and 'refresh' must not fall through to some reader's rule.
  assert.equal(allows('/api/organizers/4/labels/refresh', 'POST', user('viewer')), false)
  assert.equal(allows('/api/organizers/4/labels/refresh', 'POST', user('editor')), true)
})

test("the whole shelf of labels is read and redrawn like one organizer's", () => {
  assert.equal(allows('/api/labels', 'GET', user('viewer')), true)
  assert.equal(allows('/api/labels', 'POST', user('editor')), false)
  assert.equal(allows('/api/labels/refresh', 'POST', user('viewer')), false)
  assert.equal(allows('/api/labels/refresh', 'POST', user('editor')), true)

  // The sheet only rearranges labels that exist, so it is a read — and 'sheet'
  // must not fall through to the list's rule or to the refresh's.
  assert.equal(allows('/api/labels/sheet', 'GET', user('viewer')), true)
  assert.equal(allows('/api/labels/sheet', 'POST', user('editor')), false)
})
