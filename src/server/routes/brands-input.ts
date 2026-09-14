// Brand bodies and list query strings. Pure; see input.ts.

import { z } from 'zod'
import { clampLimit, clampOffset, BRAND_PAGING } from './paging'

import { invalid, NOT_AN_OBJECT, parseWith, valid, type Parsed } from './input'

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
  sort: 'name' | 'tools'
}

const COLOR_ERROR = 'color must be #rrggbb, "r g b", or empty'

// One colour, two spellings accepted. A leading colour is read off a logo or a
// brand book, where it is given as three numbers; CSS wants it as hex. Both
// arrive here and one form is stored, so a search or a comparison cannot miss
// because somebody wrote the same colour differently.
//
// Null means "not a colour", which the schema turns into a 400. An empty string
// is a colour nobody has said, and is allowed.
export function parseColor(raw: unknown): null | string {
  if (raw === null || raw === undefined) return ''

  const value = typeof raw === 'string' ? raw.trim() : raw
  if (typeof value !== 'string') return null
  if (value === '') return ''

  const hex = /^#?([0-9a-f]{6})$/i.exec(value)
  if (hex) return `#${hex[1].toLowerCase()}`

  // "18 36 71", "18,36,71", "rgb(18, 36, 71)" — all three turn up when the
  // number is copied from somewhere.
  const parts = value
    .replace(/^rgb\s*\(/i, '')
    .replace(/\)$/, '')
    .split(/[\s,]+/)
    .filter(Boolean)
  if (parts.length !== 3) return null

  const channels: number[] = []
  for (const part of parts) {
    const channel = Number(part)
    if (!Number.isInteger(channel) || channel < 0 || channel > 255) return null
    channels.push(channel)
  }

  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

// The two spellings are both strings on the wire, so that is what the contract
// says; which of them this is gets decided by the transform, not by the type.
const COLOR = z
  .string()
  .nullable()
  .transform((raw) => parseColor(raw))
  .refine((value): value is string => value !== null, { error: () => COLOR_ERROR })

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
    { color: COLOR.optional(), name: NAME.optional(), notes: NOTES.optional() },
    NOT_AN_OBJECT,
  )
  .strip()

export const BRAND_CREATE_SCHEMA = z
  .object({ color: COLOR.optional(), name: NAME, notes: NOTES.optional() }, NOT_AN_OBJECT)
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
    sort: params.get('sort')?.trim() === 'tools' ? 'tools' : 'name',
  })
}
