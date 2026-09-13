// Manual bodies. Pure; see input.ts.

import { t } from '../i18n'
import { invalid, isPlainObject, trimmedString, valid, type Parsed } from './input'

export const MAX_MANUAL_TITLE_LENGTH = 200
export const MAX_MANUAL_URL_LENGTH = 2000

export function parseManualUrl(body: unknown): Parsed<{ title: string; url: string }> {
  if (!isPlainObject(body)) return invalid('Expected a JSON object')

  const url = trimmedString(body.url)
  if (!url) return invalid('url is required')
  if (url.length > MAX_MANUAL_URL_LENGTH) {
    return invalid(`url must be at most ${MAX_MANUAL_URL_LENGTH} characters`)
  }

  const title = trimmedString(body.title) ?? ''
  if (title.length > MAX_MANUAL_TITLE_LENGTH) {
    return invalid(`title must be at most ${MAX_MANUAL_TITLE_LENGTH} characters`)
  }

  return valid({ title, url })
}

// Renaming one. Blank is refused rather than stored: a manual with no title is
// a row nobody can tell from the one under it.
export function parseManualTitle(body: unknown): Parsed<string> {
  if (!isPlainObject(body)) return invalid('Expected a JSON object')

  const title = trimmedString(body.title)
  if (!title) return invalid('title must be a non-empty string')
  if (title.length > MAX_MANUAL_TITLE_LENGTH) {
    return invalid(`title must be at most ${MAX_MANUAL_TITLE_LENGTH} characters`)
  }

  return valid(title)
}

export const DEFAULT_MANUAL_LIMIT = 24
export const MAX_MANUAL_LIMIT = 200
export const MAX_DELETE_MANUALS = 50

export type ManualQuery = {
  limit: number
  offset: number
  search: null | string
}

// The library's query string. Like every other list here, a bad value is
// clamped or dropped rather than refused: a pasted link should still show the
// shelf.
export function parseManualQuery(params: URLSearchParams): ManualQuery {
  return {
    limit: clampInteger(params.get('limit'), DEFAULT_MANUAL_LIMIT, 1, MAX_MANUAL_LIMIT),
    offset: clampInteger(params.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER),
    search: params.get('q')?.trim() || null,
  }
}

export function parseManualIds(body: unknown): Parsed<number[]> {
  if (!isPlainObject(body) || !Array.isArray(body.ids)) {
    return invalid('Expected { "ids": [1, 2, 3] }')
  }
  if (body.ids.length === 0) return invalid(t('Nie zaznaczono żadnej instrukcji'))
  if (body.ids.length > MAX_DELETE_MANUALS) {
    return invalid(t('Maksymalnie {max} instrukcji naraz', { max: MAX_DELETE_MANUALS }))
  }

  const ids: number[] = []
  for (const raw of body.ids) {
    const id = Number(raw)
    if (!Number.isSafeInteger(id) || id <= 0) {
      return invalid(t('Nieprawidłowy identyfikator: {value}', { value: String(raw) }))
    }
    if (!ids.includes(id)) ids.push(id)
  }

  return valid(ids)
}

function clampInteger(raw: null | string, fallback: number, min: number, max: number): number {
  const value = Number(raw)
  if (!raw || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), min), max)
}
