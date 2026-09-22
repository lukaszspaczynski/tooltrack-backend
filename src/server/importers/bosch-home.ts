// Reading a product page off bosch-home.pl — the maker's own site for its
// home appliances: the fridge, the dishwasher, the vacuum cleaner.
//
// The eleventh shape, and the first maker's site for the RTV/AGD half of the
// catalog. It is a Next.js page like bosch-diy.com, but unlike that one it
// publishes a schema.org Product with the whole spec sheet in it — every row
// an `additionalProperty` with a name, a value and a unit — so nothing is
// scraped out of markup and nothing is dug out of the page's own payload
// except the one thing the Product does not carry: the documents. The
// breadcrumb is a schema.org BreadcrumbList of its own.
//
// Pure, like every importer. The fetching lives in routes/item-import.ts.

import { MAX_ATTRIBUTE_NAME_LENGTH } from '../routes/items-input'
import { mergeDuplicates } from './attributes'
import { text } from './html'
import type { ImportedAttribute, ImportedManual, ImportedProduct, Importer } from './types'

export const boschHome: Importer = {
  hosts: ['bosch-home.pl', 'www.bosch-home.pl'],
  label: 'bosch-home.pl',
  manuals: true,
  parse: parseBoschHomeProduct,
}

// The site is one maker's, and it is neither the green line nor the blue one:
// the catalog already keeps "Bosch Home & Garden" and "Bosch Professional"
// apart, and a washing machine is a third thing again.
const BRAND = 'Bosch'

type Node = Record<string, unknown>

export function parseBoschHomeProduct(html: string, pageUrl: string): null | ImportedProduct {
  const nodes = jsonLd(html)
  const product = nodes.find((node) => node['@type'] === 'Product')
  if (!product) return null

  const name = text(String(product.name ?? ''))
  if (!name) return null

  const properties = propertiesOf(product)

  return {
    attributes: attributesOf(product, properties),
    brand: BRAND,
    category: categoryOf(nodes, product),
    kind: 'appliance',
    manuals: manualsOf(html),
    // The maker's own number for the machine — "KAD90VB20" — which is also
    // what the page is filed under and what the type plate says.
    model: text(String(product.mpn ?? '')),
    name,
    notes: notesOf(properties),
    photoUrls: photosOf(product),
    sourceUrl: sourceUrlOf(product, pageUrl),
  }
}

function jsonLd(html: string): Node[] {
  const nodes: Node[] = []

  for (const block of html.matchAll(
    /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    let data: unknown
    try {
      data = JSON.parse(block[1].trim())
    } catch {
      continue
    }

    for (const node of Array.isArray(data) ? data : [data]) {
      if (node && typeof node === 'object') nodes.push(node as Node)
    }
  }

  return nodes
}

type Property = { name: string; unit: string; value: string }

function propertiesOf(product: Node): Property[] {
  const raw = Array.isArray(product.additionalProperty) ? product.additionalProperty : []

  return raw.flatMap((entry) => {
    const node = entry as Node | null
    if (!node || typeof node !== 'object') return []

    const name = text(String(node.name ?? ''))
    const value = text(String(node.value ?? ''))
    if (!name || !value) return []

    return [{ name, unit: text(String(node.unitText ?? '')), value }]
  })
}

// The Product's property list is two lists in one. Most rows are the spec
// sheet — "Masa netto", "103.6", "kg". The rest are the feature highlights
// the page shows as tiles, written as a property whose name is a headline
// with a colon in it and whose value is a paragraph of marketing. A headline
// is not a parameter, so those go to the notes, and the way to tell them
// apart is the colon — or a name longer than a parameter's name can be.
export function isHighlight(property: { name: string }): boolean {
  return /:\s/.test(property.name) || property.name.length > MAX_ATTRIBUTE_NAME_LENGTH
}

// A unit is a separate field on the page and part of the value on the card,
// which is where every other importer keeps it. A name that already says the
// unit — "Masa brutto (kg)" — loses that, or the card would say it twice.
export function specifications(properties: Property[]): ImportedAttribute[] {
  return properties
    .filter((property) => !isHighlight(property))
    .map(({ name, unit, value }) => ({
      name: unit ? name.replace(new RegExp(`\\s*\\(${escapeRegExp(unit)}\\)$`, 'i'), '') : name,
      value: unit ? `${value} ${unit}` : value,
    }))
}

function attributesOf(product: Node, properties: Property[]): ImportedAttribute[] {
  const attributes = specifications(properties)

  const gtin = text(String(product.gtin ?? ''))
  if (/^\d{13}$/.test(gtin)) attributes.push({ name: 'Kod EAN', value: gtin })

  return mergeDuplicates(attributes)
}

// The headlines of the feature tiles, one after another. They are sentences
// already — "NoFrost: nigdy więcej rozmrażania zamrażarki dzięki perfekcyjnej
// ochronie." — and the paragraph under each is left where it is: the card
// wants to say what the machine does, not to sell it.
export function notesOf(properties: Property[]): string {
  return properties
    .filter(isHighlight)
    .map((property) => (/[.!?]$/.test(property.name) ? property.name : `${property.name}.`))
    .join(' ')
}

// The last crumb before the model: "Home > Produkty > Chłodzenie i zamrażanie
// > Zamrażarki > Zamrażarka szufladowa do zabudowy > GIV11AFE0". A machine the
// maker no longer sells is filed under nothing — its breadcrumb is "Produkty >
// KAD90VB20" — and then the short description is what says what it is, with
// the series taken off the front: "Series 6 American side by side" is a fridge
// of a kind, and the series is the range.
export function categoryOf(nodes: Node[], product: Node): string {
  const list = nodes.find((node) => node['@type'] === 'BreadcrumbList')
  const model = text(String(product.mpn ?? ''))
  const crumbs = (Array.isArray(list?.itemListElement) ? list.itemListElement : [])
    .map((entry) => text(String((entry as Node | null)?.name ?? '')))
    .filter((crumb) => crumb && !/^(home|produkty)$/i.test(crumb) && crumb !== model)

  const last = crumbs.at(-1)
  if (last) return last

  return text(String(product.description ?? '')).replace(/^seri[ae]s?\s+\d+\s+/i, '')
}

// The product photographs, and not the line drawings the Product lists after
// them: those are the installation diagrams, drawn for a family rather than a
// machine — a fridge's are filed under a different model's number — and a
// card's gallery is pictures of the thing.
export function photosOf(product: Node): string[] {
  const images = Array.isArray(product.image)
    ? product.image
    : typeof product.image === 'string'
      ? [product.image]
      : []

  const seen = new Set<string>()
  const urls: string[] = []

  for (const entry of images) {
    if (typeof entry !== 'string' || !entry.startsWith('http') || seen.has(entry)) continue
    if (/\/Line_Drawings\//i.test(entry)) continue

    seen.add(entry)
    urls.push(entry)
  }

  return urls
}

// What the page calls each kind of document, in Polish, keyed the way the
// payload keys them. The ones left out are paperwork rather than documents
// about the machine: the energy label, the EU data sheet, the legal notices.
const DOCUMENT_TITLES: Record<string, string> = {
  'installation-instruction': 'Instrukcja montażu',
  'product-specification': 'Karta produktu',
  'repair-hints': 'Wskazówki dotyczące naprawy',
  'short-instructions': 'Skrócona instrukcja',
  supplement: 'Suplement do instrukcji',
  'user-manuals': 'Instrukcja obsługi',
}

// The documents are the one thing not in the Product: they are in the page's
// own payload, a `technicalDocuments` array inside a string the framework
// hands to the client. The string is JSON with its quotes escaped, so the
// quotes are unescaped and the array is cut out by matching its brackets —
// the same trick as finding a component in bosch-diy.com's payload by what it
// carries rather than by its address.
//
// The same file is often listed twice, as the user manual and as the
// installation instructions, and it is one document on the card. Two
// different files under one title — two user manuals — are told apart by the
// file's own number.
export function manualsOf(html: string): ImportedManual[] {
  const documents = technicalDocuments(html)
  const manuals: ImportedManual[] = []
  const seenUrls = new Set<string>()
  const seenTitles = new Set<string>()

  for (const document of documents) {
    const key = String(document.titleKey ?? '')
    const url = String(document.url ?? '')
    const title = DOCUMENT_TITLES[key]
    if (!title || !/^https:\/\/[^"\s]+\.pdf$/i.test(url) || seenUrls.has(url)) continue

    seenUrls.add(url)
    const stem = /\/([^/]+)\.pdf$/i.exec(url)?.[1] ?? ''
    const unique = seenTitles.has(title) && stem ? `${title} (${stem})` : title
    seenTitles.add(title)

    manuals.push({ title: unique, url })
  }

  return manuals
}

function technicalDocuments(html: string): Node[] {
  const marker = '"technicalDocuments":['
  const unescaped = html.replace(/\\"/g, '"')
  const start = unescaped.indexOf(marker)
  if (start < 0) return []

  const from = start + marker.length - 1
  let depth = 0
  let inString = false

  for (let i = from; i < unescaped.length; i++) {
    const char = unescaped[i]

    if (inString) {
      if (char === '\\') i++
      else if (char === '"') inString = false
      continue
    }

    if (char === '"') inString = true
    else if (char === '[') depth++
    else if (char === ']' && --depth === 0) {
      try {
        const parsed: unknown = JSON.parse(unescaped.slice(from, i + 1))
        return Array.isArray(parsed)
          ? parsed.filter((entry): entry is Node => !!entry && typeof entry === 'object')
          : []
      } catch {
        return []
      }
    }
  }

  return []
}

// The Product names its own address — "/pl/mkt-product/KAD90VB20", without
// the category path the sitemap writes in front of the model — and that is
// the one the card keeps, because a machine the maker stops selling is filed
// under no category and the long address stops answering.
export function sourceUrlOf(product: Node, pageUrl: string): string {
  const own = String(product['@id'] ?? '')
  return /^https:\/\/www\.bosch-home\.pl\//.test(own) ? own : pageUrl
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
