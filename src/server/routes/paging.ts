// How long a page is, per list, in one object each.
//
// A list forgives where a body refuses: `?limit=banana` clamps rather than
// answering 400, because a link somebody pasted should still show the catalog.
// That is why a query string is not a Zod schema — a schema that forgives is a
// schema that accepts anything, and it would tell a client less than the
// parameter list in the contract already does.
//
// But the numbers are still facts, and they were written twice: here as the
// clamp, and in src/openapi/paths/ as `maximum: 200`. Now the parser clamps
// with this object and the contract is built from the same one, so the two
// cannot disagree about how long a page is.

export type Paging = {
  default: number
  max: number
}

export const TOOL_PAGING: Paging = { default: 50, max: 200 }
export const CASE_PAGING: Paging = { default: 50, max: 200 }
export const ORGANIZER_PAGING: Paging = { default: 50, max: 200 }
// Wider, because a shelf of makers is short and read whole.
export const BRAND_PAGING: Paging = { default: 100, max: 500 }
// The same, and for the same reason: a workshop has a handful of places.
export const ADDRESS_PAGING: Paging = { default: 100, max: 500 }
// A grid of thumbnails rather than rows, so a page is what fills a screen.
export const MEDIA_PAGING: Paging = { default: 48, max: 200 }
export const LABEL_PAGING: Paging = { default: 48, max: 200 }
export const MANUAL_PAGING: Paging = { default: 24, max: 200 }

// Clamped, never refused. A value that is not a whole number falls back to the
// default rather than complaining: the caller is a pasted link as often as it
// is a client.
export function clampLimit(raw: null | string, paging: Paging): number {
  return clampInteger(raw, paging.default, 1, paging.max)
}

export function clampOffset(raw: null | string): number {
  return clampInteger(raw, 0, 0, Number.MAX_SAFE_INTEGER)
}

export function clampInteger(
  raw: null | string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(raw)
  if (raw === null || raw.trim() === '' || !Number.isFinite(value)) return fallback

  return Math.min(Math.max(Math.trunc(value), min), max)
}
