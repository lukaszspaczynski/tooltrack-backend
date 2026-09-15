// Brand bodies and list query strings. Pure; see input.ts.

import { z } from 'zod'
import { clampLimit, clampOffset, BRAND_PAGING } from './paging'

import { COLOR_SCHEMA, parseColor } from './color'
import { invalid, NOT_AN_OBJECT, parseWith, valid, type Parsed } from './input'

// Re-exported: a brand colour is the catalog's colour rule, and callers of
// this module should not have to know it moved.
export { parseColor } from './color'

export const MAX_NAME_LENGTH = 120
export const MAX_NOTES_LENGTH = 4000

export const DEFAULT_LIMIT = BRAND_PAGING.default
export const MAX_LIMIT = BRAND_PAGING.max

export type BrandFields = {
  // '#rrggbb', lowercase, or '' for a maker whose colour nobody has said.
  color: string
  name: string
  notes: string
}

export type BrandPatch = Partial<BrandFields>

export type BrandQuery = {
  direction: 'asc' | 'desc'
  limit: number
  offset: number
  search: null | string
  sort: 'name' | 'items'
}

// The two spellings are both strings on the wire, so that is what the contract
// says; which of them this is gets decided by the transform, not by the type.

const NAME = z
  .string({ error: () => 'name must be a non-empty string' })
  .trim()
  .min(1, { error: () => 'name must be a non-empty string' })
  .max(MAX_NAME_LENGTH, { error: () => `name must be at most ${MAX_NAME_LENGTH} characters` })

const NOTES = z
  .string({ error: () => 'notes must be a string' })
  .trim()
  .max(MAX_NOTES_LENGTH, { error: () => `notes must be at most ${MAX_NOTES_LENGTH} characters` })

export const BRAND_PATCH_SCHEMA = z
  .object(
    { color: COLOR_SCHEMA.optional(), name: NAME.optional(), notes: NOTES.optional() },
    NOT_AN_OBJECT,
  )
  .strip()

export const BRAND_CREATE_SCHEMA = z
  .object({ color: COLOR_SCHEMA.optional(), name: NAME, notes: NOTES.optional() }, NOT_AN_OBJECT)
  .strip()

// The logo is a picture that already exists — the same library everything else
// draws from, so a logo can be uploaded, searched for or cut out like anything
// else before it is pointed at here. A form sends "12", so a string is taken.
export const LOGO_SCHEMA = z
  .object(
    {
      photoId: z
        .union([z.number(), z.string()])
        .transform((raw) => (typeof raw === 'string' ? Number(raw.trim()) : raw))
        .refine((value) => Number.isSafeInteger(value) && value > 0, {
          error: () => 'photoId must be the id of a photo',
        }),
    },
    NOT_AN_OBJECT,
  )
  .strip()

export function parseBrandCreate(body: unknown): Parsed<BrandFields> {
  const parsed = parseWith(BRAND_CREATE_SCHEMA, body)
  if (!parsed.ok) return parsed

  return valid({
    color: parsed.value.color ?? '',
    name: parsed.value.name,
    notes: parsed.value.notes ?? '',
  })
}

export function parseBrandPatch(body: unknown): Parsed<BrandPatch> {
  const parsed = parseWith(BRAND_PATCH_SCHEMA, body)
  if (!parsed.ok) return parsed

  if (Object.keys(parsed.value).length === 0) {
    return invalid('No editable fields in request body')
  }

  return parsed
}

export function parseLogo(body: unknown): Parsed<number> {
  const parsed = parseWith(LOGO_SCHEMA, body)

  return parsed.ok ? valid(parsed.value.photoId) : parsed
}

// A bad value in the query string is clamped or dropped rather than refused:
// a pasted link should still show the shelf. That is why this is not a schema —
// Zod refuses, and what this wants is to forgive.
export function parseBrandQuery(params: URLSearchParams): Parsed<BrandQuery> {
  return valid({
    direction: params.get('order')?.trim().toLowerCase() === 'desc' ? 'desc' : 'asc',
    limit: clampLimit(params.get('limit'), BRAND_PAGING),
    offset: clampOffset(params.get('offset')),
    search: params.get('q')?.trim() || null,
    sort: params.get('sort')?.trim() === 'items' ? 'items' : 'name',
  })
}
