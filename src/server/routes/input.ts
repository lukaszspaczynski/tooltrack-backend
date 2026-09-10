// The shape every request-body parser answers with.
//
// Parsers are pure functions over already-decoded JSON, kept apart from the
// routes so the rules can be tested without a server or a database, and so a
// rejection is one `error` string a client can show rather than a stack trace.

export type Parsed<T> = { error: string; ok: false } | { ok: true; value: T }

export function invalid<T>(error: string): Parsed<T> {
  return { error, ok: false }
}

export function valid<T>(value: T): Parsed<T> {
  return { ok: true, value }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Trims and collapses nothing else. Whitespace at the ends is always a typo;
// whitespace inside "Bosch  GBH 2-26" is what someone typed.
export function trimmedString(value: unknown): null | string {
  if (typeof value !== 'string') return null
  return value.trim()
}
