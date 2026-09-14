// The shape every request-body parser answers with, and the adapter that turns
// a Zod schema into it.
//
// Parsers are pure functions over already-decoded JSON, kept apart from the
// routes so the rules can be tested without a server or a database, and so a
// rejection is one `error` string a client can show rather than a stack trace.
//
// The rules themselves are Zod schemas rather than hand-written checks, for one
// reason: a schema is data. The same object that refuses a bad body at runtime
// is read by scripts/build-openapi.ts to produce the request schema in the
// contract, so the two cannot disagree about what a field accepts. Before this
// they were written twice — once here as `if (value.length > 200)`, once in
// src/openapi/paths/ as `maxLength: 200` — and nothing made the second follow
// the first.
//
// `Parsed<T>` stays what it was. Routes read `.ok` and `.value` and did not
// change.

import type { ZodType } from 'zod'

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

// One issue, not all of them.
//
// A body with three bad fields is almost always one mistake — a form sent the
// wrong shape — and a client shows one line. Zod reports every failure it
// found, in the order it found them, and the first is the one a person can act
// on. The path is prefixed only where the message does not already name the
// field, so "name must be at most 200 characters" is not rewritten into
// "name: name must be at most 200 characters".
export function parseWith<T>(schema: ZodType<T>, value: unknown): Parsed<T> {
  const result = schema.safeParse(value)
  if (result.success) return valid(result.data)

  const issue = result.error.issues[0]
  const field = issue.path.filter((part) => typeof part === 'string').join('.')
  const message = issue.message

  return invalid(field && !message.startsWith(field) ? `${field}: ${message}` : message)
}

// What `z.object()` says when the body is not one. Zod's own wording talks
// about what it expected and received, which is true and useless to somebody
// who sent a string.
export const NOT_AN_OBJECT = { error: () => 'Expected a JSON object' }
