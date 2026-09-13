// Reading a product page off stanleyworks.pl.
//
// The fifth shape, and the plainest: no schema.org, no CMS payload, no
// analytics category — a Drupal page with the facts in its markup. The name is
// the heading, the category is the last breadcrumb before the product, the
// spec table is a table, and the pictures are on a path of their own.
//
// Pure, like every importer. The fetching lives in routes/tool-import.ts.

import { mergeDuplicates } from './attributes'
import { text } from './html'
import type { ImportedAttribute, ImportedProduct, Importer } from './types'

const ORIGIN = 'https://www.stanleyworks.pl'

// The site is one brand, spelled the way the catalog spells it.
const BRAND = 'STANLEY'

export const stanley: Importer = {
  hosts: ['stanleyworks.pl', 'www.stanleyworks.pl'],
  label: 'stanleyworks.pl',
  // The page links one EU declaration and loads its actual manuals from
  // `/pdp/get-manuals/<nodeId>` after it has rendered. Reading that would mean
  // a second request, which no importer makes: what this one can promise is
  // what the page itself says, and it says no manuals.
  manuals: false,
  parse: parseStanleyProduct,
}

export function parseStanleyProduct(html: string, pageUrl: string): null | ImportedProduct {
  const name = text(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? '')
  if (!name) return null

  const attributes = specifications(html)
  // A page with a heading and nothing else is a category page or a redirect,
  // not a product — and a card of empty fields is worse than a refusal.
  if (attributes.length === 0) return null

  const catalogNumber = catalogNumberOf(pageUrl)
  if (catalogNumber) attributes.push({ name: 'Numer katalogowy', value: catalogNumber })

  return {
    attributes: mergeDuplicates(attributes),
    brand: BRAND,
    category: categoryOf(html),
    manuals: [],
    model: modelOf(name),
    name,
    // The page carries no prose about the tool: what it has is the heading,
    // the features and the table. An empty note beats an invented one.
    notes: '',
    photoUrls: photosOf(html),
    sourceUrl: pageUrl,
  }
}

// "Zszywacz elektryczny TRE650 Stanley" — the shouted token is the machine.
// The maker's own name is not one, and neither is a Polish word in capitals at
// the start of a sentence, which is why a digit is required.
export function modelOf(name: string): string {
  const token = name
    .split(/\s+/)
    .map((word) => word.replace(/^[("']+|[)"',.]+$/g, ''))
    .find(
      (word) =>
        word.length > 2 &&
        /\d/.test(word) &&
        word === word.toLocaleUpperCase('pl-PL') &&
        word.toLocaleUpperCase('pl-PL') !== BRAND,
    )

  return token ?? ''
}

// "/produkt/6-tre650/zszywacz-elektryczny-tre650-stanley" — the first segment
// after /produkt/ is the number the shop orders it by.
export function catalogNumberOf(pageUrl: string): string {
  try {
    const [, , slug] = new URL(pageUrl).pathname.split('/')
    return slug ? slug.toLocaleUpperCase('en-US') : ''
  } catch {
    return ''
  }
}

// The kind of tool: the last breadcrumb that is not the product itself. The
// list ends with the product on this site, and begins with "Home".
export function categoryOf(html: string): string {
  const nav = /breadcrumb[\s\S]{0,4000}?<\/nav>/i.exec(html)?.[0]
  if (!nav) return ''

  const crumbs = [...nav.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((crumb) => text(crumb[1]))
    .filter((crumb) => crumb && !/^(home|breadcrumb)$/i.test(crumb))

  return crumbs.at(-1) ?? ''
}

// Drupal's own table: a row is two cells, each wrapping its text in a div.
export function specifications(html: string): ImportedAttribute[] {
  const table =
    /<table[^>]*class="[^"]*reference_entity_table[^"]*"[^>]*>([\s\S]*?)<\/table>/i.exec(html)
  if (!table) return []

  const attributes: ImportedAttribute[] = []

  for (const row of table[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => text(cell[1]))
    const [name, value] = cells

    if (name && value) attributes.push({ name, value })
  }

  return attributes
}

// The photographs, at the size they were published rather than the size this
// page asked for: `?resize=530x530` is the layout talking.
export function photosOf(html: string): string[] {
  const seen = new Set<string>()
  const urls: string[] = []

  for (const match of html.matchAll(
    /(?:data-src|src)="((?:https:\/\/[^"]+)?\/EMEA\/PRODUCT\/IMAGES\/[^"]+?\.(?:jpe?g|png|webp))(?:\?[^"]*)?"/gi,
  )) {
    const url = match[1].startsWith('http') ? match[1] : `${ORIGIN}${match[1]}`
    if (seen.has(url)) continue

    seen.add(url)
    urls.push(url)
  }

  return urls
}
