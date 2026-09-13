// Reading a product card off mistama.com.
//
// The shop puts a schema.org Product in a JSON-LD graph — name, maker, catalog
// number, EAN, the whole gallery — so the fields come from there rather than
// from the markup around them, which is the part a shop redesigns. What the
// graph does not carry is the spec table, and that is scraped: a list under
// "Parametry techniczne" where the name of the parameter is the plain text and
// its value is in bold.
//
// Everything here is pure. The fetching lives in routes/tool-import.ts, so
// what this file decides can be argued with in a test rather than over the
// network.

import { decodeEntities, text } from './html'
import type { ImportedAttribute, ImportedProduct, Importer } from './types'

const ORIGIN = 'https://mistama.com'

// The shop sells one maker and writes it one way — "BOSCH" — while the catalog
// keeps the two lines apart, because a green drill and a blue one are not the
// same tool to anybody holding them. Which line it is, is in the breadcrumb.
const BRAND_LINES: readonly { line: string; marker: RegExp }[] = [
  { line: 'Bosch Professional', marker: /bosch\s+professional/i },
  { line: 'Bosch Home & Garden', marker: /bosch\s+(?:ogr[oó]d|dom|diy|zielon)/i },
]

// A `<li>` of the spec list: the parameter, its value in bold, and sometimes a
// qualifier after the bold — "Moment obrotowy <b>50 Nm</b> (w twarde materiały)".
const SPEC_ITEM = /<li[^>]*>([\s\S]*?)<\/li>/gi
const BOLD = /<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/i

export const mistama: Importer = {
  hosts: ['mistama.com', 'www.mistama.com'],
  label: 'mistama.com',
  // The shop publishes none: its product pages have three sections, and
  // "Instrukcję obsługi" there is a line on a packing list rather than a file.
  manuals: false,
  parse: parseMistamaProduct,
}

export function parseMistamaProduct(html: string, pageUrl: string): null | ImportedProduct {
  const product = findProduct(html)
  if (!product || typeof product.name !== 'string' || !product.name.trim()) return null

  const crumbs = breadcrumbs(html)
  const name = decodeEntities(product.name).trim()
  const brand = brandOf(product, crumbs)

  return {
    attributes: attributesOf(html, product),
    brand,
    category: categoryOf(crumbs, product, brand),
    // The shop publishes none. Its product pages have three sections — the
    // description, the spec table and what is in the box — and "Instrukcję
    // obsługi w języku polskim" there is a line on a packing list rather than
    // a file. The maker's own site is where the PDF lives.
    manuals: [],
    model: modelOf(name, brand),
    name,
    // The maker's own sentence about the thing. It is the only prose the page
    // offers that describes the tool rather than the offer.
    notes:
      typeof product.description === 'string' ? decodeEntities(product.description).trim() : '',
    photoUrls: photosOf(product),
    sourceUrl: pageUrl,
  }
}

type ProductNode = Record<string, unknown>

// The Product out of the page's JSON-LD, whether it sits on its own or inside
// an @graph with the organisation and the breadcrumbs.
function findProduct(html: string): null | ProductNode {
  for (const block of html.matchAll(
    /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    let data: unknown
    try {
      data = JSON.parse(block[1].trim())
    } catch {
      // A shop with one unparsable block may still have a good one after it.
      continue
    }

    const nodes = [
      ...(Array.isArray(data) ? data : [data]),
      ...(Array.isArray((data as { '@graph'?: unknown })?.['@graph'])
        ? ((data as { '@graph': unknown[] })['@graph'] as unknown[])
        : []),
    ]

    const product = nodes.find((node) => (node as ProductNode | null)?.['@type'] === 'Product') as
      ProductNode | undefined

    if (product) return product
  }

  return null
}

function breadcrumbs(html: string): string[] {
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

    const list = nodes.find((node) => (node as ProductNode | null)?.['@type'] === 'BreadcrumbList')
    const items = (list as { itemListElement?: unknown })?.itemListElement

    if (Array.isArray(items)) {
      return items
        .map((item) => (item as { name?: unknown }).name)
        .filter((value): value is string => typeof value === 'string')
        .map((value) => decodeEntities(value).trim())
    }
  }

  return []
}

// "BOSCH" is what the shop writes; which of the two lines it is, is in the
// breadcrumb. Falling back to the shop's spelling is better than guessing:
// a brand nobody in the catalog uses is visible and fixable, an invented one
// is not.
function brandOf(product: ProductNode, crumbs: string[]): string {
  const trail = crumbs.join(' ')
  const line = BRAND_LINES.find((candidate) => candidate.marker.test(trail))
  if (line) return line.line

  const brand = product.brand
  const written =
    typeof brand === 'string' ? brand : (((brand as { name?: unknown })?.name as string) ?? '')

  return decodeEntities(String(written)).trim()
}

// The kind of tool, not the shelf it is sold from.
//
// The last crumb before the product is the shop's own narrowest heading, and
// it is as often "Seria 18V" as "Wiertarko-wkrętarki z udarem". So: the last
// crumb that names a kind of thing rather than a battery platform or the
// maker's own section — no digits, not the brand. The shop's `category` field
// is the fallback, and an empty category is better than a wrong one, since it
// is a filter somebody will otherwise wonder about.
function categoryOf(crumbs: string[], product: ProductNode, brand: string): string {
  const brandWords = brand.toLocaleLowerCase('pl-PL').split(/\s+/).filter(Boolean)

  const usable = crumbs
    // The home page and the product's own crumb are not categories.
    .slice(1, -1)
    .filter((crumb) => !/\d/.test(crumb))
    .filter((crumb) => {
      const lower = crumb.toLocaleLowerCase('pl-PL')
      return !brandWords.some((word) => word.length > 2 && lower.includes(word))
    })

  const chosen = usable.at(-1)
  if (chosen) return chosen

  return typeof product.category === 'string' ? decodeEntities(product.category).trim() : ''
}

// The model as the shop writes it inside the name: a run of capitals and
// numbers — "GSB 185-LI", "EASYGRASSCUT 18V-26" — with the maker's own name
// taken out of it. Nothing found is nothing written: a model invented from the
// first two words of a Polish sentence would be worse than an empty field the
// person fills in.
export function modelOf(name: string, brand: string): string {
  const brandWords = new Set(
    brand
      .toLocaleUpperCase('pl-PL')
      .split(/\s+/)
      .filter((word) => word.length > 1),
  )

  const tokens = name.split(/\s+/)
  const runs: string[][] = []
  let run: string[] = []

  for (const raw of tokens) {
    const token = raw.replace(/^[("']+|[)"',.]+$/g, '')
    const shouty =
      token.length > 1 && token === token.toLocaleUpperCase('pl-PL') && /[A-Z0-9]/.test(token)

    if (shouty && !brandWords.has(token)) {
      run.push(token)
      continue
    }

    if (run.length > 0) runs.push(run)
    run = []
  }
  if (run.length > 0) runs.push(run)

  // The longest run, and the first of those when two are the same length: the
  // model is the most said thing in a shop's product name.
  const best = runs.sort((a, b) => b.join(' ').length - a.join(' ').length)[0]

  return best ? best.join(' ') : ''
}

// The spec table, plus the two numbers the graph carries that a card has
// nowhere else to put, plus what the box contains.
function attributesOf(html: string, product: ProductNode): ImportedAttribute[] {
  const attributes = specifications(html)

  const sku = product.sku
  if (typeof sku === 'string' && sku.trim()) {
    attributes.push({ name: 'Numer katalogowy', value: sku.trim() })
  }

  // Only when it is one. The shop fills `gtin13` with the catalog number on
  // some cards, and "Kod EAN" repeating the line above it is worse than no
  // line at all — a barcode is thirteen digits and nothing else.
  const ean = product.gtin13
  if (typeof ean === 'string' && /^\d{13}$/.test(ean.trim())) {
    attributes.push({ name: 'Kod EAN', value: ean.trim() })
  }

  const included = sectionItems(html, 'Dostawa zawiera')
  if (included.length > 0) {
    attributes.push({ name: 'W zestawie', value: included.join(', ') })
  }

  return mergeDuplicates(attributes)
}

// The list under "Parametry techniczne".
//
// A row is "name <strong>value</strong> (qualifier)". An item that is bold all
// the way through has no name — those are the feature bullets ("Metalowy
// kabłąk w wyposażeniu"), and a parameter called nothing is not a parameter. A
// value of "-" is the shop saying the field does not apply here.
export function specifications(html: string): ImportedAttribute[] {
  const attributes: ImportedAttribute[] = []

  for (const item of sectionHtml(html, 'Parametry techniczne').matchAll(SPEC_ITEM)) {
    const inner = item[1]
    const bold = BOLD.exec(inner)
    if (!bold) continue

    const name = text(inner.slice(0, bold.index))
    const value = [text(bold[1]), text(inner.slice(bold.index + bold[0].length))]
      .filter(Boolean)
      .join(' ')

    if (!name || !value || value === '-') continue

    attributes.push({ name, value })
  }

  return attributes
}

// One parameter cannot be listed twice on a card — the database says so — and
// a spec table names two moments of torque, one for hard materials and one for
// soft. Neither reading is worth losing, so they become one parameter with
// both: their qualifiers are what tell them apart anyway.
export function mergeDuplicates(attributes: ImportedAttribute[]): ImportedAttribute[] {
  const byName = new Map<string, ImportedAttribute>()

  for (const attribute of attributes) {
    const key = attribute.name.toLocaleLowerCase('pl-PL')
    const seen = byName.get(key)

    if (!seen) {
      byName.set(key, { ...attribute })
      continue
    }

    if (!seen.value.includes(attribute.value)) seen.value = `${seen.value}; ${attribute.value}`
  }

  return [...byName.values()]
}

// The block under one of the page's `seo-title` headings, up to the next one.
function sectionHtml(html: string, heading: string): string {
  const start = html.indexOf(heading)
  if (start < 0) return ''

  const rest = html.slice(start)
  const next = rest.slice(heading.length).search(/class="seo-title"/i)

  return next < 0 ? rest : rest.slice(0, heading.length + next)
}

function sectionItems(html: string, heading: string): string[] {
  return [...sectionHtml(html, heading).matchAll(SPEC_ITEM)]
    .map((item) => text(item[1]))
    .filter(Boolean)
}

// The gallery, at full size. The page lists `thumbnail/large_NAME.jpg`; the
// picture itself is the same name without the folder and without the prefix,
// and that is what belongs on a card — a catalog outlives the shop's idea of
// what "large" means.
function photosOf(product: ProductNode): string[] {
  const images = Array.isArray(product.image)
    ? product.image
    : typeof product.image === 'string'
      ? [product.image]
      : []

  const seen = new Set<string>()
  const urls: string[] = []

  for (const entry of images) {
    if (typeof entry !== 'string') continue

    const full = entry
      .replace(/\/thumbnail\/(?:large|big|small)_/i, '/')
      // `?lm=` is the shop's cache-buster, not part of the file.
      .replace(/\?.*$/, '')

    const absolute = full.startsWith('http') ? full : new URL(full, ORIGIN).toString()
    if (seen.has(absolute)) continue

    seen.add(absolute)
    urls.push(absolute)
  }

  return urls
}
