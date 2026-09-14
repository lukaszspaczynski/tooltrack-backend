// Just enough of OpenAPI 3.1 to describe this API, written out rather than
// depended on. The published type packages carry every corner of the
// specification — callbacks, links, XML, discriminators — and this server uses
// none of them; what it does use fits on a page and is checked by the compiler
// the same way.
//
// A schema is left as `unknown`-ish on purpose: the entity schemas are
// generated from the TypeScript types in scripts/build-openapi.ts, and pinning
// their shape here would mean maintaining a second JSON Schema type by hand.

export type Method = 'delete' | 'get' | 'patch' | 'post' | 'put'

export type Schema = Record<string, unknown>

export type Reference = { $ref: string }

export type MediaType = {
  example?: unknown
  schema: Reference | Schema
}

export type Parameter = {
  description?: string
  example?: unknown
  in: 'header' | 'path' | 'query'
  name: string
  required?: boolean
  schema: Schema
}

export type RequestBody = {
  content: Record<string, MediaType>
  description?: string
  required?: boolean
}

export type Response = {
  content?: Record<string, MediaType>
  description: string
  headers?: Record<string, { description?: string; schema: Schema }>
}

export type Operation = {
  description?: string
  operationId: string
  parameters?: Parameter[]
  requestBody?: RequestBody
  responses: Record<string, Response>
  security?: Record<string, string[]>[]
  summary: string
  tags: string[]
}

export type PathItem = Partial<Record<Method, Operation>>

export type Document = {
  components: {
    parameters?: Record<string, Parameter>
    responses?: Record<string, Response>
    schemas: Record<string, Reference | Schema>
    securitySchemes: Record<string, Schema>
  }
  info: {
    contact?: { name?: string; url?: string }
    description: string
    license?: { identifier?: string; name: string }
    title: string
    version: string
  }
  openapi: '3.1.0'
  paths: Record<string, PathItem>
  servers: { description?: string; url: string }[]
  tags: { description: string; name: string }[]
}
