// Reading a product page off bosch-diy.com — the maker's own site for the
// green line, rather than a shop.
//
// The page is rendered by Next.js and carries everything in `__NEXT_DATA__`,
// so nothing here scrapes markup: the name, the category, the spec table, the
// gallery and the order numbers are all fields in that blob. What it does not
// carry is a schema.org Product, which is why this is a second script rather
// than the first one pointed at another host.
//
// The component holding it sits under a key that is a hash of the page, so it
// is found by the models it carries rather than by its address in the tree.
//
// Pure, like every importer. The fetching lives in routes/tool-import.ts.

import { text } from './html'
import type { ImportedAttribute, ImportedProduct, Importer } from './types'

const ORIGIN = 'https://www.bosch-diy.com'

// The whole site is one line of one maker: this is Bosch's green range, the
// one the catalog calls "Bosch Home & Garden". Nothing on the page says it in
// so many words, and guessing it from a breadcrumb would be reading tea leaves
// about a fact the address already settles.
const BRAND = 'Bosch Home & Garden'

export const boschDiy: Importer = {
  hosts: ['bosch-diy.com', 'www.bosch-diy.com'],
  label: 'bosch-diy.com',
  parse: parseBoschDiyProduct,
}

type Section = Record<string, unknown>

export function parseBoschDiyProduct(html: string, pageUrl: string): null | ImportedProduct {
  const sections = findProductSections(html)
  if (!sections) return null

  const stage = asSection(sections.stageSection)
  const name = text(String(stage.name ?? ''))
  if (!name) return null

  const sku = String(stage.sku ?? '').trim()

  return {
    attributes: attributesOf(sections, sku),
    brand: BRAND,
    category: categoryOf(stage),
    model: modelOf(name),
    name,
    notes: text(String(asSection(sections.productDescriptionSection).text ?? '')),
    photoUrls: photosOf(stage),
    sourceUrl: pageUrl,
  }
}

// The product's own component, wherever the page put it. Everything this
// importer reads hangs off one object, so finding it is the whole of knowing
// where anything is.
function findProductSections(html: string): null | Section {
  const block = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(html)
  if (!block) return null

  let data: unknown
  try {
    data = JSON.parse(block[1])
  } catch {
    return null
  }

  return find(data)
}

function find(node: unknown): null | Section {
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = find(entry)
      if (found) return found
    }
    return null
  }

  if (!node || typeof node !== 'object') return null

  const section = node as Section
  // Both, not either: a page listing products has a stage of its own, and only
  // a product has a spec table under it.
  if (isSection(section.stageSection) && isSection(section.technicalSpecificationsSection)) {
    return section
  }

  for (const value of Object.values(section)) {
    const found = find(value)
    if (found) return found
  }

  return null
}

// "CityMower 18V-32-300 - Bez akumulatora | Bez ładowarki". The maker names a
// product by its model and then says which box it comes in; the part before
// that first separator is the machine. A name without one is the model, which
// on this site it is.
export function modelOf(name: string): string {
  return name.split(/\s+[-–|]\s+/)[0].trim()
}

function categoryOf(stage: Section): string {
  const categories = Array.isArray(stage.categories) ? stage.categories : []
  const first = categories.find((entry) => typeof (entry as Section)?.name === 'string')

  return first ? text(String((first as Section).name)) : ''
}

// The spec table, then the numbers that identify this exact configuration.
//
// A product page offers several kits — with a battery, with two, with neither
// — each with its own order number, and the page is about one of them. The one
// whose order number is the page's own is the one whose EAN and contents
// belong on this card; the others describe a tool somebody did not buy.
function attributesOf(sections: Section, sku: string): ImportedAttribute[] {
  const attributes = specifications(asSection(sections.technicalSpecificationsSection))

  if (sku) attributes.push({ name: 'Numer katalogowy', value: sku })

  const kit = kitFor(asSection(sections.scopeOfDeliverySection), sku)
  if (kit) {
    const ean = String(kit.eanCode ?? '').trim()
    if (/^\d{8,14}$/.test(ean)) attributes.push({ name: 'Kod EAN', value: ean })

    const included = Array.isArray(kit.deliveryDetails)
      ? kit.deliveryDetails.filter((entry): entry is string => typeof entry === 'string')
      : []
    if (included.length > 0) {
      attributes.push({
        name: 'W zestawie',
        value: included.map((entry) => text(entry)).join(', '),
      })
    }
  }

  return attributes
}

export function specifications(section: Section): ImportedAttribute[] {
  const attributes: ImportedAttribute[] = []

  const properties = Array.isArray(section.properties) ? section.properties : []
  for (const entry of properties) {
    const property = entry as Section
    const name = text(String(property.name ?? ''))
    const value = text(String(property.value ?? ''))
    if (name && value) attributes.push({ name, value })
  }

  // The noise and vibration figures sit in a second block behind "Pokaż
  // więcej", written as a row of titles and a row of values rather than as
  // pairs. They are the same spec sheet, continued.
  const more = asSection(section.showMoreSection)
  const titles = Array.isArray(more.valueTitles) ? more.valueTitles : []
  const rows = Array.isArray(more.properties) ? more.properties : []

  for (const row of rows) {
    const values = Array.isArray((row as Section).values)
      ? ((row as Section).values as unknown[])
      : []
    values.forEach((value, index) => {
      const name = text(String(titles[index] ?? ''))
      const written = text(String(value ?? ''))
      if (name && written) attributes.push({ name, value: written })
    })
  }

  return attributes
}

function kitFor(section: Section, sku: string): null | Section {
  const content = asSection(section.content)
  const kits = Array.isArray(content.kits) ? content.kits : []

  const match = kits.find((entry) => String((entry as Section)?.orderNumber ?? '').trim() === sku)

  return match ? (match as Section) : null
}

// The gallery at the largest size the page names.
//
// Every picture is offered in a handful of widths, baked into the file name —
// `..._w_1600_h_800.png` — and the page's own choice depends on the screen it
// is drawn on. A catalog keeps the biggest: the card is looked at on a phone
// today and printed on a label tomorrow.
function photosOf(stage: Section): string[] {
  const gallery = Array.isArray(stage.gallery) ? stage.gallery : []
  const seen = new Set<string>()
  const urls: string[] = []

  for (const entry of gallery) {
    const picture = asSection((entry as Section)?.stageImage ?? (entry as Section)?.thumbnail)

    let best = ''
    let widest = 0
    for (const variant of Object.values(picture)) {
      const src = String((variant as Section)?.src ?? '')
      if (!src) continue

      const width = Number(/_w_(\d+)/.exec(src)?.[1] ?? 0)
      if (width >= widest) {
        widest = width
        best = src
      }
    }

    if (!best) continue

    const absolute = best.startsWith('http') ? best : new URL(best, ORIGIN).toString()
    if (seen.has(absolute)) continue

    seen.add(absolute)
    urls.push(absolute)
  }

  return urls
}

function isSection(value: unknown): value is Section {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asSection(value: unknown): Section {
  return isSection(value) ? value : {}
}
