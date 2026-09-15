// Writes docs/openapi.json.
//
// The entity schemas are not written by hand. Every one of them already has a
// TypeScript type that the server actually returns — `Tool`, `Manual`,
// `CardPhoto`, `Brand` — and a JSON Schema copied out beside it would be a
// second description of the same thing, accurate right up until somebody adds
// a column. So they are generated from those types, and the only hand-written
// schemas are the handful of inline shapes no type describes (see
// src/openapi/schemas.ts).
//
//   npm run openapi:build    write the document
//   npm run openapi:check    fail if what is checked in is out of date
//
// The document is checked in rather than generated at boot: the route that
// serves it reads a file, and the generator is a build-time dependency that has
// no business being in a running container.

import { writeFileSync, readFileSync } from 'node:fs'
import { createGenerator } from 'ts-json-schema-generator'
import { z } from 'zod'

import { buildDocument } from '../src/openapi/document'
import { REQUEST_SCHEMAS } from '../src/openapi/request-schemas'
import { HAND_WRITTEN_SCHEMAS } from '../src/openapi/schemas'
import type { Schema } from '../src/openapi/types'

const OUTPUT = 'docs/openapi.json'
// What the last release published. The compatibility test reads it; nothing
// writes it but `npm run openapi:baseline`.
const BASELINE = 'docs/openapi.baseline.json'

// The types the API answers with, and where they live. A type named here
// becomes `#/components/schemas/<name>`; everything it refers to comes along
// with it, which is why `Tool` does not have to be listed beside `ToolDetail`.
const ENTITY_TYPES: { path: string; types: string[] }[] = [
  {
    path: 'src/access/roles.ts',
    types: ['User', 'Role', 'Capability', 'AccountStatus', 'UserWithCapabilities'],
  },
  { path: 'src/server/i18n/lang.ts', types: ['Lang'] },
  { path: 'src/server/routes/auth-store.ts', types: ['SessionSummary'] },
  {
    path: 'src/server/routes/tools-store.ts',
    types: [
      // `Tool` itself is never returned alone — the list answers with
      // `ToolListItem` and everything else with `ToolDetail` — so it is not
      // named here. It still reaches the document as the base of both.
      'ToolDetail',
      'ToolListItem',
      'ToolListPage',
      'CategoryCount',
      'AttributeNameCount',
    ],
  },
  { path: 'src/server/routes/attributes-store.ts', types: ['Attribute', 'AttributeNameCount'] },
  { path: 'src/server/routes/manuals-store.ts', types: ['Manual', 'ManualLibraryPage'] },
  {
    path: 'src/server/routes/photos-store.ts',
    types: ['Photo', 'CardPhoto', 'LibraryPhoto', 'LibraryPage', 'PhotoOwner'],
  },
  { path: 'src/server/routes/brands-store.ts', types: ['Brand', 'BrandPage'] },
  {
    path: 'src/server/routes/cases-store.ts',
    types: ['ToolCase', 'LabelSlot', 'CaseListItem', 'CaseListPage', 'SystemCount'],
  },
  {
    path: 'src/server/routes/organizers-store.ts',
    types: ['Organizer', 'OrganizerPage', 'OrganizerTool', 'OrganizerLabel'],
  },
  { path: 'src/server/routes/labels-store.ts', types: ['LabelListItem', 'LabelPage'] },
  { path: 'src/server/photo-search.ts', types: ['PhotoSearchResult', 'PhotoSuggestion'] },
  {
    path: 'src/server/routes/responses.ts',
    types: [
      'CutoutPreviewResponse',
      'CutoutResponse',
      'ImportOutcome',
      'ImportResponse',
      'LabelRefreshResponse',
      'ManualAttachResponse',
      'ManualDeleteResponse',
      'ManualImportResponse',
      'OrganizerLabelRefreshResponse',
      'PhotoAttachResponse',
      'PhotoDeleteResponse',
      'PhotoImportResponse',
      'SessionResponse',
      'UserListResponse',
    ],
  },
  { path: 'src/server/routes/search-settings-store.ts', types: ['EngineSettings'] },
  {
    path: 'src/server/routes/cutout-settings-store.ts',
    types: ['CutoutSettings', 'CutoutMethodSettings'],
  },
]

function generateEntitySchemas(): Record<string, Schema> {
  const schemas: Record<string, Schema> = {}

  for (const entry of ENTITY_TYPES) {
    const generator = createGenerator({
      additionalProperties: false,
      path: entry.path,
      skipTypeCheck: true,
      tsconfig: 'tsconfig.json',
    })

    for (const type of entry.types) {
      const generated = generator.createSchema(type) as {
        definitions?: Record<string, Schema>
      }

      // The generator answers with a document per type, each carrying every
      // definition that type reaches. They are merged: a schema produced twice
      // is produced identically, and the second one is the same object.
      for (const [name, schema] of Object.entries(generated.definitions ?? {})) {
        schemas[name] = stripDraftKeywords(schema)
      }
    }
  }

  return schemas
}

// The generator emits draft-07, which OpenAPI 3.1 does not want to see: a
// `$schema` inside a component is a different dialect declaration, and `$ref`
// has to point at components rather than at `#/definitions`.
function stripDraftKeywords(schema: Schema): Schema {
  const json = JSON.stringify(schema).replaceAll('#/definitions/', '#/components/schemas/')

  return JSON.parse(json, (key, value: unknown) =>
    key === '$schema' ? undefined : value,
  ) as Schema
}

// The request bodies, converted from the Zod schemas that enforce them.
//
// `io: 'input'` rather than the default: what a client may send is the input
// side of a schema, and several of these transform on the way through — a
// measurement arrives as "4,5" and leaves as 4.5, and a contract describing the
// second would be describing what the server holds rather than what to send.
function requestSchemas(): Record<string, Schema> {
  return Object.fromEntries(
    Object.entries(REQUEST_SCHEMAS).map(([name, schema]) => {
      const generated = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>
      delete generated.$schema

      return [name, generated as Schema]
    }),
  )
}

const document = buildDocument({
  ...generateEntitySchemas(),
  ...HAND_WRITTEN_SCHEMAS,
  ...requestSchemas(),
})
const serialised = `${JSON.stringify(document, null, 2)}\n`

assertNoDanglingRefs(serialised)

// A `$ref` to a component nobody generated. Everything else in this build is
// derived, so the one thing a person still writes by hand is the name in a
// `ref('…')` — and a name with a typo, or one whose type was never added to
// ENTITY_TYPES, produced a document that looked finished and had a hole in it.
// A generator then fails on it rather than here, which is the wrong end.
function assertNoDanglingRefs(json: string): void {
  const components = document.components as Record<string, Record<string, unknown>>
  const dangling = [...json.matchAll(/"#\/components\/(\w+)\/([^"]+)"/g)]
    .map((match) => [match[1], match[2]] as const)
    .filter(([kind, name]) => components[kind]?.[name] === undefined)
    .map(([kind, name]) => `${kind}/${name}`)

  if (dangling.length === 0) return

  console.error(`${OUTPUT} references components that do not exist:`)
  for (const name of [...new Set(dangling)].sort()) console.error(`  #/components/${name}`)
  process.exit(1)
}

if (process.argv.includes('--baseline')) {
  // Deliberately a separate command, and deliberately not run by the build.
  // Moving the baseline is how a break is admitted, so it has to be something
  // somebody typed — a build that quietly kept it level with the code would
  // make the compatibility test a test of nothing.
  writeFileSync(BASELINE, serialised)
  console.log(`${BASELINE}: the released contract is now what is in the tree.`)
} else if (process.argv.includes('--check')) {
  const current = readFileSync(OUTPUT, 'utf8')
  if (current !== serialised) {
    console.error(`${OUTPUT} is out of date. Run \`npm run openapi:build\` and commit the result.`)
    process.exit(1)
  }
  console.log(`${OUTPUT} is up to date.`)
} else {
  writeFileSync(OUTPUT, serialised)
  console.log(`${OUTPUT}: ${Object.keys(document.paths).length} paths.`)
}
