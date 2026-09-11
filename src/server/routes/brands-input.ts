// Brand bodies and list query strings. Pure; see input.ts.

import { invalid, isPlainObject, trimmedString, valid, type Parsed } from './input'

export const MAX_NAME_LENGTH = 120
export const MAX_NOTES_LENGTH = 4000

export const DEFAULT_LIMIT = 100
export const MAX_LIMIT = 500

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

export function parseBrandCreate(body: unknown): Parsed<BrandFields> {
  if (!isPlainObject(body)) return invalid('Expected a JSON object')

  const name = trimmedString(body.name) ?? ''
  if (!name) return invalid('name is required')
  if (name.length > MAX_NAME_LENGTH) {
    return invalid(`name must be at most ${MAX_NAME_LENGTH} characters`)
  }

  const notes = trimmedString(body.notes ?? '')
  if (notes === null) return invalid('notes must be a string')
  if (notes.length > MAX_NOTES_LENGTH) {
    return invalid(`notes must be at most ${MAX_NOTES_LENGTH} characters`)
  }

  const color = parseColor(body.color ?? '')
  if (color === null) return invalid(COLOR_ERROR)

  return valid({ color, name, notes })
}

export function parseBrandPatch(body: unknown): Parsed<BrandPatch> {
  if (!isPlainObject(body)) return invalid('Expected a JSON object')

  const patch: BrandPatch = {}

  if ('name' in body) {
    const name = trimmedString(body.name)
    if (!name) return invalid('name must be a non-empty string')
    if (name.length > MAX_NAME_LENGTH) {
      return invalid(`name must be at most ${MAX_NAME_LENGTH} characters`)
    }
    patch.name = name
  }

  if ('notes' in body) {
    const notes = trimmedString(body.notes)
    if (notes === null) return invalid('notes must be a string')
    if (notes.length > MAX_NOTES_LENGTH) {
      return invalid(`notes must be at most ${MAX_NOTES_LENGTH} characters`)
    }
    patch.notes = notes
  }

  if ('color' in body) {
    const color = parseColor(body.color)
    if (color === null) return invalid(COLOR_ERROR)
    patch.color = color
  }

  if (Object.keys(patch).length === 0) return invalid('No editable fields in request body')

  return valid(patch)
}

const COLOR_ERROR = 'color must be #rrggbb, "r g b", or empty'

// One colour, two spellings accepted. A leading colour is read off a logo or a
// brand book, where it is given as three numbers; CSS wants it as hex. Both
// arrive here and one form is stored, so a search or a comparison cannot miss
// because somebody wrote the same colour differently.
//
// Null means "not a colour", which the caller turns into a 400. An empty
// string is a colour nobody has said, and is allowed.
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

// The logo is a picture that already exists — the same library everything else
// draws from, so a logo can be uploaded, searched for or cut out like anything
// else before it is pointed at here.
export function parseLogo(body: unknown): Parsed<number> {
  if (!isPlainObject(body)) return invalid('Expected a JSON object')

  const raw = body.photoId
  const value = typeof raw === 'string' ? Number(raw.trim()) : raw
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    return invalid('photoId must be the id of a photo')
  }

  return valid(value)
}

export function parseBrandQuery(params: URLSearchParams): Parsed<BrandQuery> {
  return valid({
    direction: params.get('order')?.trim().toLowerCase() === 'desc' ? 'desc' : 'asc',
    limit: clampInteger(params.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT),
    offset: clampInteger(params.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER),
    search: params.get('q')?.trim() || null,
    sort: params.get('sort')?.trim() === 'tools' ? 'tools' : 'name',
  })
}

function clampInteger(raw: null | string, fallback: number, min: number, max: number): number {
  const value = Number(raw)
  if (!raw || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), min), max)
}
