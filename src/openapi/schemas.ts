// The schemas that are written rather than generated.
//
// Everything with a TypeScript type behind it — Tool, Manual, Photo, Brand —
// is generated from that type by scripts/build-openapi.ts, because a schema
// copied out by hand is a schema that drifts the first time somebody adds a
// column. What is here is the handful of shapes a handler builds inline and no
// type describes, which is exactly the set worth naming here instead.

import { object } from './operation'
import type { Schema } from './types'

export const HAND_WRITTEN_SCHEMAS: Record<string, Schema> = {
  // What GET /api/tools/import/sources answers with, derived in the importer
  // registry from the scripts themselves.
  ImportSource: object({
    host: { description: 'The host an address is matched against.', type: 'string' },
    label: { description: 'What the dialog shows.', type: 'string' },
    manuals: {
      description: 'Whether this source publishes documents at all.',
      type: 'boolean',
    },
  }),

  // What came with an imported card, reported beside it rather than instead of
  // it: one photograph that would not download does not lose the other fifteen.
  ImportOutcome: object({
    attributes: { description: 'Parameters written to the card.', type: 'integer' },
    attributesFailed: {
      description: 'The names of parameters the card refused, usually a duplicate.',
      items: { type: 'string' },
      type: 'array',
    },
    manuals: { description: 'Documents fetched and stored.', type: 'integer' },
    manualsFailed: { description: 'Documents that would not download.', type: 'integer' },
    photos: {
      description:
        'Photographs fetched and stored. Always 0 when refreshing an existing card, whose photographs are deliberately untouched.',
      type: 'integer',
    },
    photosFailed: {
      description: 'Photographs that would not download or decode.',
      type: 'integer',
    },
    sourceUrl: {
      description: 'The address the card was read from, without its analytics tail.',
      format: 'uri',
      type: 'string',
    },
  }),

  // The body of POST /api/auth/login and /register, which answer with the
  // account rather than with the cookie: the cookie is httpOnly and on the
  // response headers, where a browser picks it up without the client seeing it.
  SessionResponse: object({
    capabilities: { items: { $ref: '#/components/schemas/Capability' }, type: 'array' },
    effectiveRole: {
      anyOf: [{ $ref: '#/components/schemas/Role' }, { type: 'null' }],
    },
    user: { $ref: '#/components/schemas/User' },
  }),
}
