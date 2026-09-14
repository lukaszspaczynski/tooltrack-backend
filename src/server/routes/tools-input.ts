// Tool card bodies and list query strings. Pure; see input.ts.
//
// The schemas are exported beside the parsers because the contract is generated
// from them: `TOOL_PATCH_SCHEMA` is what refuses a name of 201 characters at
// runtime and what puts `maxLength: 200` in docs/openapi.json.

import { z } from 'zod'
import { clampLimit, clampOffset, TOOL_PAGING } from './paging'

import { invalid, NOT_AN_OBJECT, parseWith, valid, type Parsed } from './input'

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

export const DEFAULT_LIMIT = TOOL_PAGING.default
export const MAX_LIMIT = TOOL_PAGING.max

const CONDITION = z.enum(TOOL_CONDITIONS, {
  error: () => `condition must be one of: ${TOOL_CONDITIONS.join(', ')}`,
})

// Trimmed, because whitespace at the ends is always a typo. The length is
// checked after the trim, so " x " is one character rather than three.
const trimmed = (max: number, field: string) =>
  z
    .string({ error: () => `${field} must be a string` })
    .trim()
    .max(max, { error: () => `${field} must be at most ${max} characters` })

const required = (max: number, field: string) =>
  trimmed(max, field).min(1, { error: () => `${field} must be a non-empty string` })

export const TOOL_PATCH_SCHEMA = z
  .object(
    {
      brand: trimmed(MAX_FIELD_LENGTH, 'brand').optional(),
      category: trimmed(MAX_FIELD_LENGTH, 'category').optional(),
      condition: CONDITION.optional(),
      model: trimmed(MAX_FIELD_LENGTH, 'model').optional(),
      name: required(MAX_NAME_LENGTH, 'name').optional(),
      notes: trimmed(MAX_NOTES_LENGTH, 'notes').optional(),
      serialNumber: trimmed(MAX_FIELD_LENGTH, 'serialNumber').optional(),
    },
    NOT_AN_OBJECT,
  )
  // Unknown keys are dropped rather than refused: a client sending a field this
  // version does not know about should not be told its whole edit is wrong.
  .strip()

export const TOOL_CREATE_SCHEMA = TOOL_PATCH_SCHEMA.extend({
  // The one required field. A card with no name is not findable by the person
  // standing in front of the tool, which is the only reason the card exists.
  name: required(MAX_NAME_LENGTH, 'name'),
})

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
  const parsed = parseWith(TOOL_CREATE_SCHEMA, body)
  if (!parsed.ok) return parsed

  // Everything the page did not say is stored as blank rather than absent, so
  // a card always has the same columns and a screen never has to tell "not
  // filled in" from "not sent".
  return valid({
    brand: parsed.value.brand ?? '',
    category: parsed.value.category ?? '',
    condition: parsed.value.condition ?? DEFAULT_CONDITION,
    model: parsed.value.model ?? '',
    name: parsed.value.name,
    notes: parsed.value.notes ?? '',
    serialNumber: parsed.value.serialNumber ?? '',
  })
}

export function parseToolPatch(body: unknown): Parsed<ToolPatch> {
  const parsed = parseWith(TOOL_PATCH_SCHEMA, body)
  if (!parsed.ok) return parsed

  // Refused rather than answered with the row unchanged, which would look to
  // the screen like it saved something.
  if (Object.keys(parsed.value).length === 0) {
    return invalid('No editable fields in request body')
  }

  return parsed
}

// One parameter of a tool. Runs of whitespace collapse to one space: the unique
// index folds case and trims the ends, so without this "napięcie  sieciowe"
// would be stored as a second parameter beside "napięcie sieciowe" — the same
// accident as a trailing space, and the same answer.
const attribute = (max: number, field: string) =>
  required(max, field).transform((value) => value.replace(/\s+/g, ' '))

export const ATTRIBUTE_PATCH_SCHEMA = z
  .object(
    {
      name: attribute(MAX_ATTRIBUTE_NAME_LENGTH, 'name').optional(),
      value: attribute(MAX_ATTRIBUTE_VALUE_LENGTH, 'value').optional(),
    },
    NOT_AN_OBJECT,
  )
  .strip()

export const ATTRIBUTE_CREATE_SCHEMA = ATTRIBUTE_PATCH_SCHEMA.extend({
  // Both halves are required and neither may be blank: a parameter with no name
  // says nothing, and one with no value is a question rather than an answer.
  name: attribute(MAX_ATTRIBUTE_NAME_LENGTH, 'name'),
  value: attribute(MAX_ATTRIBUTE_VALUE_LENGTH, 'value'),
})

export function parseAttributeCreate(body: unknown): Parsed<AttributeFields> {
  const patch = parseWith(ATTRIBUTE_PATCH_SCHEMA, body)
  if (!patch.ok) return patch

  if (patch.value.name === undefined) return invalid('name is required')
  if (patch.value.value === undefined) return invalid('value is required')

  return valid({ name: patch.value.name, value: patch.value.value })
}

// Editing one: a typo in the name, a value read off the plate again. Sending
// neither is refused rather than answered with the row unchanged.
export function parseAttributePatch(body: unknown): Parsed<AttributePatch> {
  const parsed = parseWith(ATTRIBUTE_PATCH_SCHEMA, body)
  if (!parsed.ok) return parsed

  if (Object.keys(parsed.value).length === 0) {
    return invalid('No editable fields in request body')
  }

  return parsed
}

// The address of a product page somebody pasted. Whether this server can read
// that shop is the importer registry's business; whether this is an address at
// all is this schema's.
export const IMPORT_SCHEMA = z
  .object(
    {
      url: z
        .string({ error: () => 'url is required' })
        .trim()
        .min(1, { error: () => 'url is required' })
        .max(MAX_URL_LENGTH, {
          error: () => `url must be at most ${MAX_URL_LENGTH} characters`,
        }),
    },
    NOT_AN_OBJECT,
  )
  .strip()

export function parseImportInput(body: unknown): Parsed<{ url: string }> {
  return parseWith(IMPORT_SCHEMA, body)
}

// The list query. Unlike the bodies, a bad value here is not an error: a link
// someone pasted with `?limit=banana` should still show the catalog. Values
// are clamped or dropped, never refused — except a condition filter that names
// nothing, which is refused, because silently listing every tool would look
// like an answer rather than a typo.
//
// That rule is why the query is not a schema: Zod refuses, and what this wants
// is to forgive. A schema describing it would have to say "any string" for
// every field, which tells a client nothing the parameter list in the contract
// does not already say better.
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
    limit: clampLimit(params.get('limit'), TOOL_PAGING),
    offset: clampOffset(params.get('offset')),
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

// Absent means "do not filter", which is not the same as false.
function readBoolean(value: null | string): boolean | null {
  const trimmed = value?.trim().toLowerCase()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  return null
}
