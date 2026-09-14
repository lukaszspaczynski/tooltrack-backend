// Which script reads which shop.
//
// An importer is chosen by the host of the address somebody pasted, and an
// address from anywhere else is refused rather than guessed at: a page this
// server has never been taught to read would produce a card full of empty
// fields, and the person would have to undo it.

import {
  MAX_ATTRIBUTE_NAME_LENGTH,
  MAX_ATTRIBUTE_VALUE_LENGTH,
  MAX_FIELD_LENGTH,
  MAX_NAME_LENGTH,
  MAX_NOTES_LENGTH,
} from '../routes/tools-input'
import { boschDiy } from './bosch-diy'
import { boschProfessional } from './bosch-professional'
import { gardena } from './gardena'
import { lidl } from './lidl'
import { mistama } from './mistama'
import { nac } from './nac'
import { skil } from './skil'
import { stanley } from './stanley'
import type { ImportedProduct, Importer } from './types'

export type { ImportedAttribute, ImportedProduct, Importer } from './types'

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

export function importerFor(rawUrl: string): null | Importer {
  let url: URL
  try {
    url = new URL(rawUrl.trim())
  } catch {
    return null
  }

  // Only what a browser would fetch. A `file:` or `data:` address matching a
  // host by accident is not a shop.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

  const host = url.hostname.toLocaleLowerCase('en-US')

  return IMPORTERS.find((importer) => importer.hosts.includes(host)) ?? null
}

// Where the card came from, as a parameter of the tool.
//
// A card that arrived by import is a card somebody will want to check against
// its source: the shop corrects a spec, a photograph is added, somebody asks
// where "9,400 kg" came from. The address answers all three, and a parameter
// is where the card already keeps facts of that kind.
export const REFERENCE_ATTRIBUTE = 'Referencja'

// A page has no idea what a card can hold. Everything is cut to the length the
// column takes rather than refused: a description two characters over the
// limit is not a reason to fail an import somebody is watching.
//
// The reference is added here rather than by each importer, so a script added
// later cannot forget it — and after the clamping rather than before, because
// an address cut in the middle is not an address.
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
    attributes: [
      ...product.attributes
        .map((attribute) => ({
          name: clamp(attribute.name, MAX_ATTRIBUTE_NAME_LENGTH),
          value: clamp(attribute.value, MAX_ATTRIBUTE_VALUE_LENGTH),
        }))
        .filter((attribute) => attribute.name && attribute.value)
        // Whatever a page calls it, the reference is the one this adds.
        .filter((attribute) => attribute.name !== REFERENCE_ATTRIBUTE),
      { name: REFERENCE_ATTRIBUTE, value: sourceUrl },
    ],
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
