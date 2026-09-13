// Tool card bodies and list query strings. Pure; see input.ts.

import { invalid, isPlainObject, trimmedString, valid, type Parsed } from './input'

export const TOOL_CONDITIONS = ['new', 'good', 'worn', 'needs_repair', 'retired'] as const

export type ToolCondition = (typeof TOOL_CONDITIONS)[number]

export const DEFAULT_CONDITION: ToolCondition = 'good'

export const MAX_NAME_LENGTH = 200
export const MAX_FIELD_LENGTH = 120
export const MAX_NOTES_LENGTH = 4000
// A parameter is a line off a rating plate, not a paragraph: "napięcie
// sieciowe" and "230 V". The value is the longer of the two because some of
// them are a list — "SDS-plus, 24 mm, 3 tryby".
export const MAX_ATTRIBUTE_NAME_LENGTH = 80
export const MAX_ATTRIBUTE_VALUE_LENGTH = 200
export const MAX_URL_LENGTH = 2000

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 200

export type ToolFields = {
  brand: string
  category: string
  condition: ToolCondition
  model: string
  name: string
  notes: string
  serialNumber: string
}

// A patch carries only the fields that were sent. `undefined` means "leave it
// alone" and is not the same as '' — clearing the brand is a real edit, and a
// PATCH that could not express it would force the client to resend the card.
export type ToolPatch = Partial<ToolFields>

export type AttributeFields = {
  name: string
  value: string
}

export type AttributePatch = Partial<AttributeFields>

export type ToolSort = 'createdAt' | 'name' | 'updatedAt'

export type ToolQuery = {
  category: null | string
  // true: only tools that are in no organizer — what the organizer wizard
  // offers. null: everything, which is what every other screen wants.
  inOrganizer: boolean | null
  condition: null | ToolCondition
  direction: 'asc' | 'desc'
  limit: number
  offset: number
  search: null | string
  sort: ToolSort
}

export function isToolCondition(value: unknown): value is ToolCondition {
  return typeof value === 'string' && (TOOL_CONDITIONS as readonly string[]).includes(value)
}

export function parseToolCreate(body: unknown): Parsed<ToolFields> {
  if (!isPlainObject(body)) return invalid('Expected a JSON object')

  const name = trimmedString(body.name) ?? ''
  // The one required field. A card with no name is not findable by the person
  // standing in front of the tool, which is the only reason the card exists.
  if (!name) return invalid('name is required')

  const patch = parseToolPatch({ ...body, name })
  if (!patch.ok) return patch

  return valid({
    brand: patch.value.brand ?? '',
    category: patch.value.category ?? '',
    condition: patch.value.condition ?? DEFAULT_CONDITION,
    model: patch.value.model ?? '',
    name,
    notes: patch.value.notes ?? '',
    serialNumber: patch.value.serialNumber ?? '',
  })
}

export function parseToolPatch(body: unknown): Parsed<ToolPatch> {
  if (!isPlainObject(body)) return invalid('Expected a JSON object')

  const patch: ToolPatch = {}

  if ('name' in body) {
    const name = trimmedString(body.name)
    if (!name) return invalid('name must be a non-empty string')
    if (name.length > MAX_NAME_LENGTH)
      return invalid(`name must be at most ${MAX_NAME_LENGTH} characters`)
    patch.name = name
  }

  for (const field of ['brand', 'category', 'model', 'serialNumber'] as const) {
    if (!(field in body)) continue
    const value = trimmedString(body[field])
    if (value === null) return invalid(`${field} must be a string`)
    if (value.length > MAX_FIELD_LENGTH) {
      return invalid(`${field} must be at most ${MAX_FIELD_LENGTH} characters`)
    }
    patch[field] = value
  }

  if ('notes' in body) {
    const notes = trimmedString(body.notes)
    if (notes === null) return invalid('notes must be a string')
    if (notes.length > MAX_NOTES_LENGTH) {
      return invalid(`notes must be at most ${MAX_NOTES_LENGTH} characters`)
    }
    patch.notes = notes
  }

  if ('condition' in body) {
    if (!isToolCondition(body.condition)) {
      return invalid(`condition must be one of: ${TOOL_CONDITIONS.join(', ')}`)
    }
    patch.condition = body.condition
  }

  if (Object.keys(patch).length === 0) return invalid('No editable fields in request body')

  return valid(patch)
}

// One parameter of a tool. Both halves are required and neither may be blank:
// a parameter with no name says nothing, and one with no value is a question
// rather than an answer.
export function parseAttributeCreate(body: unknown): Parsed<AttributeFields> {
  const patch = parseAttributePatch(body)
  if (!patch.ok) return patch

  if (patch.value.name === undefined) return invalid('name is required')
  if (patch.value.value === undefined) return invalid('value is required')

  return valid({ name: patch.value.name, value: patch.value.value })
}

// Editing one: a typo in the name, a value read off the plate again. Sending
// neither is refused rather than answered with the row unchanged, which would
// look to the screen like it saved something.
export function parseAttributePatch(body: unknown): Parsed<AttributePatch> {
  if (!isPlainObject(body)) return invalid('Expected a JSON object')

  const patch: AttributePatch = {}

  for (const [field, limit] of [
    ['name', MAX_ATTRIBUTE_NAME_LENGTH],
    ['value', MAX_ATTRIBUTE_VALUE_LENGTH],
  ] as const) {
    if (!(field in body)) continue

    const raw = trimmedString(body[field])
    if (!raw) return invalid(`${field} must be a non-empty string`)

    // Runs of whitespace collapse to one space. The unique index folds case
    // and trims the ends, so without this "napięcie  sieciowe" would be stored
    // as a second parameter beside "napięcie sieciowe" — the same accident as
    // a trailing space, and the same answer.
    const value = raw.replace(/\s+/g, ' ')
    if (value.length > limit) return invalid(`${field} must be at most ${limit} characters`)

    patch[field] = value
  }

  if (Object.keys(patch).length === 0) return invalid('No editable fields in request body')

  return valid(patch)
}

// The address of a product page somebody pasted. Whether this server can read
// that shop is the importer registry's business; whether this is an address at
// all is this function's.
export function parseImportInput(body: unknown): Parsed<{ url: string }> {
  if (!isPlainObject(body)) return invalid('Expected a JSON object')

  const url = trimmedString(body.url)
  if (!url) return invalid('url is required')
  if (url.length > MAX_URL_LENGTH)
    return invalid(`url must be at most ${MAX_URL_LENGTH} characters`)

  return valid({ url })
}

// The list query. Unlike the bodies, a bad value here is not an error: a link
// someone pasted with `?limit=banana` should still show the catalog. Values
// are clamped or dropped, never refused — except a condition filter that names
// nothing, which is refused, because silently listing every tool would look
// like an answer rather than a typo.
export function parseToolQuery(params: URLSearchParams): Parsed<ToolQuery> {
  const conditionParam = params.get('condition')?.trim()
  if (conditionParam && !isToolCondition(conditionParam)) {
    return invalid(`condition must be one of: ${TOOL_CONDITIONS.join(', ')}`)
  }

  return valid({
    category: params.get('category')?.trim() || null,
    inOrganizer: readBoolean(params.get('inOrganizer')),
    condition: conditionParam ? (conditionParam as ToolCondition) : null,
    direction: params.get('order')?.trim().toLowerCase() === 'asc' ? 'asc' : 'desc',
    limit: clampInteger(params.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT),
    offset: clampInteger(params.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER),
    search: params.get('q')?.trim() || null,
    sort: parseSort(params.get('sort')),
  })
}

function parseSort(value: null | string): ToolSort {
  switch (value?.trim()) {
    case 'createdAt':
      return 'createdAt'
    case 'name':
      return 'name'
    default:
      // Newest edit first: the catalog is used most right after someone
      // changed something in it.
      return 'updatedAt'
  }
}

function clampInteger(value: null | string, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (value === null || value.trim() === '' || !Number.isInteger(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

// Absent means "do not filter", which is not the same as false.
function readBoolean(value: null | string): boolean | null {
  const trimmed = value?.trim().toLowerCase()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  return null
}
