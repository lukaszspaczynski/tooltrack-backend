// Manual bodies. Pure; see input.ts.

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
