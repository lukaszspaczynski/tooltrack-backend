// Case bodies and list query strings. Pure; see input.ts.

import { z } from 'zod'
import { clampLimit, clampOffset, CASE_PAGING } from './paging'

import { invalid, NOT_AN_OBJECT, parseWith, valid, type Parsed } from './input'

export const MAX_NAME_LENGTH = 200
export const MAX_FIELD_LENGTH = 120
export const MAX_NOTES_LENGTH = 4000
// The same ceiling an item's reference takes: an address is not a field
// somebody types, it is one a page hands over.
export const MAX_URL_LENGTH = 2000

// Millimetres. A metre and a half of toolbox is already absurd; the cap is
// there to catch a number typed in micrometres, not to judge anyone's case.
export const MAX_DIMENSION_MM = 5000
// Litres and kilograms, to two decimals because spec sheets say "4,5 L".
export const MAX_CAPACITY_L = 10_000
export const MAX_LOAD_KG = 10_000

export const DEFAULT_LIMIT = CASE_PAGING.default
export const MAX_LIMIT = CASE_PAGING.max

// Text fields that are optional and stored as '' when not filled in, the same
// convention the item card uses.
const TEXT_FIELDS = ['model', 'ean', 'sku'] as const

// Numbers that are optional and stored as NULL when not filled in. Zero is not
// the same as unknown: a case with no height does not exist, but a case nobody
// has measured is normal.
const DIMENSION_FIELDS = [
  'outerLengthMm',
  'outerWidthMm',
  'outerHeightMm',
  'innerLengthMm',
  'innerWidthMm',
  'innerHeightMm',
  'diagonalMm',
] as const

export type CaseFields = {
  // The maker, as the row it is. It was free text, for the same reason an item
  // card's was: the table came later.
  brandId: null | number
  name: string
  notes: string
  referenceUrl: string
  model: string
}

// A patch carries only the fields that were sent. `undefined` means "leave it
// alone"; an explicit null clears a measurement, which is a real edit — a
// number copied off the wrong spec sheet has to be removable.
export type CasePatch = Partial<CaseFields>

export type CaseSort = 'createdAt' | 'name' | 'updatedAt'

export type CaseQuery = {
  direction: 'asc' | 'desc'
  limit: number
  manufacturer: null | string
  offset: number
  search: null | string
  sort: CaseSort
  model: null | string
}

// null clears the field, a number sets it, and anything else is refused.
// Strings are accepted because a form sends "450", and a comma is accepted
// because a Polish keyboard produces "4,5".
//
// Zero is not the same as unknown: a case with no height does not exist, but a
// case nobody has measured is normal — which is why the floor is exclusive and
// null is a value rather than an absence.
function measurement(max: number, decimals: number, field: string) {
  const complaint =
    decimals === 0
      ? `${field} must be a whole number of mm between 1 and ${max}`
      : `${field} must be between 0 and ${max}`

  return z
    .union([z.number(), z.string(), z.null()])
    .transform((raw) => {
      if (raw === null || raw === '') return null

      const value = typeof raw === 'string' ? Number(raw.trim().replace(',', '.')) : raw
      if (!Number.isFinite(value)) return Number.NaN
      if (value <= 0 || value > max) return Number.NaN
      if (decimals === 0 && !Number.isInteger(value)) return Number.NaN

      return decimals === 0 ? value : Math.round(value * 10 ** decimals) / 10 ** decimals
    })
    .refine((value) => value === null || !Number.isNaN(value), { error: () => complaint })
}

const text = (max: number, field: string) =>
  z
    .string({ error: () => `${field} must be a string` })
    .trim()
    .max(max, { error: () => `${field} must be at most ${max} characters` })

const required = (max: number, field: string) =>
  text(max, field).min(1, { error: () => `${field} must be a non-empty string` })

// The id of a row this one points at, or null for "nobody has said".
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

const mm = (field: string) => measurement(MAX_DIMENSION_MM, 0, field).optional()

export const CASE_PATCH_SCHEMA = z
  .object(
    {
      brandId: reference('brandId').optional(),
      name: required(MAX_NAME_LENGTH, 'name').optional(),
      notes: text(MAX_NOTES_LENGTH, 'notes').optional(),
      referenceUrl: text(MAX_URL_LENGTH, 'referenceUrl').optional(),
      model: text(MAX_FIELD_LENGTH, 'model').optional(),
    },
    NOT_AN_OBJECT,
  )
  .strip()

export const CASE_CREATE_SCHEMA = CASE_PATCH_SCHEMA.extend({
  // The one required field. A case with no name cannot be pointed at in a van,
  // and everything else a box states is a parameter now.
  name: required(MAX_NAME_LENGTH, 'name'),
})

// A label slot is a size and nothing else: width by height, in millimetres.
// Null is "not known", which a label size cannot be — a slot with no width is
// not a slot.
export const LABEL_SLOT_SCHEMA = z
  .object(
    {
      heightMm: measurement(MAX_DIMENSION_MM, 0, 'heightMm').refine(
        (value): value is number => value !== null,
        { error: () => `heightMm must be a whole number of mm between 1 and ${MAX_DIMENSION_MM}` },
      ),
      widthMm: measurement(MAX_DIMENSION_MM, 0, 'widthMm').refine(
        (value): value is number => value !== null,
        { error: () => `widthMm must be a whole number of mm between 1 and ${MAX_DIMENSION_MM}` },
      ),
    },
    NOT_AN_OBJECT,
  )
  .strip()

export function parseCaseCreate(body: unknown): Parsed<CaseFields> {
  const parsed = parseWith(CASE_CREATE_SCHEMA, body)
  if (!parsed.ok) return parsed

  return valid({
    brandId: parsed.value.brandId ?? null,
    name: parsed.value.name,
    notes: parsed.value.notes ?? '',
    referenceUrl: parsed.value.referenceUrl ?? '',
    model: parsed.value.model ?? '',
  })
}

export function parseCasePatch(body: unknown): Parsed<CasePatch> {
  const parsed = parseWith(CASE_PATCH_SCHEMA, body)
  if (!parsed.ok) return parsed

  if (Object.keys(parsed.value).length === 0) {
    return invalid('No editable fields in request body')
  }

  return parsed as Parsed<CasePatch>
}

export function parseLabelSlot(body: unknown): Parsed<{ heightMm: number; widthMm: number }> {
  return parseWith(LABEL_SLOT_SCHEMA, body)
}

export function parseCaseQuery(params: URLSearchParams): Parsed<CaseQuery> {
  return valid({
    direction: params.get('order')?.trim().toLowerCase() === 'asc' ? 'asc' : 'desc',
    limit: clampLimit(params.get('limit'), CASE_PAGING),
    manufacturer: params.get('manufacturer')?.trim() || null,
    offset: clampOffset(params.get('offset')),
    search: params.get('q')?.trim() || null,
    sort: parseSort(params.get('sort')),
    model: params.get('model')?.trim() || null,
  })
}

// `capacityL` is gone and falls through to the name, rather than being refused:
// a link somebody saved before capacity became a parameter should still show
// the shelf.
function parseSort(value: null | string): CaseSort {
  switch (value?.trim()) {
    case 'createdAt':
      return 'createdAt'
    case 'updatedAt':
      return 'updatedAt'
    default:
      return 'name'
  }
}
