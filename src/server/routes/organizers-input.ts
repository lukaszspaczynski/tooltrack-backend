// Organizer bodies and list query strings. Pure; see input.ts.

import { MAX_CONTENTS_PHOTOS } from '../labels/contents-label'
import { clampLimit, clampOffset, ORGANIZER_PAGING } from './paging'
import { captionSource } from '../labels/generate'
import { z } from 'zod'

import { invalid, NOT_AN_OBJECT, parseWith, valid, type Parsed } from './input'
import { t } from '../i18n'

export const MAX_NAME_LENGTH = 200
export const MAX_DESCRIPTION_LENGTH = 4000
export const MAX_NUMBER = 100_000

export const DEFAULT_LIMIT = ORGANIZER_PAGING.default
export const MAX_LIMIT = ORGANIZER_PAGING.max

export type OrganizerFields = {
  // Where the arrangement is kept. Null is "nobody has said".
  addressId: null | number
  caseId: number
  description: string
  name: string
  // Null means "give me the next free one". The store decides, because only
  // it can see what is taken.
  number: null | number
}

export type OrganizerPatch = Partial<Omit<OrganizerFields, 'number'>> & { number?: number }

export type OrganizerQuery = {
  caseId: null | number
  direction: 'asc' | 'desc'
  limit: number
  offset: number
  search: null | string
  sort: 'name' | 'number'
}

const required = (max: number, field: string) =>
  z
    .string({ error: () => `${field} must be a non-empty string` })
    .trim()
    .min(1, { error: () => `${field} must be a non-empty string` })
    .max(max, { error: () => `${field} must be at most ${max} characters` })

// The id of a row this one points at, or null for "nobody has said". A select
// that was emptied sends '', which is the same null as never having chosen.
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

// A form sends "12", so a string is taken and coerced.
const id = (complaint: string) =>
  z
    .union([z.number(), z.string()])
    .transform((raw) => (typeof raw === 'string' ? Number(raw.trim()) : raw))
    .refine((value) => Number.isSafeInteger(value) && value > 0, { error: () => complaint })

const NUMBER = z
  .union([z.number(), z.string()])
  .transform((raw) => (typeof raw === 'string' ? Number(raw.trim()) : raw))
  .refine((value) => Number.isInteger(value) && value > 0 && value <= MAX_NUMBER, {
    error: () => `number must be a whole number from 1 to ${MAX_NUMBER}`,
  })

export const ORGANIZER_PATCH_SCHEMA = z
  .object(
    {
      // Unlike the case, this one may be cleared: an arrangement always sits in
      // a box, and does not always sit anywhere anybody has written down.
      addressId: reference('addressId').optional(),
      // Null would leave an arrangement of nothing, so moving an organizer to
      // another case is allowed but emptying it is not.
      caseId: id('caseId must be the id of a case').optional(),
      description: z
        .string({ error: () => 'description must be a string' })
        .trim()
        .max(MAX_DESCRIPTION_LENGTH, {
          error: () => `description must be at most ${MAX_DESCRIPTION_LENGTH} characters`,
        })
        .optional(),
      name: required(MAX_NAME_LENGTH, 'name').optional(),
      number: NUMBER.optional(),
    },
    NOT_AN_OBJECT,
  )
  .strip()

export const ORGANIZER_CREATE_SCHEMA = ORGANIZER_PATCH_SCHEMA.extend({
  // An organizer without a case is an arrangement of nothing. The wizard asks
  // for the case first for the same reason.
  caseId: id('caseId is required'),
  name: required(MAX_NAME_LENGTH, 'name'),
  // Null means "give me the next free one". The store decides, because only it
  // can see what is taken.
  number: NUMBER.nullish(),
  itemIds: z.array(z.unknown()).optional(),
})

export function parseOrganizerCreate(body: unknown): Parsed<OrganizerFields> {
  const parsed = parseWith(ORGANIZER_CREATE_SCHEMA, body)
  if (!parsed.ok) return parsed

  return valid({
    addressId: parsed.value.addressId ?? null,
    caseId: parsed.value.caseId,
    description: parsed.value.description ?? '',
    name: parsed.value.name,
    number: parsed.value.number ?? null,
  })
}

export function parseOrganizerPatch(body: unknown): Parsed<OrganizerPatch> {
  const parsed = parseWith(ORGANIZER_PATCH_SCHEMA, body)
  if (!parsed.ok) return parsed

  if (Object.keys(parsed.value).length === 0) {
    return invalid('No editable fields in request body')
  }

  return parsed
}

// One shape for the two selections this domain takes. Everything else about a
// redraw is already on the row, which is the point of keeping the options.
function idsSchema(
  field: 'labelIds' | 'itemIds',
  max: number,
  empty: () => string,
  tooMany: () => string,
) {
  return z
    .object(
      {
        [field]: z
          .array(z.unknown(), { error: () => `${field} must be an array` })
          .min(1, { error: empty })
          .max(max, { error: tooMany }),
      },
      NOT_AN_OBJECT,
    )
    .strip()
}

// The messages are written out rather than built from `max`, because `t()`
// keys on the Polish sentence: one assembled from pieces has no entry in
// i18n/catalog.ts and goes out untranslated, which a test here catches.
export const ITEM_IDS_SCHEMA = idsSchema(
  'itemIds',
  200,
  () => 'itemIds must not be empty',
  () => t('Maksymalnie 200 narzędzi naraz'),
)

export const LABEL_IDS_SCHEMA = idsSchema(
  'labelIds',
  50,
  () => t('Nie wybrano żadnej etykiety'),
  () => 'Maksymalnie 50 etykiet naraz',
)

function wholeNumbers(raw: unknown[], field: string): Parsed<number[]> {
  const ids: number[] = []

  for (const value of raw) {
    const parsed = parseId(value)
    if (parsed === null) return invalid(`${field} must be whole numbers`)
    if (!ids.includes(parsed)) ids.push(parsed)
  }

  return valid(ids)
}

export function parseItemIds(body: unknown): Parsed<number[]> {
  const parsed = parseWith(ITEM_IDS_SCHEMA, body)

  return parsed.ok ? wholeNumbers(parsed.value.itemIds as unknown[], 'itemIds') : parsed
}

export function parseLabelIds(body: unknown): Parsed<number[]> {
  const parsed = parseWith(LABEL_IDS_SCHEMA, body)

  return parsed.ok ? wholeNumbers(parsed.value.labelIds as unknown[], 'labelIds') : parsed
}

// A label is 30 mm across. Past this the template can only shrink the type
// until nobody can read it, so the refusal belongs here rather than in a
// drawing that quietly gives up.
const CAPTION_MAX = 120

export type LabelRequest = {
  options: Record<string, unknown>
  slotId: number
  template: 'contents' | 'number'
}

const caption = z
  .string()
  .trim()
  .max(CAPTION_MAX, {
    error: () => t('Własny tekst może mieć najwyżej {max} znaków', { max: CAPTION_MAX }),
  })

// What the wizard sends when it finishes. The size is not in here: it comes
// from the slot, which is one of the case's, so a label cannot be printed at a
// size the box has no place for.
export const LABEL_REQUEST_SCHEMA = z
  .object(
    {
      namesSource: z.string().trim().optional(),
      namesText: caption.optional(),
      // The ceiling any label has. How many this one actually holds depends on
      // its shape, and the shape comes from the slot, which this schema has no
      // business resolving — the route checks that once it has one. Silently
      // dropping the extras is what neither of them does.
      photoIds: z
        .array(z.unknown(), { error: () => 'photoIds must be an array' })
        .max(MAX_CONTENTS_PHOTOS, {
          error: () => t('Maksymalnie {max} zdjęcia', { max: MAX_CONTENTS_PHOTOS }),
        })
        .optional(),
      // Default on: a label is made to be printed, and somebody who wants the
      // bare artwork can say so.
      printReady: z.boolean().optional(),
      slotId: id('slotId is required'),
      template: z.enum(['number', 'contents'], {
        error: () => 'template must be "number" or "contents"',
      }),
      titleText: caption.optional(),
      withLogos: z.boolean().optional(),
      withNames: z.boolean().optional(),
      withTitle: z.boolean().optional(),
    },
    NOT_AN_OBJECT,
  )
  .strip()

export function parseLabelRequest(body: unknown): Parsed<LabelRequest> {
  const parsed = parseWith(LABEL_REQUEST_SCHEMA, body)
  if (!parsed.ok) return parsed

  const input = parsed.value
  const printReady = input.printReady !== false

  if (input.template === 'number') {
    return valid({
      options: { printReady, template: input.template, withLogos: input.withLogos === true },
      slotId: input.slotId,
      template: input.template,
    })
  }

  const photoIds = wholeNumbers((input.photoIds ?? []) as unknown[], 'photoIds')
  if (!photoIds.ok) return photoIds

  // Empty means "work it out": the organizer's name over the rule, the item
  // names under it. Anything else is what somebody typed instead, and the label
  // says that rather than what the catalog thinks.
  const namesText = input.namesText ?? ''

  return valid({
    options: {
      // Normalised on the way in, so a stored row always says outright where
      // its caption came from.
      namesSource: captionSource({ namesSource: input.namesSource ?? '', namesText }),
      namesText,
      photoIds: photoIds.value,
      printReady,
      template: input.template,
      titleText: input.titleText ?? '',
      withNames: input.withNames === true,
      withTitle: input.withTitle === true,
    },
    slotId: input.slotId,
    template: input.template,
  })
}

export function parseOrganizerQuery(params: URLSearchParams): Parsed<OrganizerQuery> {
  return valid({
    caseId: parseId(params.get('caseId')) ?? null,
    direction: params.get('order')?.trim().toLowerCase() === 'desc' ? 'desc' : 'asc',
    limit: clampLimit(params.get('limit'), ORGANIZER_PAGING),
    offset: clampOffset(params.get('offset')),
    search: params.get('q')?.trim() || null,
    // By number, ascending: that is the order they are stacked in and the
    // order people read them.
    sort: params.get('sort')?.trim() === 'name' ? 'name' : 'number',
  })
}

function parseId(raw: unknown): null | number {
  const value = typeof raw === 'string' ? Number(raw.trim()) : raw
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return null
  return value
}

function parseNumber(raw: unknown): null | number {
  const value = typeof raw === 'string' ? Number(raw.trim()) : raw
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  if (value <= 0 || value > MAX_NUMBER) return null
  return value
}
