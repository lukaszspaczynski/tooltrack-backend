// Reading a product page off nac.com.pl — the maker's own site.
//
// The seventh shape, and the first built on WordPress: every page here is a
// post, so the page's own schema.org calls a garden shredder a BlogPosting and
// there is no Product anywhere to read. What the theme does have is anchors.
// The page links its own sections — #galeria, #parametry, #opis — and keeps
// its facts under them: the specification is a list of em/strong pairs rather
// than a table, the description is the bullets under #opis, and the documents
// are icon boxes beside the heading. The heading itself carries the model in a
// span of its own, which is what tells a product page from a shelf.
//
// Pure, like every importer. The fetching lives in routes/item-import.ts.

import { manualTitle, mergeDuplicates } from './attributes'
import { text } from './html'
import type { ImportedAttribute, ImportedManual, ImportedProduct, Importer } from './types'

// The site is one maker, spelled the way the catalog spells it.
const BRAND = 'NAC'

export const nac: Importer = {
  hosts: ['nac.com.pl', 'www.nac.com.pl'],
  label: 'nac.com.pl',
  manuals: true,
  parse: parseNacProduct,
}

export function parseNacProduct(html: string, pageUrl: string): null | ImportedProduct {
  const heading = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? ''
  const name = text(heading)
  const model = modelOf(heading)

  // "Kosiarki" and "Zaprojektowane do pracy" are headings too. A product's is
  // the only one with the model set apart in it, and on a site where every
  // page is a post that mark is the one thing a shelf never carries.
  if (!name || !model) return null

  return {
    attributes: attributesOf(html),
    kind: 'tool',
    brand: BRAND,
    category: categoryOf(html),
    manuals: manualsOf(html),
    model,
    name,
    notes: notesOf(html),
    photoUrls: photosOf(html),
    sourceUrl: pageUrl,
  }
}

// The heading is written in two parts — "Rozdrabniacz elektryczny" and then
// "SHE280S-BOX-G" in a span, so the theme can set the model on its own line.
// The card wants both: the whole thing is the name, the span is the model.
export function modelOf(heading: string): string {
  return text(/<span[^>]*>([\s\S]*?)<\/span>/i.exec(heading)?.[1] ?? '')
}

// The kind of item, as the post is filed: "Rozdrabniacze", "Aeratory i
// wertykulatory". The page prints its own shelf above the heading as well, but
// that is a heading among many and this is a field.
export function categoryOf(html: string): string {
  const post = graphOf(html).find((node) => node['@type'] === 'BlogPosting')

  return text(String(post?.articleSection ?? ''))
}

// What the shop lists under "Parametry": a list, not a table, and every row is
// the parameter in an em and its value in a strong.
export function specifications(html: string): ImportedAttribute[] {
  const list = /id="parametry"[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/i.exec(html)?.[1]
  if (!list) return []

  const attributes: ImportedAttribute[] = []

  for (const item of list.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    const name = text(/<em[^>]*>([\s\S]*?)<\/em>/i.exec(item[1])?.[1] ?? '')
    const value = text(superscripts(/<strong[^>]*>([\s\S]*?)<\/strong>/i.exec(item[1])?.[1] ?? ''))
    if (!name || !value) continue

    // Some rows were typed with a colon and some without, on the same page.
    attributes.push({ name: name.replace(/\s*:$/, ''), value })
  }

  return attributes
}

// The barcode, which the theme prints under the heading as a field of its own.
export function eanOf(html: string): string {
  const field =
    /ean-style[\s\S]{0,600}?jet-listing-dynamic-field__content"[^>]*>([\s\S]*?)<\/div>/i.exec(
      html,
    )?.[1]

  return text(field ?? '')
}

function attributesOf(html: string): ImportedAttribute[] {
  const attributes = specifications(html)

  const ean = eanOf(html)
  if (/^\d{13}$/.test(ean)) attributes.push({ name: 'Kod EAN', value: ean })

  return mergeDuplicates(attributes)
}

// What the item is for, as the bullets under "Opis produktu". The table of
// numbers is the specification and is read separately, so the note is prose.
export function notesOf(html: string): string {
  const list = /id="opis"[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/i.exec(html)?.[1]
  if (!list) return ''

  const bullets = [...list.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((bullet) => text(bullet[1]))
    .filter(Boolean)

  // Somebody ended some of these with a full stop and some without, and run
  // together as they are they read as one sentence that never finishes.
  return bullets.map((bullet) => (/[.!?…]$/.test(bullet) ? bullet : `${bullet}.`)).join(' ')
}

// The documents beside the heading: the manual, and the declaration of
// conformity the page files under "Certyfikaty". A third box holds the rating
// plate as a photograph rather than a PDF, which is why the address decides
// what is a document here and the label does not.
export function manualsOf(html: string): ImportedManual[] {
  const manuals: ImportedManual[] = []
  const seen = new Set<string>()

  for (const box of html.matchAll(
    /elementor-icon-box-title[^>]*>\s*<a[^>]+href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const url = box[1]
    if (seen.has(url)) continue
    seen.add(url)

    manuals.push({ title: manualTitle(text(box[2])), url })
  }

  return manuals
}

// The shop's own picture first and the carousel after it, because the carousel
// does not lead with it — the slides are in whatever order they were uploaded,
// and the first photograph is the one the card shows.
export function photosOf(html: string): string[] {
  return [...new Set([mainPhotoOf(html), ...galleryOf(html)].filter(Boolean))]
}

function mainPhotoOf(html: string): string {
  const page = graphOf(html).find((node) => node['@type'] === 'WebPage')
  const url = (page?.image as { url?: unknown } | undefined)?.url

  return typeof url === 'string' && url.startsWith('http') ? url : ''
}

// Full-size, off the lightbox links rather than the img tags, which carry the
// thumbnail the carousel asked for. Bounded by the next section the page links,
// so a photograph of a different machine further down is not the card's.
function galleryOf(html: string): string[] {
  const gallery = /id="galeria"([\s\S]*?)id="parametry"/i.exec(html)?.[1]
  if (!gallery) return []

  return [
    ...gallery.matchAll(
      /<a[^>]+href="(https:\/\/[^"]+\/wp-content\/uploads\/[^"]+\.(?:webp|jpe?g|png))"/gi,
    ),
  ].map((slide) => slide[1])
}

// "212 cm<sup>3</sup>" is a unit, and tags out is "212 cm 3" — a different
// number. The page writes the two that turn up on a spec sheet as markup.
const SUPERSCRIPTS: Record<string, string> = { 2: '²', 3: '³' }

function superscripts(html: string): string {
  return html.replace(
    /\s*<sup[^>]*>\s*([23])\s*<\/sup>/gi,
    (_, digit: string) => SUPERSCRIPTS[digit],
  )
}

type Node = Record<string, unknown>

// One block, and everything the SEO plugin knows inside it. There is no
// Product among the nodes — this is WordPress, so a shredder is a BlogPosting.
function graphOf(html: string): Node[] {
  const block = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i.exec(html)
  if (!block) return []

  try {
    const data = JSON.parse(block[1].trim()) as { '@graph'?: unknown }
    return Array.isArray(data['@graph']) ? (data['@graph'] as Node[]) : []
  } catch {
    return []
  }
}
