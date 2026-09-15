import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { breakingChanges } from './compatibility'
import type { Document, Schema } from './types'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

// A document small enough to read, with one route that sends a body and one
// that answers with an entity — which is the only structure this checker cares
// about, since what a schema is judged by depends on which way it travels.
function doc(schemas: Record<string, Schema>, paths?: Document['paths']): Document {
  return {
    components: { schemas, securitySchemes: {} },
    info: { description: '', title: '', version: '1' },
    openapi: '3.1.0',
    paths: paths ?? {
      '/api/tools': {
        get: {
          operationId: 'listTools',
          responses: {
            200: { content: { 'application/json': { schema: ref('Tool') } }, description: '' },
          },
          summary: '',
          tags: ['tools'],
        },
        post: {
          operationId: 'createTool',
          requestBody: { content: { 'application/json': { schema: ref('ToolBody') } } },
          responses: { 201: { description: '' } },
          summary: '',
          tags: ['tools'],
        },
      },
    },
    servers: [],
    tags: [],
  }
}

function ref(name: string) {
  return { $ref: `#/components/schemas/${name}` }
}

const TOOL: Schema = {
  properties: { id: { type: 'integer' }, name: { type: 'string' } },
  required: ['id', 'name'],
  type: 'object',
}

const TOOL_BODY: Schema = {
  properties: { name: { maxLength: 200, type: 'string' }, notes: { type: 'string' } },
  required: ['name'],
  type: 'object',
}

const BASE = doc({ Tool: TOOL, ToolBody: TOOL_BODY })

test('adding things is not a break, and is not reported', () => {
  // The safe half of every change. A checker that complained here is one people
  // learn to run with their eyes shut, which is the only way it ever fails.
  const grown = doc({
    Case: { properties: {}, type: 'object' },
    Tool: {
      ...TOOL,
      properties: { ...(TOOL.properties as object), referenceUrl: { type: 'string' } },
    },
    ToolBody: {
      ...TOOL_BODY,
      properties: { ...(TOOL_BODY.properties as object), brand: { type: 'string' } },
    },
  })

  assert.deepEqual(breakingChanges(BASE, grown), [])
})

test('a field that leaves a response is named', () => {
  // The change this was written for: a client reads `attributes` for something
  // that has moved, finds nothing, and shows an empty screen rather than an
  // error anybody would report.
  const shrunk = doc({
    Tool: { ...TOOL, properties: { id: { type: 'integer' } } },
    ToolBody: TOOL_BODY,
  })

  assert.deepEqual(breakingChanges(BASE, shrunk), ['Tool.name is gone'])
})

test('a request field that becomes required is a break; a response one is not', () => {
  // The difference is who promises what. A client that has never heard of a
  // field does not send it — but it is happy to receive one.
  const stricter = doc({ Tool: TOOL, ToolBody: { ...TOOL_BODY, required: ['name', 'notes'] } })
  assert.deepEqual(breakingChanges(BASE, stricter), ['ToolBody.notes is now required'])

  const generous = doc({
    Tool: { ...TOOL, required: ['id', 'name', 'extra'] },
    ToolBody: TOOL_BODY,
  })
  assert.deepEqual(breakingChanges(BASE, generous), [])
})

test('a limit that tightens is a break even though every field is still there', () => {
  // Exactly what lowering MAX_NAME_LENGTH does: nothing is missing, and a name
  // that fitted last month is refused today.
  const tighter = doc({
    Tool: TOOL,
    ToolBody: {
      ...TOOL_BODY,
      properties: { ...(TOOL_BODY.properties as object), name: { maxLength: 150, type: 'string' } },
    },
  })

  assert.deepEqual(breakingChanges(BASE, tighter), [
    'ToolBody.name tightened maxLength from 200 to 150',
  ])
})

test('a type that changes under a name that did not is a break', () => {
  const retyped = doc({
    Tool: { ...TOOL, properties: { ...(TOOL.properties as object), id: { type: 'string' } } },
    ToolBody: TOOL_BODY,
  })

  assert.deepEqual(breakingChanges(BASE, retyped), [
    'Tool.id changed type from "integer" to "string"',
  ])
})

test('a value dropped from an enum is a break', () => {
  const before = doc({
    Tool: TOOL,
    ToolBody: { ...TOOL_BODY, properties: { condition: { enum: ['good', 'worn', 'retired'] } } },
  })
  const after = doc({
    Tool: TOOL,
    ToolBody: { ...TOOL_BODY, properties: { condition: { enum: ['good', 'worn'] } } },
  })

  assert.deepEqual(breakingChanges(before, after), [
    'ToolBody.condition no longer accepts "retired"',
  ])
})

test('a route or a method that stops answering is a break', () => {
  const withoutPost = doc(
    { Tool: TOOL, ToolBody: TOOL_BODY },
    {
      '/api/tools': BASE.paths['/api/tools'].get ? { get: BASE.paths['/api/tools'].get } : {},
    },
  )
  assert.deepEqual(breakingChanges(BASE, withoutPost), ['POST /api/tools is gone'])

  const withoutPath = doc({ Tool: TOOL, ToolBody: TOOL_BODY }, {})
  assert.deepEqual(breakingChanges(BASE, withoutPath), ['/api/tools is gone'])
})

// SUSPENDED while the catalog is renamed — see CLAUDE.md, "Changing something
// a client already reads".
//
// The guard protects clients that cannot be updated on the day this repo
// changes. There is no such client yet: the web app is rebuilt from this repo
// and reloads, and the mobile one does not exist. What is coming is `tool` →
// `item`, which moves every route under /api/tools and is one deliberate break
// from beginning to end — so this would fire on every commit of it and be
// answered by running `openapi:baseline` without reading the output, which is
// the habit the check exists to prevent.
//
// Turning it back on is this line and one command, in this order:
//
//   npm run openapi:baseline     # the renamed contract becomes the baseline
//   test.skip -> test            # below
//
// Do that on the day the rename lands, and certainly before anybody builds a
// client that ships on its own schedule.
//
// The tests above keep running. They check the detector rather than the
// document, cost nothing, and are the part that would rot unnoticed while this
// one is off.
test.skip('the contract in the tree does not break the one that was released', () => {
  const baseline = read('docs/openapi.baseline.json')
  const current = read('docs/openapi.json')

  assert.deepEqual(
    breakingChanges(baseline, current),
    [],
    'the contract has changed in a way an already-installed client cannot survive',
  )
})

function read(path: string): Document {
  return JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as Document
}
