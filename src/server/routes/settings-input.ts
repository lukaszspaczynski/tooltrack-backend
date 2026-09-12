// Bodies for the search engine settings. Pure; see input.ts.

import { invalid, isPlainObject, valid, type Parsed } from './input'
import { CUTOUT_METHODS, isCutoutMethod } from '../cutout-methods'
import { MAX_RESULT_LIMIT } from '../search-engines'

export type GlobalEngineInput = {
  apiKey?: string
  apiSecret?: string
  enabled?: boolean
  resultLimit?: number
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

  if ('resultLimit' in body) {
    const limit = Number(body.resultLimit)
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RESULT_LIMIT) {
      return invalid(`resultLimit must be a whole number between 1 and ${MAX_RESULT_LIMIT}`)
    }
    // Refused past our ceiling, quietly lowered to the provider's own: one is
    // somebody typing nonsense, the other is Google not answering with more
    // than ten however politely it is asked.
    input.resultLimit = limit
  }

  if (Object.keys(input).length === 0) return invalid('No editable fields in request body')

  return valid(input)
}

export function parseUserEngineInput(body: unknown): Parsed<{ enabled: boolean }> {
  if (!isPlainObject(body)) return invalid('Expected a JSON object')
  if (typeof body.enabled !== 'boolean') return invalid('enabled must be true or false')

  return valid({ enabled: body.enabled })
}

export type CutoutMethodInput = {
  apiKey?: string
  enabled?: boolean
}

// One method's switch and key, mirroring the search engine form.
export function parseCutoutMethodInput(body: unknown): Parsed<CutoutMethodInput> {
  if (!isPlainObject(body)) return invalid('Expected a JSON object')

  const input: CutoutMethodInput = {}

  if ('enabled' in body) {
    if (typeof body.enabled !== 'boolean') return invalid('enabled must be true or false')
    input.enabled = body.enabled
  }

  // An absent key leaves the stored one alone; an empty string clears it.
  if ('apiKey' in body) {
    if (typeof body.apiKey !== 'string') return invalid('apiKey must be a string')
    input.apiKey = body.apiKey.trim()
  }

  if (Object.keys(input).length === 0) return invalid('No editable fields in request body')

  return valid(input)
}

export function parseCutoutThresholdInput(body: unknown): Parsed<{ threshold: number }> {
  if (!isPlainObject(body)) return invalid('Expected a JSON object')

  const threshold = Number(body.threshold)
  // 765 is pure white: above it every pixel is background and the cutout would
  // refuse every photo.
  if (!Number.isInteger(threshold) || threshold <= 0 || threshold > 765) {
    return invalid('threshold must be a whole number between 1 and 765')
  }

  return valid({ threshold })
}

export type CutoutRunInput = {
  method?: 'gemini' | 'local' | 'removebg'
  padding?: number
  removeBgType?: 'auto' | 'product'
  threshold?: number
}

// The body of one run from the cutout screen. Everything is optional: an empty
// body means "decide for me", which is what the one-click wand sends.
export function parseCutoutRunInput(body: unknown): Parsed<CutoutRunInput> {
  if (body === null || body === undefined) return valid({})
  if (!isPlainObject(body)) return invalid('Expected a JSON object')

  const input: CutoutRunInput = {}

  if ('method' in body && body.method !== undefined) {
    if (!isCutoutMethod(body.method)) {
      return invalid(`method must be one of: ${CUTOUT_METHODS.join(', ')}`)
    }
    input.method = body.method
  }

  if ('threshold' in body && body.threshold !== undefined) {
    const threshold = Number(body.threshold)
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 765) {
      return invalid('threshold must be a whole number between 1 and 765')
    }
    input.threshold = threshold
  }

  if ('padding' in body && body.padding !== undefined) {
    const padding = Number(body.padding)
    if (!Number.isInteger(padding) || padding < 0 || padding > 200) {
      return invalid('padding must be a whole number between 0 and 200')
    }
    input.padding = padding
  }

  if ('removeBgType' in body && body.removeBgType !== undefined) {
    if (body.removeBgType !== 'auto' && body.removeBgType !== 'product') {
      return invalid('removeBgType must be auto or product')
    }
    input.removeBgType = body.removeBgType
  }

  return valid(input)
}

// The body of a save: the checksum of a preview the server produced. Nothing
// else — the bytes are already on disk, and naming them by content is what
// makes the save unable to invent a photo that was never previewed.
export function parseCutoutCommitInput(body: unknown): Parsed<{ checksum: string }> {
  if (!isPlainObject(body)) return invalid('Expected a JSON object')

  const checksum = typeof body.checksum === 'string' ? body.checksum.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{64}$/.test(checksum)) return invalid('checksum is not a valid sha256')

  return valid({ checksum })
}
