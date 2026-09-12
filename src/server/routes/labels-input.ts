// The label list's query string. Pure; see input.ts.

import { LABEL_TEMPLATES, type LabelTemplate } from '../labels/generate'
import { invalid, valid, type Parsed } from './input'

export const DEFAULT_LABEL_LIMIT = 48
export const MAX_LABEL_LIMIT = 200

export type LabelListQuery = {
  direction: 'asc' | 'desc'
  limit: number
  offset: number
  // One arrangement's labels, out of all of them. The organizer's own screen
  // does not need this; a link from it does.
  organizerId: null | number
  search: null | string
  template: null | LabelTemplate
}

export function parseLabelListQuery(params: URLSearchParams): Parsed<LabelListQuery> {
  const template = params.get('template')?.trim()
  if (template && !isLabelTemplate(template)) {
    return invalid(`template must be one of: ${LABEL_TEMPLATES.join(', ')}`)
  }

  const organizerId = params.get('organizerId')?.trim()
  if (organizerId && parseId(organizerId) === null) {
    return invalid('organizerId must be the id of an organizer')
  }

  return valid({
    // Newest first: the screen is opened to find what was printed last, and a
    // label made a year ago is the one nobody is looking for.
    direction: params.get('order')?.trim().toLowerCase() === 'asc' ? 'asc' : 'desc',
    limit: clampInteger(params.get('limit'), DEFAULT_LABEL_LIMIT, 1, MAX_LABEL_LIMIT),
    offset: clampInteger(params.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER),
    organizerId: organizerId ? parseId(organizerId) : null,
    // A label has no name of its own, so the search is about the arrangement
    // and the box it belongs to — the same words the organizer list matches.
    search: params.get('q')?.trim() || null,
    template: template ? (template as LabelTemplate) : null,
  })
}

// The ids a sheet is asked for, as a query string: the screen opens the PDF in
// a tab rather than downloading it through a script, and a tab is a GET.
//
// As many as the list itself will show at once, so "show everything, tick
// everything, print it" cannot end in a refusal. Each label is drawn from
// scratch — fifty take about three seconds — which is why there is a ceiling
// at all, and why it is the list's rather than a round thousand.
export const MAX_SHEET_IDS = MAX_LABEL_LIMIT

export function parseSheetIds(params: URLSearchParams): Parsed<number[]> {
  const raw = (params.get('ids') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  if (raw.length === 0) return invalid('Nie wybrano żadnej etykiety')
  if (raw.length > MAX_SHEET_IDS) return invalid(`Maksymalnie ${MAX_SHEET_IDS} etykiet naraz`)

  const ids: number[] = []
  for (const value of raw) {
    const id = parseId(value)
    if (id === null) return invalid(`Nieprawidłowy identyfikator: ${value}`)
    // The same picture twice on a sheet is a decision nobody made here; the
    // selection that produced this link cannot hold one label twice either.
    if (!ids.includes(id)) ids.push(id)
  }

  return valid(ids)
}

function isLabelTemplate(value: string): value is LabelTemplate {
  return (LABEL_TEMPLATES as readonly string[]).includes(value)
}

function parseId(raw: string): null | number {
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) return null
  return value
}

function clampInteger(raw: null | string, fallback: number, min: number, max: number): number {
  const value = Number(raw)
  if (!raw || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), min), max)
}
