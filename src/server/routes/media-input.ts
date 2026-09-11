// Query and body parsing for the photo library. Pure; see input.ts.

import { invalid, isPlainObject, valid, type Parsed } from './input'
import { PHOTO_SOURCES, type PhotoSource } from './photos-store'

export const DEFAULT_MEDIA_LIMIT = 48
export const MAX_MEDIA_LIMIT = 200
// A bulk delete is a form submission, not a data migration. The cap keeps one
// mis-click from taking the whole library, and keeps the transaction short.
export const MAX_DELETE_IDS = 200

export type MediaQuery = {
  // Null means both: photos with a tool and photos still waiting for one.
  assigned: boolean | null
  direction: 'asc' | 'desc'
  limit: number
  offset: number
  search: null | string
  source: null | PhotoSource
}

export function isPhotoSource(value: unknown): value is PhotoSource {
  return typeof value === 'string' && (PHOTO_SOURCES as readonly string[]).includes(value)
}

export function parseMediaQuery(params: URLSearchParams): Parsed<MediaQuery> {
  const source = params.get('source')?.trim()
  if (source && !isPhotoSource(source)) {
    return invalid(`source must be one of: ${PHOTO_SOURCES.join(', ')}`)
  }

  const assigned = params.get('assigned')?.trim()
  if (assigned && assigned !== 'true' && assigned !== 'false') {
    return invalid('assigned must be true or false')
  }

  return valid({
    assigned: assigned ? assigned === 'true' : null,
    // Newest first: the library is opened right after an import went wrong.
    direction: params.get('order')?.trim().toLowerCase() === 'asc' ? 'asc' : 'desc',
    limit: clamp(params.get('limit'), DEFAULT_MEDIA_LIMIT, 1, MAX_MEDIA_LIMIT),
    offset: clamp(params.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER),
    // Matches the tool the photo belongs to, not the photo: a picture has no
    // name of its own, and "which tool was this" is the question people ask.
    search: params.get('q')?.trim() || null,
    source: source ? (source as PhotoSource) : null,
  })
}

// The body of an attach: which existing photos to put on a tool. Same shape
// and same cap as a delete — it is a selection from the same screen.
export function parseAttachIds(body: unknown): Parsed<number[]> {
  if (!isPlainObject(body) || !Array.isArray(body.photoIds)) {
    return invalid('Expected { "photoIds": [1, 2, 3] }')
  }

  return parseIdList(body.photoIds, 'Nie zaznaczono żadnego zdjęcia')
}

export function parseDeleteIds(body: unknown): Parsed<number[]> {
  if (!isPlainObject(body) || !Array.isArray(body.ids)) {
    return invalid('Expected { "ids": [1, 2, 3] }')
  }

  return parseIdList(body.ids, 'Nie zaznaczono żadnego zdjęcia')
}

function parseIdList(raw: unknown[], emptyMessage: string): Parsed<number[]> {
  if (raw.length === 0) return invalid(emptyMessage)
  if (raw.length > MAX_DELETE_IDS) return invalid(`Maksymalnie ${MAX_DELETE_IDS} zdjęć naraz`)

  const ids: number[] = []
  for (const value of raw) {
    const id = Number(value)
    if (!Number.isSafeInteger(id) || id <= 0) {
      return invalid(`Nieprawidłowy identyfikator: ${value}`)
    }
    // Duplicates in the selection are the client's business, not the
    // database's: it would count the same row twice.
    if (!ids.includes(id)) ids.push(id)
  }

  return valid(ids)
}

function clamp(value: null | string, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (value === null || value.trim() === '' || !Number.isInteger(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}
