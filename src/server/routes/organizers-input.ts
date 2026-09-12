// Organizer bodies and list query strings. Pure; see input.ts.

import { MAX_CONTENTS_PHOTOS } from '../labels/contents-label'
import { invalid, isPlainObject, trimmedString, valid, type Parsed } from './input'

export const MAX_NAME_LENGTH = 200
export const MAX_DESCRIPTION_LENGTH = 4000
export const MAX_NUMBER = 100_000

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 200

export type OrganizerFields = {
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

export function parseOrganizerCreate(body: unknown): Parsed<OrganizerFields> {
  if (!isPlainObject(body)) return invalid('Expected a JSON object')

  const name = trimmedString(body.name) ?? ''
  if (!name) return invalid('name is required')
  if (name.length > MAX_NAME_LENGTH) {
    return invalid(`name must be at most ${MAX_NAME_LENGTH} characters`)
  }

  // An organizer without a case is an arrangement of nothing. The wizard asks
  // for the case first for the same reason.
  const caseId = parseId(body.caseId)
  if (caseId === null) return invalid('caseId is required')

  const description = trimmedString(body.description ?? '')
  if (description === null) return invalid('description must be a string')
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return invalid(`description must be at most ${MAX_DESCRIPTION_LENGTH} characters`)
  }

  if ('number' in body && body.number !== null && body.number !== undefined) {
    const number = parseNumber(body.number)
    if (number === null) return invalid(`number must be a whole number from 1 to ${MAX_NUMBER}`)
    return valid({ caseId, description, name, number })
  }

  return valid({ caseId, description, name, number: null })
}

export function parseOrganizerPatch(body: unknown): Parsed<OrganizerPatch> {
  if (!isPlainObject(body)) return invalid('Expected a JSON object')

  const patch: OrganizerPatch = {}

  if ('name' in body) {
    const name = trimmedString(body.name)
    if (!name) return invalid('name must be a non-empty string')
    if (name.length > MAX_NAME_LENGTH) {
      return invalid(`name must be at most ${MAX_NAME_LENGTH} characters`)
    }
    patch.name = name
  }

  if ('description' in body) {
    const description = trimmedString(body.description)
    if (description === null) return invalid('description must be a string')
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      return invalid(`description must be at most ${MAX_DESCRIPTION_LENGTH} characters`)
    }
    patch.description = description
  }

  if ('caseId' in body) {
    const caseId = parseId(body.caseId)
    // Null would leave an arrangement of nothing, so moving an organizer to
    // another case is allowed but emptying it is not.
    if (caseId === null) return invalid('caseId must be the id of a case')
    patch.caseId = caseId
  }

  if ('number' in body) {
    const number = parseNumber(body.number)
    if (number === null) return invalid(`number must be a whole number from 1 to ${MAX_NUMBER}`)
    patch.number = number
  }

  if (Object.keys(patch).length === 0) return invalid('No editable fields in request body')

  return valid(patch)
}

// The ids a wizard sends when it has finished picking tools.
export function parseToolIds(body: unknown): Parsed<number[]> {
  if (!isPlainObject(body)) return invalid('Expected a JSON object')
  if (!Array.isArray(body.toolIds)) return invalid('toolIds must be an array')
  if (body.toolIds.length === 0) return invalid('toolIds must not be empty')
  if (body.toolIds.length > 200) return invalid('Maksymalnie 200 narzędzi naraz')

  const ids: number[] = []
  for (const raw of body.toolIds) {
    const id = parseId(raw)
    if (id === null) return invalid('toolIds must be whole numbers')
    if (!ids.includes(id)) ids.push(id)
  }

  return valid(ids)
}

// Which labels to draw again. Ids only: everything else about a redraw is
// already on the row, which is the point of keeping the options.
export function parseLabelIds(body: unknown): Parsed<number[]> {
  if (!isPlainObject(body)) return invalid('Expected a JSON object')
  if (!Array.isArray(body.labelIds)) return invalid('labelIds must be an array')
  if (body.labelIds.length === 0) return invalid('Nie wybrano żadnej etykiety')
  if (body.labelIds.length > 50) return invalid('Maksymalnie 50 etykiet naraz')

  const ids: number[] = []
  for (const raw of body.labelIds) {
    const id = parseId(raw)
    if (id === null) return invalid('labelIds must be whole numbers')
    if (!ids.includes(id)) ids.push(id)
  }

  return valid(ids)
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

// What the wizard sends when it finishes. The size is not in here: it comes
// from the slot, which is one of the case's, so a label cannot be printed at a
// size the box has no place for.
export function parseLabelRequest(body: unknown): Parsed<LabelRequest> {
  if (!isPlainObject(body)) return invalid('Expected a JSON object')

  const slotId = parseId(body.slotId)
  if (slotId === null) return invalid('slotId is required')

  const template = trimmedString(body.template)
  if (template !== 'number' && template !== 'contents') {
    return invalid('template must be "number" or "contents"')
  }

  // Default on: a label is made to be printed, and somebody who wants the bare
  // artwork can say so.
  const printReady = body.printReady !== false

  if (template === 'number') {
    return valid({
      options: { printReady, template, withLogos: body.withLogos === true },
      slotId,
      template,
    })
  }

  const photoIds: number[] = []
  if ('photoIds' in body) {
    if (!Array.isArray(body.photoIds)) return invalid('photoIds must be an array')
    // The ceiling any label has. How many this one actually holds depends on
    // its shape, and the shape comes from the slot, which this parser has no
    // business resolving — the route checks that once it has one. Silently
    // dropping the extras is what neither of them does.
    if (body.photoIds.length > MAX_CONTENTS_PHOTOS) {
      return invalid(`Maksymalnie ${MAX_CONTENTS_PHOTOS} zdjęcia`)
    }

    for (const raw of body.photoIds) {
      const id = parseId(raw)
      if (id === null) return invalid('photoIds must be whole numbers')
      if (!photoIds.includes(id)) photoIds.push(id)
    }
  }

  // Empty means "work it out": the organizer's name over the rule, the tool
  // names under it. Anything else is what somebody typed instead, and the
  // label says that rather than what the catalog thinks. The same convention
  // as brand.color, where empty is not a value but the absence of one.
  const titleText = trimmedString(body.titleText ?? '') ?? ''
  const namesText = trimmedString(body.namesText ?? '') ?? ''
  if (titleText.length > CAPTION_MAX || namesText.length > CAPTION_MAX) {
    return invalid(`Własny tekst może mieć najwyżej ${CAPTION_MAX} znaków`)
  }

  return valid({
    options: {
      namesText,
      photoIds,
      printReady,
      template,
      titleText,
      withNames: body.withNames === true,
      withTitle: body.withTitle === true,
    },
    slotId,
    template,
  })
}

export function parseOrganizerQuery(params: URLSearchParams): Parsed<OrganizerQuery> {
  return valid({
    caseId: parseId(params.get('caseId')) ?? null,
    direction: params.get('order')?.trim().toLowerCase() === 'desc' ? 'desc' : 'asc',
    limit: clampInteger(params.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT),
    offset: clampInteger(params.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER),
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

function clampInteger(raw: null | string, fallback: number, min: number, max: number): number {
  const value = Number(raw)
  if (!raw || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), min), max)
}
