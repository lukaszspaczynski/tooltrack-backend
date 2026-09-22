// Reading a product page off ceneo.pl — the price comparison site, and the
// first source that is neither a shop nor a maker.
//
// The tenth shape, and the one the RTV/AGD half of the catalog is read from:
// a washing machine's maker publishes a marketing page and the shops publish
// a price, and it is Ceneo that publishes the spec table. A schema.org Product
// carries the name, the maker and the gallery; the specification is a table of
// groups under `#productTechSpecs`, with a "?" hint hanging off half the
// parameter names; and the category is the `product:category` path in the
// head, which is also what says whether the page describes a tool, an
// appliance or a box — Ceneo lists all three, so unlike every other source the
// kind is not a fact about the site.
//
// Pure, like every importer. The fetching lives in routes/item-import.ts.

import type { ItemKind } from '../routes/items-input'
import { mergeDuplicates } from './attributes'
import { text } from './html'
import type { ImportedAttribute, ImportedProduct, Importer } from './types'

export const ceneo: Importer = {
  hosts: ['ceneo.pl', 'www.ceneo.pl'],
  label: 'ceneo.pl',
  manuals: false,
  parse: parseCeneoProduct,
}

type Product = Record<string, unknown>

export function parseCeneoProduct(html: string, pageUrl: string): null | ImportedProduct {
  const product = findProduct(html)
  if (!product) return null

  const name = text(String(product.name ?? ''))
  if (!name) return null

  const path = categoryPath(html)
  const rows = specifications(html)
  const model = modelOf(name, rows)

  return {
    attributes: attributesOf(rows, model),
    brand: brandOf(product, html),
    category: path.at(-1) ?? '',
    kind: kindOf(path),
    manuals: [],
    model,
    name,
    notes: notesOf(html, product),
    photoUrls: photosOf(product),
    sourceUrl: sourceUrlOf(html, pageUrl),
  }
}

function findProduct(html: string): null | Product {
  for (const block of html.matchAll(
    /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    let data: unknown
    try {
      data = JSON.parse(block[1].trim())
    } catch {
      continue
    }

    const nodes = Array.isArray(data) ? data : [data]
    const product = nodes.find((node) => (node as Product | null)?.['@type'] === 'Product')
    if (product) return product as Product
  }

  return null
}

// The path Ceneo files the product under — "Sprzęt AGD > Małe AGD do kuchni >
// Ekspresy do kawy > Ekspresy ciśnieniowe". It is in the head as one string,
// and it stops where the categories stop: the breadcrumb on the page goes one
// step further, to a filter such as "Automatyczne", which is not a kind of
// thing. The breadcrumb is the fallback for a page without the meta tag.
export function categoryPath(html: string): string[] {
  const meta = /<meta[^>]+property="product:category"[^>]+content="([^"]*)"/i.exec(html)?.[1]
  if (meta) {
    return text(meta)
      .split('>')
      .map((crumb) => crumb.trim())
      .filter(Boolean)
  }

  const nav = /<nav[^>]*class="[^"]*breadcrumbs[^"]*"[^>]*>([\s\S]*?)<\/nav>/i.exec(html)?.[1]
  if (!nav) return []

  return [...nav.matchAll(/itemprop="name"[^>]*>([\s\S]*?)<\/span>/gi)]
    .map((crumb) => text(crumb[1]))
    .filter((crumb) => crumb && !/^ceneo$/i.test(crumb))
}

// What sort of card the page describes, read off where Ceneo files it. A box
// is asked about first because "Skrzynki narzędziowe" names tools too; a tool
// is anything filed under tools, the workshop or the garden — the garden
// because a mower and a pressure washer are already tools on every other
// source; and everything else Ceneo lists is an appliance, which is the whole
// reason the site is a source.
export function kindOf(path: string[]): ItemKind {
  if (path.some((crumb) => /skrzynk|walizk|organizer/i.test(crumb))) return 'case'
  if (path.some((crumb) => /narzędzi|narzedzi|warsztat|^ogród$/i.test(crumb))) return 'tool'

  return 'appliance'
}

// The spec table: groups of rows under one section, each row a name cell and
// a value cell. Half the names carry a "?" with a paragraph of advice hidden
// behind it, which is the site explaining what pressure is to somebody buying
// a coffee machine — it goes before the tags do, or every name would end in
// an essay.
export function specifications(html: string): ImportedAttribute[] {
  const section = /<section[^>]+id="productTechSpecs"[^>]*>([\s\S]*?)<\/section>/i.exec(html)?.[1]
  if (!section) return []

  const attributes: ImportedAttribute[] = []

  for (const row of section.matchAll(
    /<tr[^>]+class="product-spec__group__attributes__row"[^>]*>([\s\S]*?)<\/tr>/gi,
  )) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) =>
      text(withoutHints(cell[1])),
    )

    const [name, value] = cells
    if (!name || !value) continue

    attributes.push({ name, value })
  }

  return attributes
}

function withoutHints(cell: string): string {
  return cell.replace(/<span[^>]+class="hint-handle[^"]*"[^>]*>[\s\S]*?<\/span>\s*<\/span>/gi, '')
}

// The maker is a field on the card, so its row is not a parameter as well;
// the model's row stays unless it is what the card's model was read from.
function attributesOf(rows: ImportedAttribute[], model: string): ImportedAttribute[] {
  return mergeDuplicates(
    rows.filter((row) => {
      const name = row.name.toLocaleLowerCase('pl-PL')
      if (name === 'marka') return false
      if (name === 'model' && row.value === model) return false
      return true
    }),
  )
}

// The site states a model in the spec table, and it is the model when it has
// a number in it — "DCD796P1". When it does not — "LatteGO" — it is the line
// the machine belongs to, and the model is in the name instead, as the run of
// letters and digits that is neither a wattage nor a voltage: "Ekspres
// PHILIPS 2200 LatteGo EP2231/40 czarny" is a machine called EP2231/40.
export function modelOf(name: string, rows: ImportedAttribute[]): string {
  const stated = rows.find((row) => row.name.toLocaleLowerCase('pl-PL') === 'model')?.value ?? ''
  if (/\d/.test(stated)) return stated

  return name
    .split(/\s+/)
    .filter((token) => /\p{L}/u.test(token) && /\d/.test(token))
    .filter(
      (token) => !/^\d+(?:[.,]\d+)?\s*(?:w|v|ah|wh|l|kg|g|cm|mm|nm|bar|hz|"|cali?)$/i.test(token),
    )
    .join(' ')
}

function brandOf(product: Product, html: string): string {
  const stated = text(String((product.brand as { name?: unknown } | undefined)?.name ?? ''))
  if (stated) return stated

  const meta = /<meta[^>]+property="product:brand"[^>]+content="([^"]*)"/i.exec(html)?.[1]
  return meta ? text(meta) : ''
}

// The description Ceneo shows under "Opis": marketing prose with headings,
// which the Product's own `description` repeats cut off at six hundred
// characters with an ellipsis. The block is read line by line — a heading, a
// paragraph, a bullet — and each line that does not end a sentence is made
// to, so a heading does not run into the paragraph under it once the card
// folds the whole thing into one line. The Product's copy is the fallback,
// without its ellipsis.
export function notesOf(html: string, product: Product): string {
  const block =
    /<div[^>]+class="[^"]*js_product-full-description[^"]*"[^>]*>([\s\S]*?)(?:<div[^>]+class="js_article-desc-end"|<\/article>)/i.exec(
      html,
    )?.[1]

  if (block) {
    const lines = block
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
      .replace(/<\/?(?:h\d|p|li|div|br|article|ul|ol|tr|table)\b[^>]*>/gi, '\n')
      .split('\n')
      // An inline tag around a word leaves a space before the comma after it.
      .map((line) => text(line).replace(/\s+([,.?!:;])/g, '$1'))
      .filter(Boolean)

    const notes = lines.map((line) => (/[.!?:;]$/.test(line) ? line : `${line}.`)).join(' ')
    if (notes) return notes
  }

  return text(String(product.description ?? '')).replace(/(?:\.\.\.|…)$/, '')
}

// The gallery, full size: the Product lists the pictures under the `i-`
// prefix, which is the largest the image host serves.
export function photosOf(product: Product): string[] {
  const images = Array.isArray(product.image)
    ? product.image
    : typeof product.image === 'string'
      ? [product.image]
      : []

  const seen = new Set<string>()
  const urls: string[] = []

  for (const entry of images) {
    if (typeof entry !== 'string' || !entry.startsWith('http') || seen.has(entry)) continue

    seen.add(entry)
    urls.push(entry)
  }

  return urls
}

// The address the card keeps is the product's own — "https://www.ceneo.pl/
// 79216673" — rather than whatever was pasted: a link copied off the spec tab
// carries `#tab=spec`, and a link from a search carries the tail of one.
export function sourceUrlOf(html: string, pageUrl: string): string {
  const canonical = /<meta[^>]+property="og:url"[^>]+content="([^"]*)"/i.exec(html)?.[1]
  if (canonical && /^https:\/\/www\.ceneo\.pl\/\d+$/.test(canonical)) return canonical

  return pageUrl.split('#')[0]
}
