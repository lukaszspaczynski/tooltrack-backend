// Bodies for the search engine settings. Pure; see input.ts.

import { invalid, isPlainObject, valid, type Parsed } from './input'

export type GlobalEngineInput = {
  apiKey?: string
  apiSecret?: string
  enabled?: boolean
}

export function parseGlobalEngineInput(body: unknown): Parsed<GlobalEngineInput> {
  if (!isPlainObject(body)) return invalid('Expected a JSON object')

  const input: GlobalEngineInput = {}

  if ('enabled' in body) {
    if (typeof body.enabled !== 'boolean') return invalid('enabled must be true or false')
    input.enabled = body.enabled
  }

  // An absent field leaves the stored credential alone; an empty string clears
  // it. The form relies on that: it never receives a key from the server, so
  // it cannot send one back, and leaving the input untouched must not wipe
  // what is saved.
  for (const field of ['apiKey', 'apiSecret'] as const) {
    if (!(field in body)) continue
    if (typeof body[field] !== 'string') return invalid(`${field} must be a string`)
    input[field] = (body[field] as string).trim()
  }

  if (Object.keys(input).length === 0) return invalid('No editable fields in request body')

  return valid(input)
}

export function parseUserEngineInput(body: unknown): Parsed<{ enabled: boolean }> {
  if (!isPlainObject(body)) return invalid('Expected a JSON object')
  if (typeof body.enabled !== 'boolean') return invalid('enabled must be true or false')

  return valid({ enabled: body.enabled })
}
