// Item card bodies and list query strings. Pure; see input.ts.
//
// The schemas are exported beside the parsers because the contract is generated
// from them: `ITEM_PATCH_SCHEMA` is what refuses a name of 201 characters at
// runtime and what puts `maxLength: 200` in docs/openapi.json.

import { z } from 'zod'
import { clampLimit, clampOffset, ITEM_PAGING } from './paging'

import { invalid, NOT_AN_OBJECT, parseWith, valid, type Parsed } from './input'

// The sorts of thing a catalog of what somebody owns holds. 'case' has nothing
// using it yet: the boxes are their own table and folding them in is a decision
// for later, but a list that has to be widened on the day of is one more thing
// to remember on the day of.
export const ITEM_KINDS = ['tool', 'appliance', 'case'] as const

export type ItemKind = (typeof ITEM_KINDS)[number]

export const DEFAULT_KIND: ItemKind = 'tool'

export function isItemKind(value: unknown): value is ItemKind {
  return typeof value === 'string' && (ITEM_KINDS as readonly string[]).includes(value)
}

export const ITEM_CONDITIONS = ['new', 'good', 'worn', 'needs_repair', 'retired'] as const

export type ItemCondition = (typeof ITEM_CONDITIONS)[number]

export const DEFAULT_CONDITION: ItemCondition = 'good'

export const MAX_NAME_LENGTH = 200
export const MAX_FIELD_LENGTH = 120
export const MAX_NOTES_LENGTH = 4000
// A parameter is a line off a rating plate, not a paragraph: "napięcie
// sieciowe" and "230 V". The value is the longer of the two because some of
// them are a list — "SDS-plus, 24 mm, 3 tryby".
export const MAX_ATTRIBUTE_NAME_LENGTH = 80
export const MAX_ATTRIBUTE_VALUE_LENGTH = 200
export const MAX_URL_LENGTH = 2000

// Millimetres. A metre and a half of toolbox is already absurd; the cap is
// there to catch a number typed in micrometres, not to judge anyone's case.
// It bounds a label slot, and the importers read it as what a box cannot
// measure — a spec sheet is free text now, and free text has no CHECK.
export const MAX_DIMENSION_MM = 5000
// Litres and kilograms, for the same reading. A box stating either of these
// above the ceiling has a decimal point in the wrong place.
export const MAX_CAPACITY_L = 10_000
export const MAX_LOAD_KG = 10_000

export const DEFAULT_LIMIT = ITEM_PAGING.default
export const MAX_LIMIT = ITEM_PAGING.max

const CONDITION = z.enum(ITEM_CONDITIONS, {
  error: () => `condition must be one of: ${ITEM_CONDITIONS.join(', ')}`,
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

// The id of a row this one points at, or null for "nobody has said". A form
// sends "4" and an emptied select sends "", so both reach the same null the
// column holds — a screen should not have to know the difference between
// clearing a field and never setting it.
const reference = (field: string) =>
  z
    .union([z.number(), z.string(), z.null()])
    .transform((raw) => {
      if (raw === null) return null
      if (typeof raw === 'string') return raw.trim() === '' ? null : Number(raw.trim())
      return raw
    })
    .refine((value) => value === null || (Number.isSafeInteger(value) && value > 0), {
      error: () => `${field} must be the id of a record, or null`,
    })

export const ITEM_PATCH_SCHEMA = z
  .object(
    {
      addressId: reference('addressId').optional(),
      brandId: reference('brandId').optional(),
      category: trimmed(MAX_FIELD_LENGTH, 'category').optional(),
      condition: CONDITION.optional(),
      kind: z
        .enum(ITEM_KINDS, { error: () => `kind must be one of: ${ITEM_KINDS.join(', ')}` })
        .optional(),
      model: trimmed(MAX_FIELD_LENGTH, 'model').optional(),
      name: required(MAX_NAME_LENGTH, 'name').optional(),
      notes: trimmed(MAX_NOTES_LENGTH, 'notes').optional(),
      referenceUrl: trimmed(MAX_URL_LENGTH, 'referenceUrl').optional(),
      serialNumber: trimmed(MAX_FIELD_LENGTH, 'serialNumber').optional(),
    },
    NOT_AN_OBJECT,
  )
  // Unknown keys are dropped rather than refused: a client sending a field this
  // version does not know about should not be told its whole edit is wrong.
  .strip()

export const ITEM_CREATE_SCHEMA = ITEM_PATCH_SCHEMA.extend({
  // The one required field. A card with no name is not findable by the person
  // standing in front of the item, which is the only reason the card exists.
  name: required(MAX_NAME_LENGTH, 'name'),
})

export type ItemFields = {
  // Where the item is kept. Null is "nobody has said", which is not the same
  // as a place called nothing.
  addressId: null | number
  // The maker, as the row it is. A card used to carry the name as text beside
  // this, and keeping the two in step took three mechanisms; one pointer needs
  // none of them.
  brandId: null | number
  category: string
  // What sort of thing this is: a drill, a washing machine, later a box. Not a
  // category — a category is somebody's own word for a shelf, and this is the
  // handful of sorts the catalog itself behaves differently about.
  kind: ItemKind
  condition: ItemCondition
  model: string
  name: string
  notes: string
  referenceUrl: string
  serialNumber: string
}

// A patch carries only the fields that were sent. `undefined` means "leave it
// alone" and is not the same as '' — clearing the brand is a real edit, and a
// PATCH that could not express it would force the client to resend the card.
export type ItemPatch = Partial<ItemFields>

export type AttributeFields = {
  name: string
  value: string
}

export type AttributePatch = Partial<AttributeFields>

export type ItemSort = 'createdAt' | 'name' | 'updatedAt'

export type ItemQuery = {
  // Whether each card should carry its spec sheet. Off by default: a grid
  // shows a name, a maker and a condition. The boxes screen turns it on,
  // because what somebody scanning a shelf of boxes is choosing between is the
  // measurements and what goes in.
  attributes: boolean
  // Which sort to list, or null for all of them. A screen shows the tools or
  // the appliances; the catalog holds both.
  kind: ItemKind | null
  // A place id, or 'none' for the items nobody has located, or null for "do
  // not filter". Three states rather than two, because "not at this address"
  // and "at no address" are different questions and a screen asks both.
  addressId: 'none' | null | number
  category: null | string
  // true: only items that are in no organizer — what the organizer wizard
  // offers. null: everything, which is what every other screen wants.
  inOrganizer: boolean | null
  condition: null | ItemCondition
  direction: 'asc' | 'desc'
  limit: number
  offset: number
  // One model, exact. Unlike the search box this is a filter picked from a
  // list, so it matches the whole string rather than part of one.
  model: null | string
  search: null | string
  sort: ItemSort
}

export function isItemCondition(value: unknown): value is ItemCondition {
  return typeof value === 'string' && (ITEM_CONDITIONS as readonly string[]).includes(value)
}

export function parseItemCreate(body: unknown): Parsed<ItemFields> {
  const parsed = parseWith(ITEM_CREATE_SCHEMA, body)
  if (!parsed.ok) return parsed

  // Everything the page did not say is stored as blank rather than absent, so
  // a card always has the same columns and a screen never has to tell "not
  // filled in" from "not sent".
  return valid({
    addressId: parsed.value.addressId ?? null,
    brandId: parsed.value.brandId ?? null,
    category: parsed.value.category ?? '',
    condition: parsed.value.condition ?? DEFAULT_CONDITION,
    kind: parsed.value.kind ?? DEFAULT_KIND,
    model: parsed.value.model ?? '',
    name: parsed.value.name,
    notes: parsed.value.notes ?? '',
    referenceUrl: parsed.value.referenceUrl ?? '',
    serialNumber: parsed.value.serialNumber ?? '',
  })
}

export function parseItemPatch(body: unknown): Parsed<ItemPatch> {
  const parsed = parseWith(ITEM_PATCH_SCHEMA, body)
  if (!parsed.ok) return parsed

  // Refused rather than answered with the row unchanged, which would look to
  // the screen like it saved something.
  if (Object.keys(parsed.value).length === 0) {
    return invalid('No editable fields in request body')
  }

  return parsed
}

// One parameter of an item. Runs of whitespace collapse to one space: the unique
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
// nothing, which is refused, because silently listing every item would look
// like an answer rather than a typo.
//
// That rule is why the query is not a schema: Zod refuses, and what this wants
// is to forgive. A schema describing it would have to say "any string" for
// every field, which tells a client nothing the parameter list in the contract
// does not already say better.
export function parseItemQuery(params: URLSearchParams): Parsed<ItemQuery> {
  const conditionParam = params.get('condition')?.trim()
  if (conditionParam && !isItemCondition(conditionParam)) {
    return invalid(`condition must be one of: ${ITEM_CONDITIONS.join(', ')}`)
  }

  return valid({
    attributes: params.get('attributes') === '1',
    category: params.get('category')?.trim() || null,
    addressId: readAddressFilter(params.get('addressId')),
    kind: readKind(params.get('kind')),
    inOrganizer: readBoolean(params.get('inOrganizer')),
    condition: conditionParam ? (conditionParam as ItemCondition) : null,
    direction: params.get('order')?.trim().toLowerCase() === 'asc' ? 'asc' : 'desc',
    limit: clampLimit(params.get('limit'), ITEM_PAGING),
    offset: clampOffset(params.get('offset')),
    model: params.get('model')?.trim() || null,
    search: params.get('q')?.trim() || null,
    sort: parseSort(params.get('sort')),
  })
}

function parseSort(value: null | string): ItemSort {
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

// A label slot is a size and nothing else: width by height, in millimetres,
// both whole numbers and both required — a slot with no width is not a slot.
export const LABEL_SLOT_SCHEMA = z
  .object(
    {
      heightMm: slotSize('heightMm'),
      widthMm: slotSize('widthMm'),
    },
    NOT_AN_OBJECT,
  )
  .strip()

export function parseLabelSlot(body: unknown): Parsed<{ heightMm: number; widthMm: number }> {
  return parseWith(LABEL_SLOT_SCHEMA, body)
}

// A form sends "450" and a Polish keyboard produces "4,5", so both are read —
// and then refused here, because a place for a sticker is a whole number of
// millimetres.
function slotSize(field: string) {
  const complaint = `${field} must be a whole number of mm between 1 and ${MAX_DIMENSION_MM}`

  return z
    .union([z.number(), z.string()])
    .transform((raw) => (typeof raw === 'string' ? Number(raw.trim().replace(',', '.')) : raw))
    .refine((value) => Number.isInteger(value) && value > 0 && value <= MAX_DIMENSION_MM, {
      error: () => complaint,
    })
}

// Absent means "do not filter", which is not the same as false.
function readBoolean(value: null | string): boolean | null {
  const trimmed = value?.trim().toLowerCase()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  return null
}

// Clamped rather than refused, like every other list filter: a pasted link with
// `?addressId=banana` should still show the catalog rather than an error about
// a parameter nobody typed on purpose.
function readAddressFilter(raw: null | string): 'none' | null | number {
  const value = raw?.trim()
  if (!value) return null
  if (value === 'none') return 'none'

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

// Clamped rather than refused, like every other list filter: a pasted link with
// an unknown kind should still show the catalog.
function readKind(raw: null | string): ItemKind | null {
  const value = raw?.trim()
  return value && (ITEM_KINDS as readonly string[]).includes(value) ? (value as ItemKind) : null
}
