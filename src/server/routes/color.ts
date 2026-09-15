// A colour a person typed, as one thing the whole catalog can compare.
//
// Shared by the makers and the places, which is why it is here rather than in
// either: "is this the same colour" has to have one answer, and a second copy
// of these rules is a second answer waiting to happen.

import { z } from 'zod'

const COLOR_ERROR = 'color must be #rrggbb, "r g b", or empty'

// One colour, two spellings accepted. A leading colour is read off a logo or a
// brand book, where it is given as three numbers; CSS wants it as hex. Both
// arrive here and one form is stored, so a search or a comparison cannot miss
// because somebody wrote the same colour differently.
//
// Null means "not a colour", which the schema turns into a 400. An empty string
// is a colour nobody has said, and is allowed.
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

const COLOR_SCHEMA = z
  .string()
  .nullable()
  .transform((raw) => parseColor(raw))
  .refine((value): value is string => value !== null, { error: () => COLOR_ERROR })

export { COLOR_SCHEMA }
