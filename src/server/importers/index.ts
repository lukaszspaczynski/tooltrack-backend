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
import { mistama } from './mistama'
import type { ImportedProduct, Importer } from './types'

export type { ImportedAttribute, ImportedProduct, Importer } from './types'

const IMPORTERS: readonly Importer[] = [mistama]

// What the import dialog lists, so the screen never offers a source this
// server cannot actually read.
export const IMPORT_SOURCES = IMPORTERS.map((importer) => ({
  host: importer.hosts[0],
  label: importer.label,
}))

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

// A page has no idea what a card can hold. Everything is cut to the length the
// column takes rather than refused: a description two characters over the
// limit is not a reason to fail an import somebody is watching.
export function fitToCard(product: ImportedProduct): ImportedProduct {
  return {
    ...product,
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
