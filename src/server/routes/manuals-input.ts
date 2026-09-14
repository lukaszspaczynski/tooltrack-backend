// Manual bodies. Pure; see input.ts.

import { z } from 'zod'

import { t } from '../i18n'
import { invalid, NOT_AN_OBJECT, parseWith, valid, type Parsed } from './input'

export const MAX_MANUAL_TITLE_LENGTH = 200
export const MAX_MANUAL_URL_LENGTH = 2000

const TITLE = z
  .string({ error: () => 'title must be a non-empty string' })
  .trim()
  .max(MAX_MANUAL_TITLE_LENGTH, {
    error: () => `title must be at most ${MAX_MANUAL_TITLE_LENGTH} characters`,
  })

export const MANUAL_URL_SCHEMA = z
  .object(
    {
      title: TITLE.optional(),
      url: z
        .string({ error: () => 'url is required' })
        .trim()
        .min(1, { error: () => 'url is required' })
        .max(MAX_MANUAL_URL_LENGTH, {
          error: () => `url must be at most ${MAX_MANUAL_URL_LENGTH} characters`,
        }),
    },
    NOT_AN_OBJECT,
  )
  .strip()

// Renaming one. Blank is refused rather than stored: a manual with no title is
// a row nobody can tell from the one under it.
export const MANUAL_TITLE_SCHEMA = z
  .object(
    { title: TITLE.min(1, { error: () => 'title must be a non-empty string' }) },
    NOT_AN_OBJECT,
  )
  .strip()

export function parseManualUrl(body: unknown): Parsed<{ title: string; url: string }> {
  const parsed = parseWith(MANUAL_URL_SCHEMA, body)
  if (!parsed.ok) return parsed

  return valid({ title: parsed.value.title ?? '', url: parsed.value.url })
}

export function parseManualTitle(body: unknown): Parsed<string> {
  const parsed = parseWith(MANUAL_TITLE_SCHEMA, body)

  return parsed.ok ? valid(parsed.value.title) : parsed
}

export const DEFAULT_MANUAL_LIMIT = 24
export const MAX_MANUAL_LIMIT = 200
export const MAX_DELETE_MANUALS = 50

export type ManualQuery = {
  limit: number
  offset: number
  search: null | string
}

// The library\'s query string. Like every other list here, a bad value is
// clamped or dropped rather than refused: a pasted link should still show the
// shelf — which is why it is not a schema.
export function parseManualQuery(params: URLSearchParams): ManualQuery {
  return {
    limit: clampInteger(params.get('limit'), DEFAULT_MANUAL_LIMIT, 1, MAX_MANUAL_LIMIT),
    offset: clampInteger(params.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER),
    search: params.get('q')?.trim() || null,
  }
}

export const MANUAL_IDS_SCHEMA = z
  .object(
    {
      ids: z
        .array(z.unknown(), { error: () => 'Expected { "ids": [1, 2, 3] }' })
        .min(1, { error: () => t('Nie zaznaczono żadnej instrukcji') })
        .max(MAX_DELETE_MANUALS, {
          error: () => t('Maksymalnie {max} instrukcji naraz', { max: MAX_DELETE_MANUALS }),
        }),
    },
    { error: () => 'Expected { "ids": [1, 2, 3] }' },
  )
  .strip()

export function parseManualIds(body: unknown): Parsed<number[]> {
  const parsed = parseWith(MANUAL_IDS_SCHEMA, body)
  if (!parsed.ok) return parsed

  const ids: number[] = []
  for (const raw of parsed.value.ids) {
    const id = Number(raw)
    if (!Number.isSafeInteger(id) || id <= 0) {
      return invalid(t('Nieprawidłowy identyfikator: {value}', { value: String(raw) }))
    }
    // Duplicates in the selection are the client\'s business, not the
    // database\'s: it would count the same row twice.
    if (!ids.includes(id)) ids.push(id)
  }

  return valid(ids)
}

function clampInteger(raw: null | string, fallback: number, min: number, max: number): number {
  const value = Number(raw)
  if (!raw || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), min), max)
}
