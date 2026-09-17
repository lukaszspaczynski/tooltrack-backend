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
import type { ImportedProduct, Importer } from './types'

export const qbrick: Importer = {
  hosts: ['qbricksystem.com', 'www.qbricksystem.com'],
  label: 'qbricksystem.com',
  // Its product pages publish no documents.
  manuals: false,
  parse: parseQbrickCase,
}

const MANUFACTURER = 'Qbrick'

// What this site sells, in the catalog's own word for it. Written here rather
// than read off the page: the breadcrumb on qbricksystem.com names the range
// ("System PRO") rather than the kind of thing, and a category is the word
// somebody looks under.
export const QBRICK_CATEGORY = 'Pojemniki'

export function parseQbrickCase(html: string, pageUrl: string): null | ImportedProduct {
  const rows = specifications(html)
  // Every page on this site has a heading; only a product has this table. A
  // case of empty measurements is worse than a refusal, because somebody has
  // to undo it.
  if (rows.size === 0) return null

  const heading = text(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? '')
  if (!heading) return null

  return {
    attributes: attributesOf(rows),
    brand: MANUFACTURER,
    // Every product on this site is one, and the catalog reads the category
    // rather than the kind wherever it groups things: the filter on the
    // catalog screen, the list a form offers, the heading on a card. A box
    // arriving with none sat in the one group nobody named.
    category: QBRICK_CATEGORY,
    kind: 'case',
    // Its product pages publish none. The downloads on this site are the
    // catalogue and the terms of sale.
    manuals: [],
    // What this box is called, without the maker's own name in front of it:
    // "PRO Drawer 3 Toolbox 2.0 Expert". The range alone — "PRO" — is what
    // every Qbrick in the workshop is, which tells none of them apart.
    model: modelOf(heading),
    name: nameOf(heading, lineOf(heading)),
    notes: descriptionOf(html),
    photoUrls: photosOf(html),
    sourceUrl: pageUrl,
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

// What every product on this site is called before it is called anything: the
// maker and the word "System". The card already says both — the maker is a row
// it points at — so the model is what is left after it.
const MAKER_PREFIX = /^qbrick\s+system\s+/i

// "QBRICK SYSTEM PRO TOOLCASE" — the word after "SYSTEM" is the line this box
// belongs to, and it is the one token in the heading that is capitals on
// purpose. Not the model: the model is the whole of what this box is called.
export function lineOf(heading: string): string {
  const after = /\bsystem\s+(\S+)/i.exec(heading)?.[1] ?? ''

  return after.toLocaleUpperCase('en-US')
}

// The heading without the maker's own name: "PRO Drawer 3 Toolbox 2.0 Expert".
//
// It was the line alone — "PRO" — and that is a fact about nine boxes rather
// than about this one. Every Qbrick in a workshop is a PRO, so a filter on it
// filters nothing and a label printed from it says nothing; what tells two of
// them apart is the rest of the heading, which is exactly what the maker calls
// the model.
//
// A heading that does not start with the maker's name has nothing to strip and
// therefore no model: it would otherwise be the name repeated one line down,
// which is worse than an empty field.
export function modelOf(heading: string): string {
  const rest = MAKER_PREFIX.test(heading) ? heading.replace(MAKER_PREFIX, '') : ''

  return rest ? readable(rest, lineOf(heading)) : ''
}

// The page shouts. A van full of boxes labelled in capitals is a van nobody can
// read, so the name is title-cased — and then the line is put back as it was,
// because "Pro" is a word and "PRO" is the name of a range.
export function nameOf(heading: string, line: string): string {
  return readable(heading, line)
}

function readable(heading: string, line: string): string {
  return heading
    .toLocaleLowerCase('pl-PL')
    .split(/\s+/)
    .map((word) =>
      word.toLocaleUpperCase('en-US') === line
        ? line
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
// Every row of the table, as a parameter, in the order somebody reads a box in.
//
// The dimension rows arrive as one string each — "450 [L] x 322 [W] x 126 [H]
// mm" — and become three parameters, because a length and a width are two
// facts and a screen showing them as one cannot compare two boxes.
//
// Named rather than "whatever the table says": a row nobody has decided about
// is a row nobody has decided about, and a page that grows a twelfth would
// otherwise arrive unlabelled.
const SHEET_ROWS: [label: string, row: string, unit: string][] = [
  ['przekątna', 'Przekątna', ' mm'],
  ['pojemność', 'Pojemność', ' L'],
  ['ładowność', 'Ładowność', ' kg'],
  ['waga', 'Waga', ''],
  ['ilość na palecie', 'Ilość na palecie', ''],
  ['ean', 'EAN', ''],
  ['sku', 'SKU', ''],
]

// The two rows the page writes as three numbers each.
const DIMENSIONS: [row: string, prefix: string][] = [
  ['wymiary zewnętrzne', 'zewnętrzna'],
  ['wymiary wewnętrzne', 'wewnętrzna'],
]

const AXES = ['Długość', 'Szerokość', 'Wysokość']

export function attributesOf(rows: Map<string, string>): ImportedAttribute[] {
  const attributes: ImportedAttribute[] = []

  for (const [row, prefix] of DIMENSIONS) {
    const sides = dimensions(rows.get(row))
    sides.forEach((side, index) => {
      if (side === null) return
      attributes.push({ name: `${AXES[index]} ${prefix}`, value: `${side} mm` })
    })
  }

  for (const [row, label, unit] of SHEET_ROWS) {
    const raw = rows.get(row)
    if (!raw) continue

    // A measurement is read as a number first and written back with its unit,
    // which is what keeps "212 cm 3" and a diagonal in micrometres out: the
    // number is checked, the string is derived from it.
    const measured = unit ? measurement(raw) : null
    if (unit && measured === null) continue

    attributes.push({ name: label, value: unit ? `${measured}${unit}` : raw })
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
