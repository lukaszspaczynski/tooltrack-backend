// Reading a product page off electrolux.pl — the maker's own site for its
// washing machines, ovens and fridges.
//
// The twelfth shape, and the second maker's site for the RTV/AGD half. It is
// a Next.js page, and unlike bosch-home.pl's the payload is plain JSON in a
// `__NEXT_DATA__` script rather than a string with its quotes escaped, so it
// is parsed once and walked. The schema.org Product beside it carries the
// identity — name, maker, category, model, PNC, EAN, the gallery — and the
// payload carries what the Product does not: the spec sheet in groups, the
// documents, and the feature tiles. The components in the payload are found
// by name, the way bosch-diy.com's are found by what they carry.
//
// Pure, like every importer. The fetching lives in routes/item-import.ts.

import { mergeDuplicates } from './attributes'
import { text } from './html'
import type { ImportedAttribute, ImportedManual, ImportedProduct, Importer } from './types'

export const electrolux: Importer = {
  hosts: ['electrolux.pl', 'www.electrolux.pl'],
  label: 'electrolux.pl',
  manuals: true,
  parse: parseElectroluxProduct,
}

const BRAND = 'Electrolux'

type Node = Record<string, unknown>

export function parseElectroluxProduct(html: string, pageUrl: string): null | ImportedProduct {
  const product = jsonLdProduct(html)
  if (!product) return null

  const name = text(String(product.name ?? ''))
  if (!name) return null

  const page = pageData(html)
  const sheet = specifications(component(page, 'FullSpecification'))

  return {
    attributes: attributesOf(product, sheet.attributes, component(page, 'FullSpecification')),
    brand: text(String((product.brand as Node | undefined)?.name ?? '')) || BRAND,
    category: text(String(product.category ?? '')) || categoryOf(html),
    kind: 'appliance',
    manuals: manualsOf(component(page, 'DocumentsContent')),
    // The maker's model — "EW7F3482P", what the front of the machine says.
    // The PNC beside it is the maker's own number for this exact variant, and
    // it goes on the sheet as the parameter the page calls it.
    model: text(String(product.sku ?? '')),
    name,
    notes: notesOf(product, sheet.features, benefitsOf(page)),
    photoUrls: photosOf(product),
    sourceUrl: sourceUrlOf(html, pageUrl),
  }
}

function jsonLdProduct(html: string): null | Node {
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
    const product = nodes.find((node) => (node as Node | null)?.['@type'] === 'Product')
    if (product) return product as Node
  }

  return null
}

// The framework's payload, as the JSON it is. Nothing in it is trusted to be
// there: a page without it still has a Product, and reads as a card with no
// spec sheet rather than as no card.
function pageData(html: string): null | Node {
  const block = /<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(html)?.[1]
  if (!block) return null

  try {
    const data = JSON.parse(block) as Node
    const props = data.props as Node | undefined
    const pageProps = props?.pageProps as Node | undefined
    const page = pageProps?.pageData
    return page && typeof page === 'object' ? (page as Node) : null
  } catch {
    return null
  }
}

// The props of the first component of that name, anywhere in the tree. The
// page is a tree of `{ name, props, components }` nodes and where a section
// sits in it is layout; what it is called is the contract.
export function component(page: null | Node, name: string): null | Node {
  if (!page) return null

  const stack: unknown[] = [page]
  while (stack.length > 0) {
    const node = stack.pop()
    if (Array.isArray(node)) {
      stack.push(...node)
      continue
    }
    if (!node || typeof node !== 'object') continue

    const record = node as Node
    if (record.name === name && record.props && typeof record.props === 'object') {
      return record.props as Node
    }
    stack.push(...Object.values(record))
  }

  return null
}

type Sheet = { attributes: ImportedAttribute[]; features: string[] }

// The spec sheet: groups of rows, each a label and a value. The first group,
// "Funkcje", is written differently from the rest — the whole row is in the
// label, "Maksymalny wsad: 8 kg", and the value is empty — and some of its
// rows have no colon at all, because they are not parameters but things the
// machine does: "System płukania zapobiegający powstawaniu piany". Those are
// features, and go to the notes rather than onto the sheet as a parameter
// called that with no value.
//
// A unit is written into the label in brackets, "[kg]", and moves to the
// value where every other importer keeps it — unless it has a colon in it,
// "[godz.:min.]", which is a format rather than a unit and stays where it is.
export function specifications(spec: null | Node): Sheet {
  const attributes: ImportedAttribute[] = []
  const features: string[] = []
  const groups = Array.isArray(spec?.attributes) ? spec.attributes : []

  for (const group of groups) {
    const items = Array.isArray((group as Node | null)?.items)
      ? ((group as Node).items as unknown[])
      : []

    for (const item of items) {
      const label = text(String((item as Node | null)?.label ?? ''))
      const info = text(String((item as Node | null)?.infoText ?? ''))
      if (!label) continue

      if (info) {
        attributes.push(row(label, info))
        continue
      }

      const colon = label.indexOf(': ')
      if (colon > 0) {
        attributes.push(row(label.slice(0, colon), label.slice(colon + 2)))
      } else {
        features.push(label)
      }
    }
  }

  return { attributes, features }
}

function row(name: string, value: string): ImportedAttribute {
  const unit = /\[([^\]]+)\]\s*$/.exec(name)?.[1]?.trim()
  if (!unit || unit.includes(':')) return { name: name.trim(), value: value.trim() }

  return {
    name: name.replace(/\s*\[[^\]]+\]\s*$/, '').trim(),
    value: `${value.trim()} ${unit}`,
  }
}

function attributesOf(
  product: Node,
  sheet: ImportedAttribute[],
  spec: null | Node,
): ImportedAttribute[] {
  const attributes = [...sheet]

  const pnc = text(String(product.mpn ?? ''))
  if (pnc)
    attributes.push({
      name: text(String(spec?.pncTitle ?? '')) || 'Kod produktu (PNC)',
      value: pnc,
    })

  const gtin = text(String(product.gtin ?? ''))
  if (/^\d{13}$/.test(gtin)) attributes.push({ name: 'Kod EAN', value: gtin })

  return mergeDuplicates(attributes)
}

// The headings of the benefit tiles, in the order the page shows them.
// Marketing, but the kind that says what the machine does — "Bęben Care Drum
// łagodny dla tkanin" — and the paragraph under each is left on the page. The
// asterisk that points at a footnote comes off, since the footnote does not.
function benefitsOf(page: null | Node): string[] {
  const headings: string[] = []
  const stack: unknown[] = page ? [page] : []

  while (stack.length > 0) {
    const node = stack.pop()
    if (Array.isArray(node)) {
      stack.push(...node)
      continue
    }
    if (!node || typeof node !== 'object') continue

    const record = node as Node
    if (
      (record.name === 'BenefitWithImage' || record.name === 'BenefitWithoutImage') &&
      record.props &&
      typeof record.props === 'object'
    ) {
      const heading = text(String((record.props as Node).heading ?? '')).replace(/\*+$/, '')
      if (heading) headings.push(heading)
    }
    stack.push(...Object.values(record))
  }

  // The stack walks the tree backwards, and the page's order is the order.
  return headings.reverse()
}

// What the page says about the machine in prose: its one-line description,
// then the features off the spec sheet, then the benefit tiles' headings —
// each made to end a sentence, since the card folds them into one paragraph.
export function notesOf(product: Node, features: string[], benefits: string[]): string {
  const description = text(String(product.description ?? ''))
  const seen = new Set<string>()

  return [description, ...features, ...benefits]
    .filter((line) => {
      const key = line.toLocaleLowerCase('pl-PL')
      if (!line || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((line) => (/[.!?]$/.test(line) ? line : `${line}.`))
    .join(' ')
}

// The page files the product under a category of its own on the Product —
// "Pralka ładowana od frontu" — which is also the last crumb. The crumb is
// the fallback, read out of the breadcrumb's microdata.
export function categoryOf(html: string): string {
  const nav = /class="[^"]*appliance-breadcrumb[^"]*"[^>]*>([\s\S]*?)<\/(?:ol|ul|nav)>/i.exec(
    html,
  )?.[1]
  if (!nav) return ''

  const crumbs = [...nav.matchAll(/itemProp="name"[^>]*>([\s\S]*?)<\/span>/gi)]
    .map((crumb) => text(crumb[1]))
    .filter(Boolean)

  return crumbs.at(-1) ?? ''
}

// What the page calls the paperwork, which stays on the page: the energy
// label and the EU information sheet are about the regulation rather than
// about the machine.
const PAPERWORK = /etykieta energetyczna|karta informacyjna UE/i

// The documents, off the payload: a name in lower case, a format and an
// address. The name loses the " PDF" some of them end in — the format is its
// own field — and gets its capital back. One of the addresses is written with
// a capital H on its scheme, which a browser forgives and a URL parser does
// not.
export function manualsOf(documents: null | Node): ImportedManual[] {
  const section = documents?.document as Node | undefined
  const list = Array.isArray(section?.documents) ? section.documents : []
  const manuals: ImportedManual[] = []
  const seen = new Set<string>()

  for (const entry of list) {
    const document = entry as Node | null
    if (!document) continue

    const format = text(String(document.mediaFormat ?? ''))
    const name = text(String(document.name ?? ''))
    const url = String(document.url ?? '').replace(/^https?:/i, (scheme) => scheme.toLowerCase())
    if (!/^pdf$/i.test(format) || !name || !/^https:\/\//.test(url) || seen.has(url)) continue
    if (PAPERWORK.test(name)) continue

    seen.add(url)
    const title = name.replace(/\s+PDF$/i, '')
    manuals.push({ title: title.charAt(0).toLocaleUpperCase('pl-PL') + title.slice(1), url })
  }

  return manuals
}

// The gallery, as the Product lists it: the product shots first, then the
// machine in a room. The addresses end in no extension — the host is an image
// service — and what they answer with is checked by the fetcher, as always.
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

    seen.add(entry)
    urls.push(entry)
  }

  return urls
}

export function sourceUrlOf(html: string, pageUrl: string): string {
  const canonical = /<meta[^>]+property="og:url"[^>]+content="([^"]*)"/i.exec(html)?.[1]
  return canonical && /^https:\/\/www\.electrolux\.pl\//.test(canonical) ? canonical : pageUrl
}
