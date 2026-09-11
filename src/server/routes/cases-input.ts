// Case bodies and list query strings. Pure; see input.ts.

import { invalid, isPlainObject, trimmedString, valid, type Parsed } from './input'

export const MAX_NAME_LENGTH = 200
export const MAX_FIELD_LENGTH = 120
export const MAX_NOTES_LENGTH = 4000

// Millimetres. A metre and a half of toolbox is already absurd; the cap is
// there to catch a number typed in micrometres, not to judge anyone's case.
export const MAX_DIMENSION_MM = 5000
// Litres and kilograms, to two decimals because spec sheets say "4,5 L".
export const MAX_CAPACITY_L = 10_000
export const MAX_LOAD_KG = 10_000

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 200

// Text fields that are optional and stored as '' when not filled in, the same
// convention the tool card uses.
const TEXT_FIELDS = ['system', 'ean', 'sku'] as const

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
  capacityL: null | number
  diagonalMm: null | number
  ean: string
  innerHeightMm: null | number
  innerLengthMm: null | number
  innerWidthMm: null | number
  loadKg: null | number
  manufacturer: string
  name: string
  notes: string
  outerHeightMm: null | number
  outerLengthMm: null | number
  outerWidthMm: null | number
  sku: string
  system: string
}

// A patch carries only the fields that were sent. `undefined` means "leave it
// alone"; an explicit null clears a measurement, which is a real edit — a
// number copied off the wrong spec sheet has to be removable.
export type CasePatch = Partial<CaseFields>

export type CaseSort = 'capacityL' | 'createdAt' | 'name' | 'updatedAt'

export type CaseQuery = {
  direction: 'asc' | 'desc'
  limit: number
  manufacturer: null | string
  offset: number
  search: null | string
  sort: CaseSort
  system: null | string
}

export function parseCaseCreate(body: unknown): Parsed<CaseFields> {
  if (!isPlainObject(body)) return invalid('Expected a JSON object')

  // The two required fields. A case with no name cannot be pointed at in a
  // van, and without a maker the name alone ("Toolbox 2.0") does not say what
  // it is.
  const name = trimmedString(body.name) ?? ''
  if (!name) return invalid('name is required')

  const manufacturer = trimmedString(body.manufacturer) ?? ''
  if (!manufacturer) return invalid('manufacturer is required')

  const patch = parseCasePatch({ ...body, manufacturer, name })
  if (!patch.ok) return patch

  return valid({
    capacityL: patch.value.capacityL ?? null,
    diagonalMm: patch.value.diagonalMm ?? null,
    ean: patch.value.ean ?? '',
    innerHeightMm: patch.value.innerHeightMm ?? null,
    innerLengthMm: patch.value.innerLengthMm ?? null,
    innerWidthMm: patch.value.innerWidthMm ?? null,
    loadKg: patch.value.loadKg ?? null,
    manufacturer,
    name,
    notes: patch.value.notes ?? '',
    outerHeightMm: patch.value.outerHeightMm ?? null,
    outerLengthMm: patch.value.outerLengthMm ?? null,
    outerWidthMm: patch.value.outerWidthMm ?? null,
    sku: patch.value.sku ?? '',
    system: patch.value.system ?? '',
  })
}

export function parseCasePatch(body: unknown): Parsed<CasePatch> {
  if (!isPlainObject(body)) return invalid('Expected a JSON object')

  const patch: CasePatch = {}

  for (const field of ['name', 'manufacturer'] as const) {
    if (!(field in body)) continue
    const value = trimmedString(body[field])
    if (!value) return invalid(`${field} must be a non-empty string`)
    if (value.length > MAX_NAME_LENGTH) {
      return invalid(`${field} must be at most ${MAX_NAME_LENGTH} characters`)
    }
    patch[field] = value
  }

  for (const field of TEXT_FIELDS) {
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

  for (const field of DIMENSION_FIELDS) {
    if (!(field in body)) continue
    const value = parseMeasurement(body[field], MAX_DIMENSION_MM, 0)
    if (value === undefined) {
      return invalid(`${field} must be a whole number of mm between 1 and ${MAX_DIMENSION_MM}`)
    }
    patch[field] = value
  }

  if ('capacityL' in body) {
    const value = parseMeasurement(body.capacityL, MAX_CAPACITY_L, 2)
    if (value === undefined) return invalid(`capacityL must be between 0 and ${MAX_CAPACITY_L}`)
    patch.capacityL = value
  }

  if ('loadKg' in body) {
    const value = parseMeasurement(body.loadKg, MAX_LOAD_KG, 2)
    if (value === undefined) return invalid(`loadKg must be between 0 and ${MAX_LOAD_KG}`)
    patch.loadKg = value
  }

  if (Object.keys(patch).length === 0) return invalid('No editable fields in request body')

  return valid(patch)
}

// The list query. A bad value here is clamped or dropped rather than refused:
// a link someone pasted with `?limit=banana` should still show the shelf.
// A label slot is a size and nothing else: width by height, in millimetres.
export function parseLabelSlot(body: unknown): Parsed<{ heightMm: number; widthMm: number }> {
  if (!isPlainObject(body)) return invalid('Expected a JSON object')

  const widthMm = parseMeasurement(body.widthMm, MAX_DIMENSION_MM, 0)
  const heightMm = parseMeasurement(body.heightMm, MAX_DIMENSION_MM, 0)

  // Null is "not known", which a label size cannot be: a slot with no width is
  // not a slot.
  if (widthMm === undefined || widthMm === null) {
    return invalid(`widthMm must be a whole number of mm between 1 and ${MAX_DIMENSION_MM}`)
  }
  if (heightMm === undefined || heightMm === null) {
    return invalid(`heightMm must be a whole number of mm between 1 and ${MAX_DIMENSION_MM}`)
  }

  return valid({ heightMm, widthMm })
}

export function parseCaseQuery(params: URLSearchParams): Parsed<CaseQuery> {
  return valid({
    direction: params.get('order')?.trim().toLowerCase() === 'asc' ? 'asc' : 'desc',
    limit: clampInteger(params.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT),
    manufacturer: params.get('manufacturer')?.trim() || null,
    offset: clampInteger(params.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER),
    search: params.get('q')?.trim() || null,
    sort: parseSort(params.get('sort')),
    system: params.get('system')?.trim() || null,
  })
}

// null clears the field, a number sets it, and `undefined` is this function's
// way of saying the value was neither — which the caller turns into a 400.
// Strings are accepted because a form sends "450", and a comma is accepted
// because a Polish keyboard produces "4,5".
function parseMeasurement(raw: unknown, max: number, decimals: number): null | number | undefined {
  if (raw === null || raw === '') return null

  const value = typeof raw === 'string' ? Number(raw.trim().replace(',', '.')) : raw
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (value <= 0 || value > max) return undefined
  if (decimals === 0 && !Number.isInteger(value)) return undefined

  return decimals === 0 ? value : Math.round(value * 10 ** decimals) / 10 ** decimals
}

function parseSort(value: null | string): CaseSort {
  switch (value?.trim()) {
    case 'capacityL':
      return 'capacityL'
    case 'createdAt':
      return 'createdAt'
    case 'updatedAt':
      return 'updatedAt'
    default:
      return 'name'
  }
}

function clampInteger(raw: null | string, fallback: number, min: number, max: number): number {
  const value = Number(raw)
  if (!raw || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), min), max)
}
