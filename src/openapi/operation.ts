// What one endpoint is, before it becomes OpenAPI.
//
// The route is spelled exactly as src/server/index.ts spells it — `:id` and
// all — so the table there and the table here can be compared by a test rather
// than by somebody remembering. The builder rewrites it to `{id}` on the way
// out, which is the only place that translation happens.
//
// What is deliberately absent is `security`. An operation does not get to have
// an opinion about who may call it: that lives in src/access/route-policy.ts,
// and the builder reads it from there by calling the same function the guard
// calls. A spec that restates an access rule is a spec that can disagree with
// the server about one.

import type { MediaType, Parameter, RequestBody, Response, Schema } from './types'

export type PathParam = string | { description: string; schema: Schema }

export type OperationSpec = {
  description?: string
  operationId: string
  // Path parameters by name, with what each one is. Every `:name` in the route
  // has to appear here — the builder refuses a path parameter nobody described,
  // because "id" on its own tells a caller nothing.
  //
  // A plain string is the description, and the schema is worked out from the
  // name: this API's path parameters are integers except where they are not.
  // The object form is for the exceptions worth being precise about — a
  // provider or a method is one of a fixed few, and a generated client should
  // be able to say so.
  pathParams?: Record<string, PathParam>
  query?: Parameter[]
  requestBody?: RequestBody
  responses: Record<string, Response>
  // 'GET /api/tools/:id', as ROUTES writes it.
  route: string
  summary: string
  tag: string
}

// The entity schemas are generated from the TypeScript types; this is how an
// operation points at one without importing the generated file.
export function ref(name: string): { $ref: string } {
  return { $ref: `#/components/schemas/${name}` }
}

export function jsonResponse(description: string, schema: MediaType['schema']): Response {
  return { content: { 'application/json': { schema } }, description }
}

// A response whose body is the file itself rather than anything about it.
export function binaryResponse(description: string, ...contentTypes: string[]): Response {
  return {
    content: Object.fromEntries(
      contentTypes.map((type) => [type, { schema: { format: 'binary', type: 'string' } }]),
    ),
    description,
  }
}

export function jsonBody(schema: MediaType['schema'], description?: string): RequestBody {
  return { content: { 'application/json': { schema } }, description, required: true }
}

// An object literal response, for the handful of endpoints that answer with a
// shape too small to be worth a name of its own in components.
export function object(properties: Record<string, Schema>, required?: string[]): Schema {
  return {
    additionalProperties: false,
    properties,
    required: required ?? Object.keys(properties),
    type: 'object',
  }
}

export function envelope(key: string, schema: MediaType['schema']): Schema {
  return {
    additionalProperties: false,
    properties: { [key]: schema },
    required: [key],
    type: 'object',
  }
}

export function arrayOf(schema: MediaType['schema']): Schema {
  return { items: schema, type: 'array' }
}

// The shared failures, by the status they come back as. Every operation names
// the ones it can actually produce rather than inheriting a blanket list: a
// caller reading "409" on an endpoint that cannot conflict learns something
// false.
export function errors(...statuses: number[]): Record<string, Response> {
  return Object.fromEntries(
    statuses.map((status) => [
      String(status),
      { $ref: `#/components/responses/${status}` } as unknown as Response,
    ]),
  )
}

export function queryParam(
  name: string,
  description: string,
  schema: Schema,
  example?: unknown,
): Parameter {
  return { description, example, in: 'query', name, schema }
}
