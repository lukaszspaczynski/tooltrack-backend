// Which script reads which shop.
//
// An importer is chosen by the host of the address somebody pasted, and an
// address from anywhere else is refused rather than guessed at: a page this
// server has never been taught to read would produce a card full of empty
// fields, and the person would have to undo it.

import {
  MAX_ATTRIBUTE_NAME_LENGTH,
  MAX_ATTRIBUTE_VALUE_LENGTH,
  MAX_CAPACITY_L,
  MAX_DIMENSION_MM,
  MAX_FIELD_LENGTH,
  MAX_LOAD_KG,
  MAX_NAME_LENGTH,
  MAX_NOTES_LENGTH,
} from '../routes/items-input'
import { boschDiy } from './bosch-diy'
import { boschHome } from './bosch-home'
import { boschProfessional } from './bosch-professional'
import { ceneo } from './ceneo'
import { electrolux } from './electrolux'
import { gardena } from './gardena'
import { lidl } from './lidl'
import { mistama } from './mistama'
import { nac } from './nac'
import { qbrick } from './qbrick'
import { skil } from './skil'
import { stanley } from './stanley'
import { xkom } from './x-kom'
import type { ImportedProduct, Importer } from './types'

export type { ImportedAttribute, ImportedProduct, Importer } from './types'

// One registry. There were two while a case was a table of its own: the
// scripts answered different shapes, so a dialog asking "where is this box
// from" could not be shown the same list as one asking about a drill.
//
// They answer the same shape now, and which sort of card a page describes is
// the page's business rather than the registry's — qbricksystem.com sells
// boxes and says so, and nothing here has to know that.
const IMPORTERS: readonly Importer[] = [
  mistama,
  boschDiy,
  boschProfessional,
  skil,
  stanley,
  lidl,
  nac,
  gardena,
  qbrick,
  ceneo,
  boschHome,
  electrolux,
  xkom,
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
      .filter((attribute) => attribute.name && attribute.value)
      .filter(plausible),
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
    // "1770x910x720 mm" is three measurements written as one and not a
    // decimal point out of place; only a value that reads as one number can
    // be judged, and one that does not is left as the page wrote it.
    if (!Number.isFinite(measured)) return true
    return measured > 0 && measured <= most
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
