// Reading a product page off lidl.pl — where PARKSIDE is sold.
//
// The sixth shape. A schema.org Product carries the name, the pictures and the
// numbers; everything a person would call a specification is inside the
// description, as a table somebody wrote in a rich-text editor. The category is
// the last breadcrumb, and the one document is a row in a downloads table whose
// only names are a file name and a language.
//
// Pure, like every importer. The fetching lives in routes/item-import.ts.

import { mergeDuplicates } from './attributes'
import { decodeEntities, text } from './html'
import type { ImportedAttribute, ImportedManual, ImportedProduct, Importer } from './types'

export const lidl: Importer = {
  hosts: ['lidl.pl', 'www.lidl.pl'],
  label: 'lidl.pl',
  manuals: true,
  parse: parseLidlProduct,
}

type Product = Record<string, unknown>

export function parseLidlProduct(html: string, pageUrl: string): null | ImportedProduct {
  const product = findProduct(html)
  if (!product) return null

  const name = text(String(product.name ?? ''))
  if (!name) return null

  return {
    attributes: attributesOf(html, product),
    kind: 'tool',
    // "PARKSIDE®" is the shop being careful about a trademark; the catalog
    // calls it PARKSIDE, and a brand nobody else spells that way would sit
    // beside the right one for ever.
    brand: text(String((product.brand as { name?: unknown })?.name ?? '')).replace(/[®™]/g, ''),
    category: categoryOf(html),
    manuals: manualsOf(html),
    model: modelOf(name),
    name,
    notes: notesOf(html),
    photoUrls: photosOf(product),
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

    const nodes = Array.isArray(data) ? data : [data]
    const product = nodes.find((node) => (node as Product | null)?.['@type'] === 'Product')
    if (product) return product as Product
  }

  return null
}

// "Frezarka górnowrzecionowa, 1200 W, POF 1200 F5" — the shop writes what the
// thing is, what it draws and what it is called, in that order. The model is
// the part with letters and digits in it, which on this shelf is the last one.
export function modelOf(name: string): string {
  const parts = name.split(',').map((part) => part.trim())
  const model = parts
    .reverse()
    .find((part) => /[A-Z]{2,}/.test(part) && /\d/.test(part) && part.split(/\s+/).length <= 4)

  return model ?? ''
}

export function categoryOf(html: string): string {
  const nav = /breadcrumb[\s\S]{0,3000}?<\/nav>/i.exec(html)?.[0]
  if (!nav) return ''

  const crumbs = [...nav.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((crumb) => text(crumb[1]))
    .filter((crumb) => crumb && !/^(strona główna|home)$/i.test(crumb))

  return crumbs.at(-1) ?? ''
}

// What the shop calls "Cechy produktu": a table inside the description, where
// every name ends in a colon because somebody typed it that way.
export function specifications(html: string): ImportedAttribute[] {
  const attributes: ImportedAttribute[] = []

  for (const table of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    for (const row of table[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) =>
        text(cell[1]),
      )

      const [name, value] = cells
      if (!name || !value) continue
      // The downloads table is a table too, and its columns are a language and
      // a file name rather than a parameter and its value.
      if (/^(język|nazwa pliku)$/i.test(name)) break

      attributes.push({ name: name.replace(/\s*:$/, ''), value })
    }
  }

  return attributes
}

function attributesOf(html: string, product: Product): ImportedAttribute[] {
  const attributes = specifications(html)

  const sku = text(String(product.sku ?? ''))
  if (sku) attributes.push({ name: 'Numer katalogowy', value: sku })

  // The shop writes it as a list, because one card can cover several barcodes.
  const gtin = Array.isArray(product.gtin13) ? product.gtin13[0] : product.gtin13
  const ean = text(String(gtin ?? ''))
  if (/^\d{13}$/.test(ean)) attributes.push({ name: 'Kod EAN', value: ean })

  return mergeDuplicates(attributes)
}

// What the item is for, as the shop lists it: the bullets under "Opis
// produktu". The table below them is the specification and is read separately,
// so the note is prose rather than a spec sheet written out twice.
export function notesOf(html: string): string {
  const article =
    /<article[^>]*class="[^"]*content-tabs__description[^"]*"[^>]*>([\s\S]*?)<\/article>/i.exec(
      html,
    )?.[1]
  if (!article) return ''

  const bullets = [...article.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((bullet) => text(bullet[1]))
    .filter(Boolean)

  return bullets.join('. ')
}

// The downloads table: a link that carries the file's name, and a cell that
// says which language it is in. Neither is a title, so the card gets both —
// "IAN 525250 (PL)" is at least what somebody would search for.
export function manualsOf(html: string): ImportedManual[] {
  const manuals: ImportedManual[] = []
  const seen = new Set<string>()

  for (const row of html.matchAll(
    /<tr[^>]*class="[^"]*downloads__body[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi,
  )) {
    const url = /href="([^"]+\.pdf[^"]*)"/i.exec(row[1])?.[1]
    if (!url || seen.has(url)) continue
    seen.add(url)

    const fileName = decodeEntities(/download="([^"]+)"/i.exec(row[1])?.[1] ?? '')
      .replace(/\.pdf$/i, '')
      .replace(/_+/g, ' ')
      .trim()

    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((cell) => text(cell[1]))
      .filter(Boolean)
    const language = cells.find((cell) => /^[A-Z]{2}$/.test(cell))

    const title = [fileName || 'Instrukcja', language ? `(${language})` : ''].join(' ').trim()

    manuals.push({ title, url })
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
