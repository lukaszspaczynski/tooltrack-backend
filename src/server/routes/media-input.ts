// Query and body parsing for the photo library. Pure; see input.ts.

import { z } from 'zod'
import { clampLimit, clampOffset, MEDIA_PAGING } from './paging'

import { invalid, NOT_AN_OBJECT, parseWith, valid, type Parsed } from './input'
import { PHOTO_SOURCES, type PhotoSource } from './photos-store'
import { t } from '../i18n'

export const DEFAULT_MEDIA_LIMIT = MEDIA_PAGING.default
export const MAX_MEDIA_LIMIT = MEDIA_PAGING.max
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
// One shape, two field names: an attach is a selection from the same screen as
// a delete and is capped the same way.
function idListSchema(field: 'ids' | 'photoIds') {
  const shape = `Expected { "${field}": [1, 2, 3] }`

  return z
    .object(
      {
        [field]: z
          .array(z.unknown(), { error: () => shape })
          .min(1, { error: () => t('Nie zaznaczono żadnego zdjęcia') })
          .max(MAX_DELETE_IDS, {
            error: () => t('Maksymalnie {max} zdjęć naraz', { max: MAX_DELETE_IDS }),
          }),
      },
      { error: () => shape },
    )
    .strip()
}

export const ATTACH_IDS_SCHEMA = idListSchema('photoIds')
export const DELETE_IDS_SCHEMA = idListSchema('ids')

export function parseAttachIds(body: unknown): Parsed<number[]> {
  const parsed = parseWith(ATTACH_IDS_SCHEMA, body)

  return parsed.ok ? parseIdList(parsed.value.photoIds as unknown[]) : parsed
}

export function parseDeleteIds(body: unknown): Parsed<number[]> {
  const parsed = parseWith(DELETE_IDS_SCHEMA, body)

  return parsed.ok ? parseIdList(parsed.value.ids as unknown[]) : parsed
}

function parseIdList(raw: unknown[]): Parsed<number[]> {
  const ids: number[] = []
  for (const value of raw) {
    const id = Number(value)
    if (!Number.isSafeInteger(id) || id <= 0) {
      return invalid(t('Nieprawidłowy identyfikator: {value}', { value: String(value) }))
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
