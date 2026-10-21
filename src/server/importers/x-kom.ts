// Reading a product page off x-kom.pl — the electronics shop: the television,
// the laptop, the soundbar.
//
// The thirteenth shape, and the third shop. A schema.org Product carries the
// identity and a BreadcrumbList the category; everything else — the spec
// sheet, the gallery with its size template, the description, the maker's
// own code — is in the page's state, written as `window.__INITIAL_STATE__
// ['app'] = {…}`: plain JSON after an assignment, cut out by matching its
// braces and parsed once. The product is found in it under its own number,
// which is the first thing in the address.
//
// Pure, like every importer. The fetching lives in routes/item-import.ts.

import type { ItemKind } from '../routes/items-input'
import { mergeDuplicates } from './attributes'
import { text } from './html'
import type { ImportedAttribute, ImportedProduct, Importer } from './types'

export const xkom: Importer = {
  hosts: ['x-kom.pl', 'www.x-kom.pl'],
  label: 'x-kom.pl',
  manuals: false,
  parse: parseXkomProduct,
}

type Node = Record<string, unknown>

export function parseXkomProduct(html: string, pageUrl: string): null | ImportedProduct {
  const nodes = jsonLd(html)
  const product = nodes.find((node) => node['@type'] === 'Product')
  if (!product) return null

  const fullName = text(String(product.name ?? ''))
  if (!fullName) return null

  const state = productState(html, text(String(product.productID ?? product.sku ?? '')))
  const crumbs = crumbsOf(nodes)
  const brand = text(String((product.brand as Node | undefined)?.name ?? ''))

  return {
    attributes: attributesOf(state, product),
    brand,
    category: crumbs.at(-1) ?? '',
    kind: kindOf(crumbs),
    manuals: [],
    model: modelOf(state, fullName, brand),
    name: fullName,
    notes: notesOf(state),
    photoUrls: photosOf(state, product),
    sourceUrl: sourceUrlOf(html, pageUrl),
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

// The shop's own record of the product, out of the page's state. The state is
// one object assigned to `window.__INITIAL_STATE__['app']`, and the product
// sits in it under its number; a page without the state, or with a damaged
// one, is still a card — off the Product alone, with no sheet.
export function productState(html: string, id: string): null | Node {
  const marker = /window\.__INITIAL_STATE__\['app'\]\s*=\s*/.exec(html)
  if (!marker || !id) return null

  const from = marker.index + marker[0].length
  let depth = 0
  let inString = false

  for (let i = from; i < html.length; i++) {
    const char = html[i]

    if (inString) {
      if (char === '\\') i++
      else if (char === '"') inString = false
      continue
    }

    if (char === '"') inString = true
    else if (char === '{') depth++
    else if (char === '}' && --depth === 0) {
      try {
        const app = JSON.parse(html.slice(from, i + 1)) as Node
        const products = app.products as Node | undefined
        const product = products?.[id]
        return product && typeof product === 'object' ? (product as Node) : null
      } catch {
        return null
      }
    }
  }

  return null
}

function crumbsOf(nodes: Node[]): string[] {
  const list = nodes.find((node) => node['@type'] === 'BreadcrumbList')
  const entries = Array.isArray(list?.itemListElement) ? list.itemListElement : []

  return entries.map((entry) => text(String((entry as Node | null)?.name ?? ''))).filter(Boolean)
}

// The shop sells electronics, which the catalog files with the appliances —
// a television is the example the kind was named for. The one shelf that is
// not is the service tools, and it says so in its name.
export function kindOf(crumbs: string[]): ItemKind {
  return crumbs.some((crumb) => /narzędzi/i.test(crumb)) ? 'tool' : 'appliance'
}

// The shop keeps the model apart from the maker — `name` is "UE50NU7402"
// where `fullName` is "Samsung UE50NU7402" — and that is the card's model.
// Without the state, it is the full name with the maker taken off the front.
export function modelOf(state: null | Node, fullName: string, brand: string): string {
  const own = text(String(state?.name ?? ''))
  if (own) return own

  return brand && fullName.toLocaleLowerCase('pl-PL').startsWith(brand.toLocaleLowerCase('pl-PL'))
    ? fullName.slice(brand.length).trim()
    : fullName
}

// The spec sheet: a key and a list of values, one for a number and several
// for a list — three tuners, two apps — which become one value, comma
// separated. The maker's own code is the parameter the sheet does not carry.
export function specifications(state: null | Node): ImportedAttribute[] {
  const features = Array.isArray(state?.features) ? state.features : []
  const attributes: ImportedAttribute[] = []

  for (const feature of features) {
    const node = feature as Node | null
    const name = text(String(node?.key ?? ''))
    const values = (Array.isArray(node?.values) ? node.values : [])
      .map((value) => text(String((value as Node | null)?.name ?? '')))
      .filter(Boolean)
    if (!name || values.length === 0) continue

    attributes.push({ name, value: values.join(', ') })
  }

  return attributes
}

function attributesOf(state: null | Node, product: Node): ImportedAttribute[] {
  const attributes = specifications(state)

  const code = text(String(state?.producerCode ?? product.mpn ?? ''))
  if (code) attributes.push({ name: 'Kod producenta', value: code })

  return mergeDuplicates(attributes)
}

// The description, which the shop opens with a box inviting a phone call —
// marked for its own layout as `Xkom_Only`, and cut on that mark, because a
// card is not a place to be sold the thing it already describes. What is
// left is headings and paragraphs, read line by line and each made to end a
// sentence, since the card folds them into one.
export function notesOf(state: null | Node): string {
  const raw = String(state?.productDescription ?? '')
  if (!raw) return ''

  const lines = raw
    .replace(/<!--\s*Xkom_Only\s*-->[\s\S]*?<!--\s*Xkom_Only end\s*-->/gi, '')
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/?(?:h\d|p|li|div|br|ul|ol|tr|table|center)\b[^>]*>/gi, '\n')
    .split('\n')
    .map((line) => text(line).replace(/\s+([,.?!:;])/g, '$1'))
    .filter(Boolean)

  return lines.map((line) => (/[.!?:;]$/.test(line) ? line : `${line}.`)).join(' ')
}

// The gallery, at the largest size the shop's image host serves. Each picture
// comes with a template — "…/{SIZE},,2018/7/….jpg" — and the size the page
// shows is not the largest there is: `product-original` is 900 px where the
// Product's own addresses are 617. The Product's list is the fallback.
const PHOTO_SIZE = 'product-original'

export function photosOf(state: null | Node, product: Node): string[] {
  const seen = new Set<string>()
  const urls: string[] = []
  const keep = (url: unknown) => {
    if (typeof url !== 'string' || !url.startsWith('http') || seen.has(url)) return
    seen.add(url)
    urls.push(url)
  }

  const photos = Array.isArray(state?.photos) ? state.photos : []
  for (const photo of photos) {
    const node = photo as Node | null
    const template = typeof node?.urlTemplate === 'string' ? node.urlTemplate : ''
    keep(template.includes('{SIZE}') ? template.replace('{SIZE}', PHOTO_SIZE) : node?.url)
  }
  if (urls.length > 0) return urls

  const images = Array.isArray(product.image)
    ? product.image
    : typeof product.image === 'string'
      ? [product.image]
      : []
  for (const image of images) keep(image)

  return urls
}

// The page's canonical address, without the `#Specyfikacja` a link copied
// off the spec tab ends in.
export function sourceUrlOf(html: string, pageUrl: string): string {
  const canonical = /<meta[^>]+property="og:url"[^>]+content="([^"]*)"/i.exec(html)?.[1]
  if (canonical && /^https:\/\/www\.x-kom\.pl\/p\//.test(canonical)) return canonical.split('#')[0]

  return pageUrl.split('#')[0]
}
