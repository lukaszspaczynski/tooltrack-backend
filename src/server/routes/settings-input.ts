// Bodies for the search engine settings. Pure; see input.ts.

import { z } from 'zod'

import { invalid, NOT_AN_OBJECT, parseWith, valid, type Parsed } from './input'
import { CUTOUT_METHODS } from '../cutout-methods'
import { MAX_RESULT_LIMIT } from '../search-engines'

export type GlobalEngineInput = {
  apiKey?: string
  apiSecret?: string
  enabled?: boolean
  resultLimit?: number
}

const TRIMMED_SECRET = (field: string) =>
  z
    .string({ error: () => `${field} must be a string` })
    .trim()
    // An absent field leaves the stored credential alone; an empty string
    // clears it. The form relies on that: it never receives a key from the
    // server, so it cannot send one back, and leaving the input untouched must
    // not wipe what is saved.
    .optional()

export const GLOBAL_ENGINE_SCHEMA = z
  .object(
    {
      apiKey: TRIMMED_SECRET('apiKey'),
      apiSecret: TRIMMED_SECRET('apiSecret'),
      enabled: z.boolean({ error: () => 'enabled must be true or false' }).optional(),
      resultLimit: z.coerce
        .number({
          error: () => `resultLimit must be a whole number between 1 and ${MAX_RESULT_LIMIT}`,
        })
        .int({
          error: () => `resultLimit must be a whole number between 1 and ${MAX_RESULT_LIMIT}`,
        })
        .min(1, {
          error: () => `resultLimit must be a whole number between 1 and ${MAX_RESULT_LIMIT}`,
        })
        .max(MAX_RESULT_LIMIT, {
          error: () => `resultLimit must be a whole number between 1 and ${MAX_RESULT_LIMIT}`,
        })
        .optional(),
    },
    NOT_AN_OBJECT,
  )
  .strip()

export function parseGlobalEngineInput(body: unknown): Parsed<GlobalEngineInput> {
  const parsed = parseWith(GLOBAL_ENGINE_SCHEMA, body)
  if (!parsed.ok) return parsed

  if (Object.keys(parsed.value).length === 0) {
    return invalid('No editable fields in request body')
  }

  return parsed
}

export const USER_ENGINE_SCHEMA = z
  .object({ enabled: z.boolean({ error: () => 'enabled must be true or false' }) }, NOT_AN_OBJECT)
  .strip()

export function parseUserEngineInput(body: unknown): Parsed<{ enabled: boolean }> {
  return parseWith(USER_ENGINE_SCHEMA, body)
}

export type CutoutMethodInput = {
  apiKey?: string
  enabled?: boolean
}

// One method's switch and key, mirroring the search engine form.
export const CUTOUT_METHOD_SCHEMA = z
  .object(
    {
      apiKey: TRIMMED_SECRET('apiKey'),
      enabled: z.boolean({ error: () => 'enabled must be true or false' }).optional(),
    },
    NOT_AN_OBJECT,
  )
  .strip()

export function parseCutoutMethodInput(body: unknown): Parsed<CutoutMethodInput> {
  const parsed = parseWith(CUTOUT_METHOD_SCHEMA, body)
  if (!parsed.ok) return parsed

  if (Object.keys(parsed.value).length === 0) {
    return invalid('No editable fields in request body')
  }

  return parsed
}

// 765 is pure white: above it every pixel is background and the cutout would
// refuse every photo.
const THRESHOLD_ERROR = 'threshold must be a whole number between 1 and 765'

export const CUTOUT_THRESHOLD_SCHEMA = z
  .object(
    {
      threshold: z.coerce
        .number({ error: () => THRESHOLD_ERROR })
        .int({ error: () => THRESHOLD_ERROR })
        .min(1, { error: () => THRESHOLD_ERROR })
        .max(765, { error: () => THRESHOLD_ERROR }),
    },
    NOT_AN_OBJECT,
  )
  .strip()

export function parseCutoutThresholdInput(body: unknown): Parsed<{ threshold: number }> {
  return parseWith(CUTOUT_THRESHOLD_SCHEMA, body)
}

export type CutoutRunInput = {
  method?: 'gemini' | 'local' | 'removebg'
  padding?: number
  removeBgType?: 'auto' | 'product'
  threshold?: number
}

// The body of one run from the cutout screen. Everything is optional: an empty
// body means "decide for me", which is what the one-click wand sends.
// Overrides for one run only. Everything is optional, and an absent body — or
// none at all — uses the settings an admin configured.
export const CUTOUT_RUN_SCHEMA = z
  .object(
    {
      method: z
        .enum(CUTOUT_METHODS, {
          error: () => `method must be one of: ${CUTOUT_METHODS.join(', ')}`,
        })
        .optional(),
      padding: z.coerce
        .number({ error: () => 'padding must be a whole number between 0 and 200' })
        .int({ error: () => 'padding must be a whole number between 0 and 200' })
        .min(0, { error: () => 'padding must be a whole number between 0 and 200' })
        .max(200, { error: () => 'padding must be a whole number between 0 and 200' })
        .optional(),
      removeBgType: z
        .enum(['auto', 'product'], { error: () => 'removeBgType must be auto or product' })
        .optional(),
      threshold: z.coerce
        .number({ error: () => THRESHOLD_ERROR })
        .int({ error: () => THRESHOLD_ERROR })
        .min(1, { error: () => THRESHOLD_ERROR })
        .max(765, { error: () => THRESHOLD_ERROR })
        .optional(),
    },
    NOT_AN_OBJECT,
  )
  .strip()

export function parseCutoutRunInput(body: unknown): Parsed<CutoutRunInput> {
  // No body at all is how the screen says "use the settings".
  if (body === null || body === undefined) return valid({})

  return parseWith(CUTOUT_RUN_SCHEMA, body)
}

// The body of a save: the checksum of a preview the server produced. Nothing
// else — the bytes are already on disk, and naming them by content is what
// makes the save unable to invent a photo that was never previewed.
export const CUTOUT_COMMIT_SCHEMA = z
  .object(
    {
      checksum: z
        .string({ error: () => 'checksum is not a valid sha256' })
        .trim()
        .toLowerCase()
        .regex(/^[0-9a-f]{64}$/, { error: () => 'checksum is not a valid sha256' }),
    },
    NOT_AN_OBJECT,
  )
  .strip()

export function parseCutoutCommitInput(body: unknown): Parsed<{ checksum: string }> {
  return parseWith(CUTOUT_COMMIT_SCHEMA, body)
}
