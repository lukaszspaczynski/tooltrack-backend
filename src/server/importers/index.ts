// Which script reads which shop.
//
// An importer is chosen by the host of the address somebody pasted, and an
// address from anywhere else is refused rather than guessed at: a page this
// server has never been taught to read would produce a card full of empty
// fields, and the person would have to undo it.

import {
  MAX_CAPACITY_L,
  MAX_DIMENSION_MM,
  MAX_FIELD_LENGTH as MAX_CASE_FIELD_LENGTH,
  MAX_LOAD_KG,
  MAX_NAME_LENGTH as MAX_CASE_NAME_LENGTH,
  MAX_NOTES_LENGTH as MAX_CASE_NOTES_LENGTH,
} from '../routes/cases-input'
import {
  MAX_ATTRIBUTE_NAME_LENGTH,
  MAX_ATTRIBUTE_VALUE_LENGTH,
  MAX_FIELD_LENGTH,
  MAX_NAME_LENGTH,
  MAX_NOTES_LENGTH,
} from '../routes/items-input'
import { boschDiy } from './bosch-diy'
import { boschProfessional } from './bosch-professional'
import { gardena } from './gardena'
import { lidl } from './lidl'
import { mistama } from './mistama'
import { nac } from './nac'
import { qbrick } from './qbrick'
import { skil } from './skil'
import { stanley } from './stanley'
import type { CaseImporter, ImportedCase, ImportedProduct, Importer } from './types'

export type {
  CaseImporter,
  ImportedAttribute,
  ImportedCase,
  ImportedProduct,
  Importer,
} from './types'

const IMPORTERS: readonly Importer[] = [
  mistama,
  boschDiy,
  boschProfessional,
  skil,
  stanley,
  lidl,
  nac,
  gardena,
]

// What the import dialog lists, so the screen never offers a source this
// server cannot actually read.
export const IMPORT_SOURCES = IMPORTERS.map((importer) => ({
  host: importer.hosts[0],
  label: importer.label,
  // So a screen asking for documents can offer only the pages that have any.
  manuals: importer.manuals,
}))

// The sources worth offering when what is wanted is a manual.
export const MANUAL_SOURCES = IMPORT_SOURCES.filter((source) => source.manuals)

// The scripts that read a case rather than an item. A separate registry rather
// than a flag on the same one: the two answer with different shapes, and a
// dialog asking "where is this box from" should not offer a page that sells
// drills.
const CASE_IMPORTERS: readonly CaseImporter[] = [qbrick]

export const CASE_IMPORT_SOURCES = CASE_IMPORTERS.map((importer) => ({
  host: importer.hosts[0],
  label: importer.label,
}))

export function caseImporterFor(rawUrl: string): null | CaseImporter {
  const host = hostOf(rawUrl)

  return host === null ? null : (CASE_IMPORTERS.find((i) => i.hosts.includes(host)) ?? null)
}

export function importerFor(rawUrl: string): null | Importer {
  const host = hostOf(rawUrl)

  return host === null ? null : (IMPORTERS.find((i) => i.hosts.includes(host)) ?? null)
}

// The host, when the address is one a browser would fetch. A `file:` or `data:`
// address matching a host by accident is not a shop.
function hostOf(rawUrl: string): null | string {
  let url: URL
  try {
    url = new URL(rawUrl.trim())
  } catch {
    return null
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

  return url.hostname.toLocaleLowerCase('en-US')
}

// A page has no idea what a card can hold. Everything is cut to the length the
// column takes rather than refused: a description two characters over the
// limit is not a reason to fail an import somebody is watching.
//
// `sourceUrl` comes back cleaned rather than clamped: it is a field on the
// card now, with room for any address a shop writes, and an address cut in the
// middle is not an address.
// What a link picks up on its way to somebody: the analytics tail a shop adds
// when the address is shared or clicked through from a campaign. It says
// nothing about the product and it is what the card would show as its source
// for ever after, so it is cut before the address is written down.
const TRACKING_PARAMS = /^(?:_gl|_ga.*|gclid|fbclid|msclkid|mc_[a-z]+|utm_[a-z]+)$/i

export function withoutTracking(rawUrl: string): string {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return rawUrl
  }

  for (const name of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(name)) url.searchParams.delete(name)
  }

  return url.toString().replace(/\?$/, '')
}

export function fitToCard(product: ImportedProduct): ImportedProduct {
  const sourceUrl = withoutTracking(product.sourceUrl)

  return {
    ...product,
    sourceUrl,
    attributes: product.attributes
      .map((attribute) => ({
        name: clamp(attribute.name, MAX_ATTRIBUTE_NAME_LENGTH),
        value: clamp(attribute.value, MAX_ATTRIBUTE_VALUE_LENGTH),
      }))
      .filter((attribute) => attribute.name && attribute.value),
    brand: clamp(product.brand, MAX_FIELD_LENGTH),
    category: clamp(product.category, MAX_FIELD_LENGTH),
    model: clamp(product.model, MAX_FIELD_LENGTH),
    name: clamp(product.name, MAX_NAME_LENGTH),
    notes: clamp(product.notes, MAX_NOTES_LENGTH),
  }
}

// Cut on a word where there is one, and say that something was cut. A value
// ending mid-word reads like the page was truncated by accident.
function clamp(value: string, limit: number): string {
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= limit) return trimmed

  const cut = trimmed.slice(0, limit - 1)
  const lastSpace = cut.lastIndexOf(' ')

  return `${(lastSpace > limit / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

// A page has no idea what a case can hold, the same way it has no idea what a
// card can. Text is cut to the column, and a measurement the page states in
// micrometres or in a thousand litres is dropped rather than stored: a number
// nobody can have measured is worse than an empty field, because it looks like
// a fact.
export function fitCaseToCard(imported: ImportedCase): ImportedCase {
  const sourceUrl = withoutTracking(imported.sourceUrl)

  return {
    ...imported,
    sourceUrl,
    // A measurement that reads outside what a box can be is dropped rather
    // than stored: a number nobody can have measured looks like a fact once it
    // is on a card. The importer parses each one before writing it as a
    // string, so the check is on the number and what reaches here is already
    // "450 mm" — what is left to do is throw out the absurd ones.
    attributes: imported.attributes
      .map((attribute) => ({
        name: clamp(attribute.name, MAX_ATTRIBUTE_NAME_LENGTH),
        value: clamp(attribute.value, MAX_ATTRIBUTE_VALUE_LENGTH),
      }))
      .filter((attribute) => attribute.name && attribute.value)
      .filter(plausible),
    manufacturer: clamp(imported.manufacturer, MAX_CASE_NAME_LENGTH),
    name: clamp(imported.name, MAX_CASE_NAME_LENGTH),
    notes: clamp(imported.notes, MAX_CASE_NOTES_LENGTH),
    model: clamp(imported.model, MAX_CASE_FIELD_LENGTH),
  }
}

// The ceilings a box cannot be above. They were CHECK constraints while these
// were columns; free text has no CHECK, so the reading is where it happens —
// a page that states 495000 mm is a page with a decimal point in the wrong
// place, and a card saying so is worse than a card saying nothing.
const CEILINGS: [suffix: string, most: number][] = [
  [' mm', MAX_DIMENSION_MM],
  [' L', MAX_CAPACITY_L],
  [' kg', MAX_LOAD_KG],
]

function plausible(attribute: { name: string; value: string }): boolean {
  for (const [suffix, most] of CEILINGS) {
    if (!attribute.value.endsWith(suffix)) continue

    const measured = Number(attribute.value.slice(0, -suffix.length).replace(',', '.'))
    return Number.isFinite(measured) && measured > 0 && measured <= most
  }

  return true
}

// The same range the body parser enforces, applied here so that an import and
// a form cannot disagree about what a case can measure.
function withinRange(value: null | number, max: number, decimals: number): null | number {
  if (value === null || !Number.isFinite(value)) return null
  if (value <= 0 || value > max) return null
  if (decimals === 0 && !Number.isInteger(value)) return null

  return decimals === 0 ? value : Math.round(value * 10 ** decimals) / 10 ** decimals
}
