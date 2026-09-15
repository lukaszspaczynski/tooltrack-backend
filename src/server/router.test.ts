import assert from 'node:assert/strict'
import test from 'node:test'

import { routeRequirement } from '../access/route-policy'
import { ROUTES, sampleOf } from './route-list'
import { matchRoute } from './router'

const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const

// A route lives in four places: this table, matchRoute, the policy, and the
// OpenAPI operations. The coverage test in src/openapi already ties the first
// and the last together. These tie in the two in the middle, so that adding a
// route and forgetting one of them fails here rather than at three separate
// moments in somebody's afternoon — which is exactly how it went the last time
// anybody tried it.

test('every route in the list reaches a handler', () => {
  const unreachable = [...ROUTES].filter((route) => {
    const [method, template] = route.split(' ')
    const path = sampleOf(template)
    return !matchRoute(path, method)?.handler
  })

  assert.deepEqual(unreachable, [])
})

test('every route in the list is classified by the policy', () => {
  // An unclassified route is refused, which is the design — but a route in the
  // list that nobody classified is one somebody meant to expose.
  const denied = [...ROUTES].filter((route) => {
    const [method, template] = route.split(' ')
    const path = sampleOf(template)
    return routeRequirement(path, method).check.kind === 'deny'
  })

  assert.deepEqual(denied, [])
})

test('the router answers no method the list does not promise', () => {
  // The other direction. A handler wired up for a method nobody wrote down is
  // a route with no entry in the contract and no line in the policy — reachable
  // and undescribed, which is the worst of the four states.
  const listed = new Set<string>(ROUTES)
  const extra: string[] = []

  for (const route of ROUTES) {
    const template = route.split(' ')[1]
    const path = sampleOf(template)

    for (const method of METHODS) {
      if (!matchRoute(path, method)?.handler) continue
      if (!listed.has(`${method} ${template}`)) extra.push(`${method} ${template}`)
    }
  }

  assert.deepEqual([...new Set(extra)].sort(), [])
})

test('a trailing slash reaches the same handler', () => {
  assert.ok(matchRoute('/api/items/', 'GET')?.handler)
  assert.ok(matchRoute('/api/items', 'GET')?.handler)
})

test('the allow header of a 405 lists what the path does implement', () => {
  // `/api/items` is a GET and a POST and nothing else, and the 405 has to say
  // so or a client cannot work out what it did wrong.
  const match = matchRoute('/api/items', 'DELETE')

  assert.equal(match?.handler, null)
  assert.deepEqual(match?.allow, ['GET', 'POST'])
})

test('a photo route carries the card and the photograph', () => {
  // There were two sets of these while a case was a table of its own, and
  // which set a request came from arrived as a parameter the pattern could not
  // capture. One card now: what the path says is what the path captures.
  assert.deepEqual(matchRoute('/api/items/7/photos', 'GET')?.params, { id: '7' })
  assert.deepEqual(matchRoute('/api/items/7/photos/3/file', 'GET')?.params, {
    id: '7',
    photoId: '3',
  })
})

test('a path that is not a route is not one', () => {
  // An id is digits. Anything else is a path that does not exist, which is what
  // keeps `/api/items/../..` from reaching a handler.
  assert.equal(matchRoute('/api/items/abc', 'GET'), null)
  assert.equal(matchRoute('/api/items/1/photos/1/cutout/preview/zz', 'GET'), null)
})
