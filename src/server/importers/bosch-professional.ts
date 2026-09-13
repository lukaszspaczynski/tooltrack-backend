// Reading a product page off bosch-professional.com — the blue line's own site.
//
// The third shape in three sources. This one publishes a schema.org Product
// like the shop does, but leaves the spec table, the category and the
// documents out of it: the table is markup, the category is in the analytics
// payload, and every manual's real title is the text of its link rather than
// the heading above it.
//
// Pure, like every importer. The fetching lives in routes/tool-import.ts.

import { manualTitle, mergeDuplicates } from './attributes'
import { text } from './html'
import type { ImportedAttribute, ImportedManual, ImportedProduct, Importer } from './types'

// The page names it exactly as the catalog does, so nothing has to be mapped.
const BRAND = 'Bosch Professional'

export const boschProfessional: Importer = {
  hosts: ['bosch-professional.com', 'www.bosch-professional.com'],
  label: 'bosch-professional.com',
  manuals: true,
  parse: parseBoschProfessionalProduct,
}

export function parseBoschProfessionalProduct(
  html: string,
  pageUrl: string,
): null | ImportedProduct {
  const product = findProduct(html)
  if (!product) return null

  const name = text(String(product.name ?? ''))
  if (!name) return null

  return {
    attributes: attributesOf(html, product),
    brand: text(String((product.brand as { name?: unknown })?.name ?? '')) || BRAND,
    category: categoryOf(html),
    manuals: manualsOf(html),
    model: modelOf(name),
    notes: text(String(product.description ?? '')),
    name,
    photoUrls: photosOf(product),
    sourceUrl: pageUrl,
  }
}

type Product = Record<string, unknown>

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

// "PRO GBH 18V-26F" — the line and the model, written as one. The catalog
// keeps the line in the brand, so the model is the rest.
export function modelOf(name: string): string {
  return name.replace(/^PRO\s+/i, '').trim()
}

// The kind of tool, out of the analytics payload the page sends about itself.
//
// An odd place to read it from, and the only one that has it: the JSON-LD
// carries no category, and the breadcrumb markup on this site is a list of
// empty names. The last entry is the product, so the one before it is what it
// is a kind of.
export function categoryOf(html: string): string {
  const written = /utag_data\.page_breadcrumb\s*=\s*(\[[^\]]*\])/.exec(html)?.[1]
  if (!written) return ''

  let crumbs: unknown
  try {
    crumbs = JSON.parse(written)
  } catch {
    return ''
  }

  if (!Array.isArray(crumbs) || crumbs.length < 2) return ''

  const kind = crumbs.at(-2)

  return typeof kind === 'string' ? text(kind) : ''
}

// The spec table, which is markup here rather than data.
//
// A row is two cells; the first is the parameter and the second its value. The
// name carries a footnote marker — "Napięcie akumulatora*" — which is a
// reference to small print the card has no room for.
export function specifications(html: string): ImportedAttribute[] {
  const attributes: ImportedAttribute[] = []

  const rows = html.split(/class="table__body-row"/).slice(1)
  for (const row of rows) {
    const cells = [...row.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)]
      .map((cell) => text(cell[1]))
      .filter(Boolean)

    const [name, value] = cells
    if (!name || !value) continue

    attributes.push({ name: name.replace(/\*+$/, '').trim(), value })
  }

  return attributes
}

function attributesOf(html: string, product: Product): ImportedAttribute[] {
  const attributes = specifications(html)

  const sku = text(String(product.sku ?? ''))
  if (sku) attributes.push({ name: 'Numer katalogowy', value: sku })

  // Thirteen digits or it is not a barcode, whatever the field is called.
  const ean = text(String(product.gtin13 ?? ''))
  if (/^\d{13}$/.test(ean)) attributes.push({ name: 'Kod EAN', value: ean })

  return mergeDuplicates(attributes)
}

// Every PDF the page links to, titled by the text of its own link.
//
// The heading above a download block says "Instrukcja obsługi" for all of
// them; the link says which machines it covers — "Instrukcja obsługi | GBH
// 18V-26, GBH 18V-26 F" — and that is what tells two documents apart on a
// card. Unlike the DIY site, this page lists only its own product's files, so
// there is nothing to filter out.
export function manualsOf(html: string): ImportedManual[] {
  const manuals: ImportedManual[] = []
  const seen = new Set<string>()

  for (const link of html.matchAll(
    /<a\s[^>]*href="(https:\/\/[^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const url = link[1]
    if (seen.has(url)) continue

    seen.add(url)
    manuals.push({ title: manualTitle(text(link[2])), url })
  }

  return manuals
}

function photosOf(product: Product): string[] {
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
