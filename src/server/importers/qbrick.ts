// Reading a case off qbricksystem.com — the maker's own site.
//
// The first importer that reads a **case** rather than an item, and the shape it
// reads is why cases got their own type: everything worth knowing about a box
// is a measurement, and the page states them all in one small table with the
// units written into the values.
//
//   Wymiary zewnętrzne | 450 [L] x 322 [W] x 126 [H] mm
//   Pojemność          | 11 L
//   Ładowność          | 15kg
//
// WooCommerce underneath, so there is a gallery worth taking and a title in
// capitals worth not taking as written.
//
// Pure, like every importer. The fetching lives in routes/case-import.ts.

import type { ImportedAttribute } from './types'
import { text } from './html'
import type { CaseImporter, ImportedCase } from './types'

export const qbrick: CaseImporter = {
  hosts: ['qbricksystem.com', 'www.qbricksystem.com'],
  label: 'qbricksystem.com',
  parse: parseQbrickCase,
}

const MANUFACTURER = 'Qbrick'

export function parseQbrickCase(html: string, pageUrl: string): null | ImportedCase {
  const rows = specifications(html)
  // Every page on this site has a heading; only a product has this table. A
  // case of empty measurements is worse than a refusal, because somebody has
  // to undo it.
  if (rows.size === 0) return null

  const heading = text(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? '')
  if (!heading) return null

  const outer = dimensions(rows.get('wymiary zewnętrzne'))
  const inner = dimensions(rows.get('wymiary wewnętrzne'))
  const system = systemOf(heading)

  return {
    attributes: attributesOf(rows),
    capacityL: measurement(rows.get('pojemność')),
    diagonalMm: measurement(rows.get('przekątna')),
    ean: rows.get('ean') ?? '',
    innerHeightMm: inner[2],
    innerLengthMm: inner[0],
    innerWidthMm: inner[1],
    loadKg: measurement(rows.get('ładowność')),
    manufacturer: MANUFACTURER,
    name: nameOf(heading, system),
    notes: descriptionOf(html),
    outerHeightMm: outer[2],
    outerLengthMm: outer[0],
    outerWidthMm: outer[1],
    photoUrls: photosOf(html),
    sku: rows.get('sku') ?? '',
    sourceUrl: pageUrl,
    system,
  }
}

// The one table on a product page, keyed by the label in lower case so that a
// heading restyled into capitals does not lose a row.
export function specifications(html: string): Map<string, string> {
  const table = /<table[\s\S]*?<\/table>/i.exec(html)?.[0]
  if (!table) return new Map()

  const rows = new Map<string, string>()

  for (const row of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) =>
      text(cell[1]),
    )

    const [label, value] = cells
    if (label && value) rows.set(label.toLocaleLowerCase('pl-PL'), value)
  }

  return rows
}

// "450 [L] x 322 [W] x 126 [H] mm" — length, width, height, in that order and
// labelled, though the labels are the same on every page and the order never
// varies. Read as three numbers rather than by label, because a page that
// dropped the brackets would still be stating the same box.
export function dimensions(
  value: string | undefined,
): [null | number, null | number, null | number] {
  const numbers = [...(value ?? '').matchAll(/(\d+(?:[.,]\d+)?)/g)].map((match) =>
    Number(match[1].replace(',', '.')),
  )

  if (numbers.length < 3) return [null, null, null]

  return [numbers[0], numbers[1], numbers[2]]
}

// "11 L", "15kg", "495 mm" — the unit is written into the value, sometimes with
// a space and sometimes without. The number is the part the catalog stores.
export function measurement(value: string | undefined): null | number {
  const found = /(\d+(?:[.,]\d+)?)/.exec(value ?? '')
  if (!found) return null

  const number = Number(found[1].replace(',', '.'))

  return Number.isFinite(number) && number > 0 ? number : null
}

// "QBRICK SYSTEM PRO TOOLCASE" — the word after "SYSTEM" is the line this box
// belongs to, and it is the one token in the name that is capitals on purpose.
export function systemOf(heading: string): string {
  const after = /\bsystem\s+(\S+)/i.exec(heading)?.[1] ?? ''

  return after.toLocaleUpperCase('en-US')
}

// The page shouts. A van full of boxes labelled in capitals is a van nobody can
// read, so the name is title-cased — and then the system is put back as it was,
// because "Pro" is a word and "PRO" is the name of a line.
export function nameOf(heading: string, system: string): string {
  return heading
    .toLocaleLowerCase('pl-PL')
    .split(/\s+/)
    .map((word) =>
      word.toLocaleUpperCase('en-US') === system
        ? system
        : word.charAt(0).toLocaleUpperCase('pl-PL') + word.slice(1),
    )
    .join(' ')
}

// What the maker writes about the box, which is what a note is for.
//
// It used to be the weight and the address, because the case had nowhere else
// to put either. Both are parameters now — the sheet is the place for a fact
// with a name — and a note built out of them was a note that said nothing a
// person reads: two of the five cases had no prose at all, only a link.
//
// The Elementor widget rather than the whole page: this site has no
// `short-description` and no description tab, and the product's own paragraphs
// are the only ones on it that are about the product. Anything else — the
// footer, the cookie notice, what the shop suggests buying next — is markup
// around it.
export function descriptionOf(html: string): string {
  const widget =
    /<div[^>]*data-widget_type="woocommerce-product-content[^"]*"[^>]*>([\s\S]*?)<\/div><\/div>/i.exec(
      html,
    )?.[1] ?? ''

  const paragraphs = [...widget.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => text(match[1]))
    .filter(Boolean)

  return paragraphs.join('\n\n')
}

// The rows of the spec table that are not columns. Seven of the nine are — the
// dimensions, the capacity, the load, the barcode, the catalog number — and
// these two are what a box states that the catalog has no field for.
//
// Named rather than "everything left over" on purpose: a row this list does
// not know is a row nobody has decided where to put, and guessing would put the
// EAN on the sheet as well as in its column.
const SHEET_ROWS: Record<string, string> = {
  'ilość na palecie': 'Ilość na palecie',
  waga: 'Waga',
}

export function attributesOf(rows: Map<string, string>): ImportedAttribute[] {
  const attributes: ImportedAttribute[] = []

  for (const [label, name] of Object.entries(SHEET_ROWS)) {
    const value = rows.get(label)
    if (value) attributes.push({ name, value })
  }

  return attributes
}

// The gallery, at the size it was uploaded: `data-large_image` is the original,
// where the `src` beside it is whichever thumbnail the layout asked for.
//
// Not scoped to the gallery element, because there is nothing to scope to — the
// markup opens a figure it never closes. It does not need to be: WooCommerce
// writes this attribute for the zoomable gallery and nothing else, so the
// pictures of everything the page suggests buying next carry a plain `src` and
// are not picked up. A page with no product has none at all.
export function photosOf(html: string): string[] {
  const seen = new Set<string>()
  const urls: string[] = []

  for (const match of html.matchAll(/data-large_image="([^"]+)"/gi)) {
    const url = match[1]
    if (seen.has(url) || !url.startsWith('http')) continue

    seen.add(url)
    urls.push(url)
  }

  return urls
}
