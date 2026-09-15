// Assembling the OpenAPI document out of the operation table, the generated
// entity schemas and the access policy.
//
// Three things are derived rather than written down, because each is a fact the
// server already holds and a spec that restates one can disagree with it:
//
//   the path parameters   from the route itself
//   the security          from src/access/route-policy.ts, by calling it
//   the entity schemas    from the TypeScript types, by scripts/build-openapi
//
// What is left to write by hand is what no machine knows: what an endpoint is
// for, which failures it can actually produce, and what the request body means.

import { routeRequirement } from '../access/route-policy'
import { sampleOf } from '../server/route-list'
import { APP_VERSION } from '../version'
import {
  ACCEPT_LANGUAGE_PARAM,
  CLIENT_PARAM,
  ERROR_RESPONSES,
  ERROR_SCHEMA,
  SECURITY_SCHEMES,
  TAGS,
} from './components'
import { OPERATIONS } from './operations'
import { errors, type OperationSpec } from './operation'
import type { Document, Method, Operation, Parameter, PathItem, Response, Schema } from './types'

export function buildDocument(entitySchemas: Record<string, Schema>): Document {
  const paths: Record<string, PathItem> = {}

  for (const spec of OPERATIONS) {
    const { method, path } = splitRoute(spec.route)
    const openapiPath = path.replace(/:([A-Za-z]\w*)/g, '{$1}')

    const item = (paths[openapiPath] ??= {})
    if (item[method]) throw new Error(`${spec.route} is in the operation table twice`)

    item[method] = operationFor(spec, method, path)
  }

  return {
    components: {
      responses: ERROR_RESPONSES,
      schemas: { Error: ERROR_SCHEMA, ...entitySchemas },
      securitySchemes: SECURITY_SCHEMES,
    },
    info: {
      description: [
        'The HTTP contract of the ToolTrack catalog: one card per physical tool,',
        'searchable from a phone on site, with three roles deciding who may look',
        'and who may change things.',
        '',
        'Every route but the handful tagged `public` needs the session cookie that',
        '`POST /api/auth/login` sets. Prose in a response — including the `error`',
        'field — follows the `Accept-Language` header, so it is never something to',
        'branch on; the status code is.',
      ].join('\n'),
      license: { identifier: 'UNLICENSED', name: 'Proprietary' },
      title: 'ToolTrack API',
      version: APP_VERSION,
    },
    openapi: '3.1.0',
    paths: sortKeys(paths),
    servers: [
      { description: 'Local development', url: 'http://localhost:37411' },
      { description: 'The deployed instance', url: '/' },
    ],
    tags: TAGS,
  }
}

function operationFor(spec: OperationSpec, method: Method, path: string): Operation {
  const parameters = [
    ...pathParameters(spec, path),
    ...(spec.query ?? []),
    ACCEPT_LANGUAGE_PARAM,
    CLIENT_PARAM,
  ]

  return {
    description: spec.description,
    operationId: spec.operationId,
    parameters,
    requestBody: spec.requestBody,
    responses: { ...spec.responses, ...staleClientResponse(path, method) },
    security: securityFor(path, method),
    summary: spec.summary,
    tags: [spec.tag],
  }
}

// The 426 every route can answer, derived rather than written into eighty-odd
// operation specs — and derived from the same policy call the guard makes, so
// the document cannot claim a route is exempt when the guard does not think so.
//
// The `public` family is the exemption: the guard lets /healthz, /api/version
// and the contract through whatever build is asking, because those are how
// somebody works out what is wrong with a build that is too old.
function staleClientResponse(path: string, method: Method): Record<string, Response> {
  const requirement = routeRequirement(sampleOf(path), method.toUpperCase())

  return requirement.domain === 'public' ? {} : errors(426)
}

// The path parameters, read off the route. Every one has to be described: a
// caller reading `{id}` with nothing beside it has learned only that it exists.
function pathParameters(spec: OperationSpec, path: string): Parameter[] {
  const names = [...path.matchAll(/:([A-Za-z]\w*)/g)].map((match) => match[1])
  const described = spec.pathParams ?? {}

  return names.map((name) => {
    const declared = described[name]
    if (!declared) {
      throw new Error(`${spec.route} does not say what :${name} is`)
    }

    return {
      description: typeof declared === 'string' ? declared : declared.description,
      in: 'path' as const,
      name,
      required: true,
      schema: typeof declared === 'string' ? schemaForName(name) : declared.schema,
    }
  })
}

// A row id is digits — that is the shape of every `id`, `photoId`, `slotId` and
// the rest — and anything else in a path is a name rather than a number. The
// guard's patterns say the same thing, which is why a route whose parameter is
// described as an integer but matched as a word would fail to classify.
function schemaForName(name: string): Schema {
  return /^id$|Id$/.test(name) ? { minimum: 1, type: 'integer' } : { type: 'string' }
}

// Asked of the same table the guard asks, with the parameters filled in by
// something that matches: the policy patterns take digits for an id, so a
// concrete path has to be built before it can be classified.
function securityFor(path: string, method: Method): Operation['security'] {
  const concrete = sampleOf(path)
  const requirement = routeRequirement(concrete, method.toUpperCase())

  switch (requirement.check.kind) {
    case 'allow':
      // An empty list is how OpenAPI spells "this one needs nothing", and it
      // has to be written out or the caller inherits the document default.
      return []
    case 'capability':
      // Two entries rather than one object with two keys: a list is OR in
      // OpenAPI and an object is AND, so this says "a cookie or a bearer
      // token", which is what the guard does. Written once here and every
      // route gets it, which is the reason this function calls the policy
      // instead of restating it.
      return [
        { sessionCookie: [requirement.check.capability] },
        { bearerAuth: [requirement.check.capability] },
      ]
    case 'deny':
      throw new Error(
        `${method.toUpperCase()} ${path} is in the operation table but the route policy denies it`,
      )
  }
}

export function splitRoute(route: string): { method: Method; path: string } {
  const [method, path] = route.split(' ')
  if (!method || !path) throw new Error(`"${route}" is not a route`)

  return { method: method.toLowerCase() as Method, path }
}

function sortKeys<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
}
