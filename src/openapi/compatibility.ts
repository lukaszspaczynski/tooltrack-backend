// What changed between the contract that was released and the one in the tree,
// and whether any of it would break a client already written against the first.
//
// This exists because of the second consumer. The web client is rebuilt from
// this repo and reloads; a phone in somebody's pocket is whatever version they
// installed, and it cannot be asked to change on the day the API does. So a
// removal has to be a decision somebody made out loud rather than something
// noticed later by a screen that quietly went blank.
//
// Additions are silent on purpose. Adding a field, a route or a response is the
// safe half of every change, and a check that complained about them would be a
// check people learn to ignore — which is the only way this kind of test fails.
//
// The baseline is `docs/openapi.baseline.json`, and `npm run openapi:baseline`
// moves it. Doing that in the same commit as the break is how a break is
// admitted: it shows up in review as "this changes the contract", with the
// reason in the message beside it.

import type { Document, Reference, Schema } from './types'

// Request schemas and response schemas are disjoint here, which is what lets
// the two be judged by different rules. Bodies are the `*Body` objects
// generated from the Zod schemas; everything a route answers with is an entity
// type generated from TypeScript. Nothing is both, and this walk is what keeps
// that an observation rather than an assumption.
type Direction = 'request' | 'response'

export function breakingChanges(baseline: Document, current: Document): string[] {
  return [...missingRoutes(baseline, current), ...schemaChanges(baseline, current)]
}

// A path or a method that used to answer and no longer does. The bluntest break
// there is: an old client calls it and gets a 404 or a 405.
function missingRoutes(baseline: Document, current: Document): string[] {
  const broken: string[] = []

  for (const [path, item] of Object.entries(baseline.paths)) {
    const now = current.paths[path]
    if (!now) {
      broken.push(`${path} is gone`)
      continue
    }

    for (const method of Object.keys(item)) {
      if (!(method in now)) broken.push(`${method.toUpperCase()} ${path} is gone`)
    }
  }

  return broken
}

function schemaChanges(baseline: Document, current: Document): string[] {
  const before = baseline.components.schemas
  const after = current.components.schemas
  const direction = directionsOf(baseline)
  const broken: string[] = []

  for (const [name, schema] of Object.entries(before)) {
    const now = after[name]
    if (!now) {
      // Something pointed at it, or the build would have refused the document.
      broken.push(`schema ${name} is gone`)
      continue
    }

    broken.push(...compareSchema(name, asSchema(schema), asSchema(now), direction.get(name)))
  }

  return broken
}

function compareSchema(
  name: string,
  before: Schema,
  after: Schema,
  direction: Direction | undefined,
): string[] {
  const broken: string[] = []

  const oldProperties = properties(before)
  const newProperties = properties(after)

  for (const [property, shape] of Object.entries(oldProperties)) {
    const now = newProperties[property]

    if (!now) {
      // In a response this is a field a client reads and will stop finding. In
      // a request it is one the server will stop honouring, which is worse than
      // an error — the call succeeds and does less than it used to.
      broken.push(`${name}.${property} is gone`)
      continue
    }

    broken.push(...compareProperty(`${name}.${property}`, shape, now))
  }

  // A field a client has never heard of, which it therefore does not send.
  // Harmless on a response, where required only means the server promises it.
  if (direction === 'request') {
    const wasRequired = new Set(required(before))
    for (const property of required(after)) {
      if (!wasRequired.has(property)) broken.push(`${name}.${property} is now required`)
    }
  }

  return broken
}

function compareProperty(where: string, before: Schema, after: Schema): string[] {
  const broken: string[] = []

  if (JSON.stringify(before.type) !== JSON.stringify(after.type)) {
    broken.push(`${where} changed type from ${show(before.type)} to ${show(after.type)}`)
  }

  // A value the client may still send, or one a client's exhaustive switch was
  // written around.
  const gone = valuesOf(before.enum).filter((value) => !valuesOf(after.enum).includes(value))
  if (gone.length > 0) broken.push(`${where} no longer accepts ${gone.map(show).join(', ')}`)

  // Tightened bounds. A name that fitted last month and is refused today is a
  // break even though every field is still there — this is exactly what
  // lowering MAX_NAME_LENGTH does.
  for (const [key, tighter] of [
    ['maxLength', lower],
    ['maximum', lower],
    ['minLength', higher],
    ['minimum', higher],
  ] as const) {
    const was = before[key]
    const now = after[key]
    if (typeof was === 'number' && typeof now === 'number' && tighter(was, now)) {
      broken.push(`${where} tightened ${key} from ${was} to ${now}`)
    }
  }

  return broken
}

// Which schemas a caller sends and which it reads, followed through `$ref` so
// that a body built out of three smaller schemas counts all three.
function directionsOf(document: Document): Map<string, Direction> {
  const found = new Map<string, Direction>()

  for (const item of Object.values(document.paths)) {
    for (const operation of Object.values(item)) {
      for (const ref of refsIn(operation.requestBody)) mark(ref, 'request')
      for (const ref of refsIn(operation.responses)) mark(ref, 'response')
    }
  }

  return found

  function mark(name: string, direction: Direction): void {
    if (found.has(name)) return
    found.set(name, direction)

    for (const nested of refsIn(document.components.schemas[name])) mark(nested, direction)
  }
}

function refsIn(value: unknown): string[] {
  const names: string[] = []

  JSON.stringify(value, (_key, nested: unknown) => {
    const ref = (nested as Reference | null)?.$ref
    if (typeof ref === 'string' && ref.startsWith('#/components/schemas/')) {
      names.push(ref.slice('#/components/schemas/'.length))
    }
    return nested
  })

  return names
}

function properties(schema: Schema): Record<string, Schema> {
  const value = schema.properties
  return value && typeof value === 'object' ? (value as Record<string, Schema>) : {}
}

function required(schema: Schema): string[] {
  return Array.isArray(schema.required) ? (schema.required as string[]) : []
}

function valuesOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asSchema(value: Reference | Schema): Schema {
  return value as Schema
}

function lower(was: number, now: number): boolean {
  return now < was
}

function higher(was: number, now: number): boolean {
  return now > was
}

function show(value: unknown): string {
  return JSON.stringify(value) ?? String(value)
}
