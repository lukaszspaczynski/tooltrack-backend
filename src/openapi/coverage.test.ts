import assert from 'node:assert/strict'
import test from 'node:test'

import { routeRequirement } from '../access/route-policy'
import { ROUTES } from '../server/route-list'
import { buildDocument, sampleOf, splitRoute } from './document'
import { DESCRIBED, OPERATIONS, PENDING } from './operations'

// The document is built here with empty entity schemas: what these tests are
// about is the operation table, and generating schemas would mean running the
// TypeScript compiler inside a test.
const document = buildDocument({})

test('every route is either described or knowingly not', () => {
  // The point of PENDING. A route added tomorrow lands in neither list and
  // fails here, which is the only way a spec stays honest about its own gaps.
  const accounted = [...DESCRIBED, ...PENDING].sort()

  assert.deepEqual(accounted, [...ROUTES].sort())
})

test('nothing is both described and pending', () => {
  const both = DESCRIBED.filter((route) => PENDING.includes(route))

  assert.deepEqual(both, [])
})

test('no route is described twice', () => {
  assert.equal(new Set(DESCRIBED).size, DESCRIBED.length)
})

test('an operation id is unique, because a generator names a method after it', () => {
  const ids = OPERATIONS.map((operation) => operation.operationId)

  assert.equal(new Set(ids).size, ids.length)
})

test('the security of an operation is the policy, not a copy of it', () => {
  // Derived by calling the same function the guard calls, so this asserts the
  // derivation rather than the values — but a route the policy denies would
  // have thrown while the document was being built, which is the real check.
  for (const operation of OPERATIONS) {
    const { method, path } = splitRoute(operation.route)
    const requirement = routeRequirement(sampleOf(path), method.toUpperCase())
    const described = document.paths[path.replace(/:([A-Za-z]\w*)/g, '{$1}')]?.[method]?.security

    if (requirement.check.kind === 'allow') {
      assert.deepEqual(described, [], `${operation.route} should need nothing`)
      continue
    }

    assert.ok(requirement.check.kind === 'capability')
    assert.deepEqual(
      described,
      [{ sessionCookie: [requirement.check.capability] }],
      `${operation.route} should need ${requirement.check.capability}`,
    )
  }
})

test('every path parameter is described', () => {
  // buildDocument throws on one that is not, so reaching here is the assertion.
  for (const [path, item] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      const names = [...path.matchAll(/\{(\w+)\}/g)].map((match) => match[1])
      const described = (operation.parameters ?? [])
        .filter((parameter) => parameter.in === 'path')
        .map((parameter) => parameter.name)

      assert.deepEqual(described, names, `${method.toUpperCase()} ${path}`)
    }
  }
})

test('every operation says what it is for and can fail', () => {
  for (const operation of OPERATIONS) {
    assert.ok(operation.summary, `${operation.route} has no summary`)
    assert.ok(
      Object.keys(operation.responses).length > 0,
      `${operation.route} lists no responses at all`,
    )
    assert.ok(
      Object.keys(operation.responses).some((status) => status.startsWith('2')),
      `${operation.route} never succeeds`,
    )
  }
})

test('a guarded operation says how it is refused', () => {
  // A client generated against this has to know that 401 and 403 are real
  // answers on every route behind the session, or it will treat them as bugs.
  for (const operation of OPERATIONS) {
    const { method, path } = splitRoute(operation.route)
    const security = document.paths[path.replace(/:([A-Za-z]\w*)/g, '{$1}')]?.[method]?.security
    if (!security?.length) continue

    const statuses = Object.keys(operation.responses)
    assert.ok(statuses.includes('401'), `${operation.route} does not document a 401`)
  }
})

test('the document names itself and the server it came from', () => {
  assert.equal(document.openapi, '3.1.0')
  assert.ok(document.info.version)
  assert.ok(document.servers.length > 0)
  assert.ok(document.components.securitySchemes.sessionCookie)
})

test('every tag an operation uses is declared', () => {
  const declared = new Set(document.tags.map((tag) => tag.name))

  for (const operation of OPERATIONS) {
    assert.ok(
      declared.has(operation.tag),
      `${operation.route} uses undeclared tag ${operation.tag}`,
    )
  }
})
