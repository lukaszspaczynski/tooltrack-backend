// Reading a product page off gardena.com — the maker's own site.
//
// The eighth shape, and a Salesforce Commerce Cloud store rather than anything
// this server has read before. There is a proper schema.org Product, which
// carries the name, the maker, the article number and the gallery — and
// nothing else. Everything a person would call a specification is in the
// markup, as rows of two divs under a tab, so half of this reads the graph and
// half scrapes.
//
// Pure, like every importer. The fetching lives in routes/tool-import.ts.

import { mergeDuplicates } from './attributes'
import { text } from './html'
import type { ImportedAttribute, ImportedProduct, Importer } from './types'

export const gardena: Importer = {
  hosts: ['gardena.com', 'www.gardena.com'],
  label: 'gardena.com',
  // The only PDFs on a product page are the shop's own terms of sale. The
  // documents for the machine live behind "Serwis i dokumentacja produktu",
  // which is a link to a support section and a list this page fetches after it
  // has rendered. An importer is handed one page and makes no requests of its
  // own, so what this one can promise is what the page itself says, and it says
  // none.
  manuals: false,
  parse: parseGardenaProduct,
}

type Product = Record<string, unknown>

export function parseGardenaProduct(html: string, pageUrl: string): null | ImportedProduct {
  const product = findProduct(html)
  if (!product) return null

  const name = text(String(product.name ?? ''))
  if (!name) return null

  return {
    attributes: attributesOf(html, product),
    brand: text(String((product.brand as { name?: unknown })?.name ?? '')),
    category: categoryOf(product),
    manuals: [],
    model: modelOf(name),
    name,
    notes: notesOf(html),
    photoUrls: photosOf(product),
    sourceUrl: pageUrl,
  }
}

// One block, and the Product is the first node of its graph.
function findProduct(html: string): null | Product {
  const block = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i.exec(html)
  if (!block) return null

  try {
    const data = JSON.parse(block[1].trim()) as { '@graph'?: unknown }
    const nodes = Array.isArray(data['@graph']) ? (data['@graph'] as Product[]) : []

    return nodes.find((node) => node['@type'] === 'Product') ?? null
  } catch {
    return null
  }
}

// "Pompa do deszczówki 4700/2 inox automatic" — what the thing is, then what it
// is called. The model starts at the first word carrying a digit and runs to
// the end, because "inox automatic" is part of the name of the machine rather
// than a description of it.
//
// It stops at an en dash. "Akumulatorowa pompa do deszczówki 2000/2 18V P4A –
// zestaw z akumulatorem" is one model sold two ways, and which box it came in
// is not the model.
export function modelOf(name: string): string {
  const withoutVariant = name.split(/\s+[–—]\s+/)[0]
  const words = withoutVariant.split(/\s+/)
  const first = words.findIndex((word) => /\d/.test(word))

  return first === -1 ? '' : words.slice(first).join(' ')
}

// The kind of tool, as the last crumb before the product: "Pompy do
// nawadniania". The list is inside the Product rather than in the markup,
// which is the one thing this store makes easier than most.
export function categoryOf(product: Product): string {
  const crumbs = ((
    product.mainEntityOfPage as { breadcrumb?: { itemListElement?: unknown } } | undefined
  )?.breadcrumb?.itemListElement ?? []) as { name?: unknown }[]

  const names = crumbs
    .map((crumb) => text(String(crumb?.name ?? '')))
    .filter((crumb) => crumb && !/^produkty$/i.test(crumb))

  return names.at(-1) ?? ''
}

// The specification: rows of two divs under the "Specyfikacja techniczna" tab,
// the parameter in one and its value in the other. The page prints the same
// rows more than once — a tab for a wide screen and a tab for a narrow one —
// and mergeDuplicates keeps one of each.
export function specifications(html: string): ImportedAttribute[] {
  const attributes: ImportedAttribute[] = []

  for (const row of html.matchAll(
    /class="[^"]*text-list-type[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div[^>]+class="[^"]*text-list-value[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
  )) {
    const name = text(row[1])
    const value = text(row[2])
    if (name && value) attributes.push({ name, value })
  }

  return attributes
}

function attributesOf(html: string, product: Product): ImportedAttribute[] {
  const attributes = specifications(html)

  // The number the shop orders it by. The spec table has a "GTIN-13/EAN" row of
  // its own, so the barcode is already there and is not added twice.
  const sku = text(String(product.sku ?? product.mpn ?? ''))
  if (sku) attributes.push({ name: 'Numer katalogowy', value: sku })

  return mergeDuplicates(attributes)
}

// What the tool is for, in the maker's own words. `Product.description` is one
// line of marketing; this is the paragraph under it, which is the part that
// says what the machine does.
export function notesOf(html: string): string {
  const description = /<span[^>]+class="[^"]*product-desc[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(
    html,
  )?.[1]

  return text(description ?? '')
}

// The gallery, at the size it was published rather than the size the page asked
// for. `?height=520&width=750` is the layout talking, and dropping it is the
// difference between a ten-kilobyte thumbnail and the photograph itself.
export function photosOf(product: Product): string[] {
  const images = Array.isArray(product.image)
    ? product.image
    : typeof product.image === 'string'
      ? [product.image]
      : []

  const seen = new Set<string>()
  const urls: string[] = []

  for (const entry of images) {
    if (typeof entry !== 'string' || !entry.startsWith('http')) continue

    const url = entry.split('?')[0]
    if (seen.has(url)) continue

    seen.add(url)
    urls.push(url)
  }

  return urls
}
