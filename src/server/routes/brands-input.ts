// Brand bodies and list query strings. Pure; see input.ts.

import { invalid, isPlainObject, trimmedString, valid, type Parsed } from './input'

export const MAX_NAME_LENGTH = 120
export const MAX_NOTES_LENGTH = 4000

export const DEFAULT_LIMIT = 100
export const MAX_LIMIT = 500

export type BrandFields = {
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

  return valid({ name, notes })
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

  if (Object.keys(patch).length === 0) return invalid('No editable fields in request body')

  return valid(patch)
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
