import assert from 'node:assert/strict'
import test from 'node:test'

import { importerFor } from './index'
import { categoryOf, manualsOf, modelOf, notesOf, parseLidlProduct, specifications } from './lidl'

const PAGE_URL =
  'https://www.lidl.pl/p/parkside-frezarka-gornowrzecionowa-1200-w-pof-1200-f5/p100399592'

// The shop's shape: a Product for the name and the numbers, and everything a
// person would call a specification inside the description.
function page(options: { product?: Record<string, unknown>; rows?: string } = {}) {
  const product = {
    '@context': 'http://schema.org',
    '@type': 'Product',
    brand: { '@type': 'Brand', name: 'PARKSIDE®' },
    gtin13: ['4052916982662'],
    image: ['https://www.lidl.pl/assets/gcpaeef.jpg', 'https://www.lidl.pl/assets/gcp90b2.jpg'],
    name: 'Frezarka górnowrzecionowa, 1200 W, POF 1200 F5',
    sku: '100399592',
    ...options.product,
  }

  const rows =
    options.rows ??
    `
      <tr><td>Tryb pracy:</td><td>zasilanie sieciowe</td></tr>
      <tr><td>Moc:</td><td>1200 W</td></tr>
      <tr><td>Prędkość biegu jałowego:</td><td>11 000&ndash;30 000 min</td></tr>
    `

  return `
    <html><head>
    <script type="application/ld+json">${JSON.stringify(product)}</script>
    </head><body>
    <nav class="breadcrumbs"><a href="/">Strona główna</a><a href="/n">Narzędzia</a><a href="/h">Heblarki i frezarki</a></nav>
    <article class="content-tabs__description description--non-legacy">
      <h3>PARKSIDE® Frezarka</h3>
      <p><strong>Opis produktu</strong></p>
      <ul><li>Do obróbki drewna</li><li>7 regulowanych prędkości</li></ul>
      <p><strong>Cechy produktu</strong></p>
      <table>${rows}</table>
    </article>
    <table class="downloads">
      <thead><tr><th></th><th>Język</th><th>Nazwa pliku</th></tr></thead>
      <tbody><tr class="downloads__body">
        <td><a href="https://www.lidl.pl/assets/gcp6934.pdf" download="IAN_525250.pdf"></a></td>
        <td>PL</td>
        <td><a href="https://www.lidl.pl/assets/gcp6934.pdf" download="IAN_525250.pdf">IAN_525250.pdf</a></td>
      </tr></tbody>
    </table>
    </body></html>
  `
}

test('a product page becomes a card', () => {
  const product = parseLidlProduct(page(), PAGE_URL)

  assert.ok(product)
  assert.equal(product.name, 'Frezarka górnowrzecionowa, 1200 W, POF 1200 F5')
  assert.equal(product.category, 'Heblarki i frezarki')
  assert.equal(product.photoUrls.length, 2)
  assert.equal(product.sourceUrl, PAGE_URL)
})

test('the trademark sign is the shop being careful, not part of the name', () => {
  // A brand nobody else spells that way would sit beside the right one for
  // ever, and the catalog already calls it PARKSIDE.
  assert.equal(parseLidlProduct(page(), PAGE_URL)?.brand, 'PARKSIDE')
})

test('the model is the part of the name with letters and digits in it', () => {
  // "what it is, what it draws, what it is called" — in that order.
  assert.equal(modelOf('Frezarka górnowrzecionowa, 1200 W, POF 1200 F5'), 'POF 1200 F5')
  assert.equal(modelOf('Wiertarka udarowa, 900 W, PSBM 900 A1'), 'PSBM 900 A1')
  assert.equal(modelOf('Zestaw kluczy nasadowych'), '')
})

test('the specification is a table somebody typed into the description', () => {
  // Every name ends in a colon because that is how it was written.
  assert.deepEqual(specifications(page()), [
    { name: 'Tryb pracy', value: 'zasilanie sieciowe' },
    { name: 'Moc', value: '1200 W' },
    // An entity a spec sheet writes a range with is a dash on the card.
    { name: 'Prędkość biegu jałowego', value: '11 000–30 000 min' },
  ])
})

test('the downloads table is not mistaken for a specification', () => {
  // It is a table too, and its columns are a language and a file name rather
  // than a parameter and its value.
  const names = specifications(page()).map((attribute) => attribute.name)

  assert.ok(!names.includes('Język'))
  assert.ok(!names.some((name) => name.includes('IAN')))
})

test('the note is what the tool is for, not the spec sheet written twice', () => {
  assert.equal(notesOf(page()), 'Do obróbki drewna. 7 regulowanych prędkości')
})

test('a document is named by its file and its language, because it has no title', () => {
  assert.deepEqual(manualsOf(page()), [
    { title: 'IAN 525250 (PL)', url: 'https://www.lidl.pl/assets/gcp6934.pdf' },
  ])
})

test('the catalog number and the barcode come off the Product', () => {
  const attributes = parseLidlProduct(page(), PAGE_URL)?.attributes ?? []
  const value = (name: string) => attributes.find((attribute) => attribute.name === name)?.value

  assert.equal(value('Numer katalogowy'), '100399592')
  // The shop writes the barcode as a list, because one card can cover several.
  assert.equal(value('Kod EAN'), '4052916982662')
})

test('a page that sells nothing is refused', () => {
  assert.equal(parseLidlProduct('<html><body>Regulamin</body></html>', PAGE_URL), null)
})

test('the sixth source is reachable, and publishes its manual', () => {
  assert.equal(importerFor(PAGE_URL)?.label, 'lidl.pl')
  assert.equal(importerFor(PAGE_URL)?.manuals, true)
  assert.equal(importerFor('https://lidl.pl.evil.example/p/x'), null)
})

test('the category stops before the product itself', () => {
  assert.equal(categoryOf(page()), 'Heblarki i frezarki')
  assert.equal(categoryOf('<html></html>'), '')
})
