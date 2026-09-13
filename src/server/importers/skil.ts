// Reading a product page off skileurope.com.
//
// The fourth shape. A schema.org Product that names the kind of tool rather
// than the machine, a Magento spec table, a category that exists only in the
// analytics payload, and documents whose real titles are in the `title`
// attribute of their links.
//
// Pure, like every importer. The fetching lives in routes/tool-import.ts.

import { manualTitle, mergeDuplicates } from './attributes'
import { text } from './html'
import type { ImportedAttribute, ImportedManual, ImportedProduct, Importer } from './types'

// The site is one brand, spelled the way the catalog spells it.
const BRAND = 'SKIL'

export const skil: Importer = {
  hosts: ['skileurope.com', 'www.skileurope.com'],
  label: 'skileurope.com',
  manuals: true,
  parse: parseSkilProduct,
}

type Product = Record<string, unknown>

export function parseSkilProduct(html: string, pageUrl: string): null | ImportedProduct {
  const product = findProduct(html)
  if (!product) return null

  const kind = text(String(product.name ?? ''))
  const sku = text(String(product.sku ?? ''))
  if (!kind && !sku) return null

  return {
    attributes: attributesOf(html, sku),
    brand: BRAND,
    category: categoryOf(html) || kind,
    manuals: manualsOf(html),
    model: sku,
    name: nameOf(kind, sku),
    notes: text(String(product.description ?? '')),
    photoUrls: photosOf(html),
    sourceUrl: pageUrl,
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

    const nodes = [
      ...(Array.isArray(data) ? data : [data]),
      ...(Array.isArray((data as { '@graph'?: unknown })?.['@graph'])
        ? ((data as { '@graph': unknown[] })['@graph'] as unknown[])
        : []),
    ]

    const product = nodes.find((node) => (node as Product | null)?.['@type'] === 'Product')
    if (product) return product as Product
  }

  return null
}

// The shop names the product for what it is — "Szlifierka taśmowa" — and keeps
// the machine's number in the sku. A card wants both: "Szlifierka taśmowa" is
// three of the tools in the shed, and "7615 AB" is none of them until somebody
// remembers what it is.
export function nameOf(kind: string, sku: string): string {
  if (!kind) return sku
  if (!sku || kind.toLocaleLowerCase('pl-PL').includes(sku.toLocaleLowerCase('pl-PL'))) return kind

  return `${kind} ${sku}`
}

// The kind of tool, out of the analytics payload: `item_category` is the
// department and each numbered one after it is narrower, so the last one is
// what this is. The JSON-LD has no category and the breadcrumb markup here is
// a list of empty names — the same as on bosch-professional.com.
export function categoryOf(html: string): string {
  const found = [...html.matchAll(/"item_category(\d*)"\s*:\s*"([^"]{2,80})"/g)]
  if (found.length === 0) return ''

  const deepest = found
    .map((match) => ({ depth: Number(match[1] || '1'), name: match[2] }))
    .sort((a, b) => b.depth - a.depth)[0]

  return text(deepest.name)
}

// Magento's own table: a row is a heading and a cell.
export function specifications(html: string): ImportedAttribute[] {
  const table = /<table[^>]*class="[^"]*additional-attributes[^"]*"[^>]*>([\s\S]*?)<\/table>/i.exec(
    html,
  )
  if (!table) return []

  const attributes: ImportedAttribute[] = []

  for (const row of table[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const name = text(/<th[^>]*>([\s\S]*?)<\/th>/i.exec(row[1])?.[1] ?? '')
    const value = text(/<td[^>]*>([\s\S]*?)<\/td>/i.exec(row[1])?.[1] ?? '')

    if (name && value) attributes.push({ name, value })
  }

  return attributes
}

function attributesOf(html: string, sku: string): ImportedAttribute[] {
  const attributes = specifications(html)

  if (sku) attributes.push({ name: 'Numer katalogowy', value: sku })

  return mergeDuplicates(attributes)
}

// Every PDF the page offers, titled by the `title` on its own link.
//
// The link's text carries the arrow icon's name along with the title — the
// icon is an inline SVG with a <title> of its own — while the attribute is
// just the sentence. "Pobierz" in front of it is an instruction to the reader
// rather than part of the name.
export function manualsOf(html: string): ImportedManual[] {
  const manuals: ImportedManual[] = []
  const seen = new Set<string>()

  for (const link of html.matchAll(/<a\s([^>]*href="([^"]*\.pdf[^"]*)"[^>]*)>([\s\S]*?)<\/a>/gi)) {
    const url = link[2]
    if (seen.has(url)) continue
    seen.add(url)

    const attribute = /title="([^"]*)"/i.exec(link[1])?.[1] ?? ''
    const written = text(attribute || link[3]).replace(/^Pobierz\s+/i, '')

    manuals.push({ title: manualTitle(written), url })
  }

  return manuals
}

// The gallery, at its original size.
//
// Magento serves every picture twice: once under `/cache/<hash>/`, resized for
// whatever the page needed, and once at its own address. A catalog keeps the
// second — the hash belongs to a layout that will change.
export function photosOf(html: string): string[] {
  const seen = new Set<string>()
  const urls: string[] = []

  for (const match of html.matchAll(
    /https:\/\/[^"'\s\\]*\/media\/catalog\/product\/(?!cache\/)[^"'\s\\]+\.(?:png|jpe?g|webp)/gi,
  )) {
    const url = match[0]
    if (seen.has(url)) continue

    seen.add(url)
    urls.push(url)
  }

  return urls
}
