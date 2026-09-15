// Address bodies and the list query string. Pure; see input.ts.

import { z } from 'zod'

import { invalid, NOT_AN_OBJECT, parseWith, valid, type Parsed } from './input'
import { ADDRESS_PAGING, clampLimit, clampOffset } from './paging'

export const MAX_NAME_LENGTH = 120
export const MAX_FIELD_LENGTH = 120
export const MAX_NOTES_LENGTH = 4000

export const DEFAULT_LIMIT = ADDRESS_PAGING.default
export const MAX_LIMIT = ADDRESS_PAGING.max

// Everything but the name is optional, and stored as '' rather than null when
// nobody has said. A yard on a building site has a name and no street; refusing
// to record it until somebody invents one means it is not recorded at all.
export type AddressFields = {
  building: string
  city: string
  name: string
  notes: string
  postalCode: string
  street: string
  unit: string
}

export type AddressPatch = Partial<AddressFields>

export type AddressSort = 'city' | 'name' | 'tools'

export type AddressQuery = {
  direction: 'asc' | 'desc'
  limit: number
  offset: number
  search: null | string
  sort: AddressSort
}

const trimmed = (max: number, field: string) =>
  z
    .string({ error: () => `${field} must be a string` })
    .trim()
    .max(max, { error: () => `${field} must be at most ${max} characters` })

const NAME = trimmed(MAX_NAME_LENGTH, 'name').min(1, {
  error: () => 'name must be a non-empty string',
})

export const ADDRESS_PATCH_SCHEMA = z
  .object(
    {
      building: trimmed(MAX_FIELD_LENGTH, 'building').optional(),
      city: trimmed(MAX_FIELD_LENGTH, 'city').optional(),
      name: NAME.optional(),
      notes: trimmed(MAX_NOTES_LENGTH, 'notes').optional(),
      postalCode: trimmed(MAX_FIELD_LENGTH, 'postalCode').optional(),
      street: trimmed(MAX_FIELD_LENGTH, 'street').optional(),
      unit: trimmed(MAX_FIELD_LENGTH, 'unit').optional(),
    },
    NOT_AN_OBJECT,
  )
  .strip()

export const ADDRESS_CREATE_SCHEMA = ADDRESS_PATCH_SCHEMA.extend({
  // The one required field, and the one a picker shows. A crew says "magazyn"
  // and "Mokotów"; a postcode is what you read when you are already driving.
  name: NAME,
})

export function parseAddressCreate(body: unknown): Parsed<AddressFields> {
  const parsed = parseWith(ADDRESS_CREATE_SCHEMA, body)
  if (!parsed.ok) return parsed

  return valid({
    building: parsed.value.building ?? '',
    city: parsed.value.city ?? '',
    name: parsed.value.name,
    notes: parsed.value.notes ?? '',
    postalCode: parsed.value.postalCode ?? '',
    street: parsed.value.street ?? '',
    unit: parsed.value.unit ?? '',
  })
}

export function parseAddressPatch(body: unknown): Parsed<AddressPatch> {
  const parsed = parseWith(ADDRESS_PATCH_SCHEMA, body)
  if (!parsed.ok) return parsed

  // Refused rather than answered with the row unchanged, which would look to
  // the screen like it saved something.
  if (Object.keys(parsed.value).length === 0) {
    return invalid('No editable fields in request body')
  }

  return parsed
}

export function parseAddressQuery(params: URLSearchParams): Parsed<AddressQuery> {
  return valid({
    direction: params.get('order')?.trim().toLowerCase() === 'desc' ? 'desc' : 'asc',
    limit: clampLimit(params.get('limit'), ADDRESS_PAGING),
    offset: clampOffset(params.get('offset')),
    search: params.get('q')?.trim() || null,
    sort: sortOf(params.get('sort')),
  })
}

function sortOf(raw: null | string): AddressSort {
  const value = raw?.trim()
  // Name by default: a list of places is read alphabetically, the way a shelf
  // is. "tools" is what answers "where is most of the kit".
  return value === 'city' || value === 'tools' ? value : 'name'
}
