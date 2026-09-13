import assert from 'node:assert/strict'
import test from 'node:test'

import { importerFor, withoutTracking } from './index'
import { categoryOf, manualsOf, nameOf, parseSkilProduct, photosOf, specifications } from './skil'

const PAGE_URL = 'https://www.skileurope.com/pl/7615ab'

// The shape this shop has: a Product that names the kind of tool, a Magento
// table, a category only the analytics payload knows, and documents titled in
// the `title` of their links.
function page(
  options: { categories?: string; product?: Record<string, unknown>; rows?: string } = {},
) {
  const product = {
    '@type': 'Product',
    description: 'Kompaktowa szlifierka taśmowa z funkcją „Automatic Belt Control”.',
    image: 'https://www.skileurope.com/media/catalog/product/cache/74c1/S/P/SPD7615ABD_1.png',
    name: 'Szlifierka taśmowa',
    sku: '7615 AB',
    ...options.product,
  }

  const rows =
    options.rows ??
    `
      <tr><th class="col label" scope="row"> Moc </th><td class="col data">710 W</td></tr>
      <tr><th class="col label" scope="row">Rozmiar taśmy</th><td class="col data">76 x 457 mm</td></tr>
    `

  return `
    <html><head>
    <script type="application/ld+json">${JSON.stringify(product)}</script>
    </head><body>
    <script>{"item_category":"Elektronarzędzia","item_category2":"Szlifierki",${options.categories ?? '"item_category3":"Szlifierki taśmowe"'}}</script>
    <table class="additional-attributes w-full table-fixed">${rows}</table>
    <img src="https://www.skileurope.com/media/catalog/product/S/P/SPD7615APP01_1_1.png">
    <img src="https://www.skileurope.com/media/catalog/product/cache/74c1/S/P/SPD7615APP01_1_1.png">
    <a href="https://www.skileurope.com/media/product_attachments/I/n/InstrMan_7615_EUARFA.pdf"
       target="_blank" title="Pobierz Manual 7615 EUARFA (.PDF)">
      Pobierz Manual 7615 EUARFA (.PDF) <svg><title>arrow-sm-right</title></svg>
    </a>
    </body></html>
  `
}

test('a product page becomes a card', () => {
  const product = parseSkilProduct(page(), PAGE_URL)

  assert.ok(product)
  assert.equal(product.brand, 'SKIL')
  assert.equal(product.model, '7615 AB')
  assert.equal(product.sourceUrl, PAGE_URL)
  assert.match(product.notes, /^Kompaktowa szlifierka/)
})

test('the card is named for the machine, not for its kind alone', () => {
  // "Szlifierka taśmowa" is three of the tools in the shed; "7615 AB" is none
  // of them until somebody remembers what it is.
  assert.equal(nameOf('Szlifierka taśmowa', '7615 AB'), 'Szlifierka taśmowa 7615 AB')
  // Unless the shop already said it.
  assert.equal(nameOf('Szlifierka 7615 AB', '7615 AB'), 'Szlifierka 7615 AB')
  assert.equal(nameOf('', '7615 AB'), '7615 AB')
  assert.equal(nameOf('Szlifierka taśmowa', ''), 'Szlifierka taśmowa')
})

test('the category is the narrowest one the analytics payload names', () => {
  assert.equal(categoryOf(page()), 'Szlifierki taśmowe')
  // Without a third level, the second is as narrow as it gets.
  assert.equal(categoryOf(page({ categories: '"nothing":"here"' })), 'Szlifierki')
  assert.equal(categoryOf('<html></html>'), '')
})

test('a spec row is a heading and a cell', () => {
  assert.deepEqual(specifications(page()), [
    { name: 'Moc', value: '710 W' },
    { name: 'Rozmiar taśmy', value: '76 x 457 mm' },
  ])
  assert.deepEqual(specifications('<html></html>'), [])
})

test('the picture kept is the one that is not a resize', () => {
  // Magento serves every image twice: once under /cache/<hash>/ for whatever
  // the page needed, and once at its own address. The hash belongs to a layout
  // that will change.
  assert.deepEqual(photosOf(page()), [
    'https://www.skileurope.com/media/catalog/product/S/P/SPD7615APP01_1_1.png',
  ])
})

test('a document is titled by the attribute, not by the text with the icon in it', () => {
  // The link's text carries the arrow icon's own name; "Pobierz" is an
  // instruction to the reader rather than part of the title.
  assert.deepEqual(manualsOf(page()), [
    {
      title: 'Manual 7615 EUARFA',
      url: 'https://www.skileurope.com/media/product_attachments/I/n/InstrMan_7615_EUARFA.pdf',
    },
  ])
})

test('the analytics tail is not part of the address a card remembers', () => {
  // A link shared out of a campaign arrives with a paragraph of tracking on
  // it, and that is what the card would show as its source for ever after.
  assert.equal(
    withoutTracking(`${PAGE_URL}?_gl=1*162phni*_up*MQ..&utm_source=mail&gclid=xyz`),
    PAGE_URL,
  )
  // Anything that is about the product stays.
  assert.equal(withoutTracking(`${PAGE_URL}?variant=230V`), `${PAGE_URL}?variant=230V`)
  assert.equal(withoutTracking('nie adres'), 'nie adres')
})

test('the fourth source is reachable, and publishes documents', () => {
  assert.equal(importerFor(PAGE_URL)?.label, 'skileurope.com')
  assert.equal(importerFor(PAGE_URL)?.manuals, true)
  assert.equal(importerFor('https://skileurope.com/pl/x')?.label, 'skileurope.com')
  assert.equal(importerFor('https://skileurope.com.evil.example/x'), null)
})
