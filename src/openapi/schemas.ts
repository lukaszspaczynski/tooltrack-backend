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
}
