import assert from 'node:assert/strict'
import test from 'node:test'

import {
  categoryOf,
  modelOf,
  notesOf,
  parseGardenaProduct,
  photosOf,
  specifications,
} from './gardena'
import { importerFor } from './index'

const PAGE_URL =
  'https://www.gardena.com/pl/produkty/pompy/pompy-do-nawadniania/pompa-do-deszczowki-47002-inox-automatic/967975001.html'

const MEDIA = 'https://media.husqvarnagroup.com/image'
const SIZED = '?optimize=low&format=webply&height=520&width=750&fit=bounds'

// The store's shape: a Product for the name, the maker and the gallery, and
// everything a person would call a specification in the markup.
function page(options: { name?: string; rows?: string } = {}) {
  const product = {
    '@type': 'Product',
    brand: { '@type': 'Brand', name: 'GARDENA' },
    description: 'Najwygodniejszy sposób wykorzystania beczki na deszczówkę',
    image: [`${MEDIA}/GA510-0484.png${SIZED}`, `${MEDIA}/GA510-0500.png${SIZED}`],
    mainEntityOfPage: {
      '@type': 'ItemPage',
      breadcrumb: {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', name: 'Produkty', position: 1 },
          { '@type': 'ListItem', name: 'Pompy', position: 2 },
          { '@type': 'ListItem', name: 'Pompy do nawadniania', position: 3 },
        ],
      },
    },
    mpn: '967975001',
    name: options.name ?? 'Pompa do deszczówki 4700/2 inox automatic',
    sku: '967975001',
  }

  // Two divs a row, and the page prints the block twice — once for a wide
  // screen and once for a narrow one.
  const rows =
    options.rows ??
    `
      <div class="tech-data-item row">
        <div class="text-list-type col-6 text-white">Moc znamionowa</div>
        <div class="text-list-value col-6">550 W</div>
      </div>
      <div class="tech-data-item row">
        <div class="text-list-type col-6 text-white">GTIN-13/EAN</div>
        <div class="text-list-value col-6">4078500047869</div>
      </div>
      <div class="tech-data-item row">
        <div class="text-list-type col-6 text-white">Maks. temperatura medium</div>
        <div class="text-list-value col-6">35 &deg;C</div>
      </div>
    `

  return `
    <html><head>
    <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org/', '@graph': [product] })}</script>
    </head><body>
    <h1>${product.name}</h1>
    <div class="checkout-text-dark readmore">
      <span class="product-desc">Zmień swoje otoczenie w rajski ogród. Pompa ma wydajność 4700 l/h.</span>
    </div>
    <div class="product-info-tab">${rows}</div>
    <div class="product-info-tab">${rows}</div>
    </body></html>
  `
}

test('a product page becomes a card', () => {
  const product = parseGardenaProduct(page(), PAGE_URL)

  assert.ok(product)
  assert.equal(product.name, 'Pompa do deszczówki 4700/2 inox automatic')
  assert.equal(product.brand, 'GARDENA')
  assert.equal(product.category, 'Pompy do nawadniania')
  assert.equal(product.sourceUrl, PAGE_URL)
})

test('the model starts at the first word with a digit in it', () => {
  // "inox automatic" is part of what the machine is called, not a description.
  assert.equal(modelOf('Pompa do deszczówki 4700/2 inox automatic'), '4700/2 inox automatic')
  assert.equal(modelOf('Pompa ogrodowa 4100 Silent'), '4100 Silent')
  assert.equal(modelOf('Zestaw przyłączeniowy'), '')
})

test('which box it came in is not the model', () => {
  // One machine sold two ways. The dash is where the model stops.
  assert.equal(
    modelOf('Akumulatorowa pompa do deszczówki 2000/2 18V P4A – zestaw z akumulatorem'),
    '2000/2 18V P4A',
  )
  assert.equal(
    modelOf('Akumulatorowa pompa do deszczówki 2000/2 18V P4A – bez akumulatora'),
    '2000/2 18V P4A',
  )
})

test('the category is the last crumb that is not the shop itself', () => {
  assert.equal(categoryOf(JSON.parse(JSON.stringify({}))), '')
  assert.equal(parseGardenaProduct(page(), PAGE_URL)?.category, 'Pompy do nawadniania')
})

test('the specification is two divs a row', () => {
  assert.deepEqual(specifications(page()).slice(0, 3), [
    { name: 'Moc znamionowa', value: '550 W' },
    { name: 'GTIN-13/EAN', value: '4078500047869' },
    // The entity a spec sheet writes a unit with is the character on the card.
    { name: 'Maks. temperatura medium', value: '35 °C' },
  ])
})

test('a block printed twice is one specification, not two', () => {
  // The page repeats the rows for a wide screen and a narrow one.
  const names = parseGardenaProduct(page(), PAGE_URL)?.attributes.map((a) => a.name) ?? []

  assert.equal(new Set(names).size, names.length)
})

test('the barcode is the page’s own row, not one this adds', () => {
  const attributes = parseGardenaProduct(page(), PAGE_URL)?.attributes ?? []
  const value = (name: string) => attributes.find((a) => a.name === name)?.value

  assert.equal(value('GTIN-13/EAN'), '4078500047869')
  assert.equal(value('Numer katalogowy'), '967975001')
  assert.equal(value('Kod EAN'), undefined)
})

test('the note is the paragraph, not the line of marketing above it', () => {
  assert.equal(
    notesOf(page()),
    'Zmień swoje otoczenie w rajski ogród. Pompa ma wydajność 4700 l/h.',
  )
})

test('a photograph comes at the size it was published', () => {
  // `?height=520&width=750` is the layout talking: ten kilobytes of WebP where
  // the file itself is most of two megabytes.
  assert.deepEqual(photosOf({ image: [`${MEDIA}/GA510-0484.png${SIZED}`] }), [
    `${MEDIA}/GA510-0484.png`,
  ])
})

test('the same picture at two sizes is one picture', () => {
  assert.deepEqual(photosOf({ image: [`${MEDIA}/a.png${SIZED}`, `${MEDIA}/a.png?width=100`] }), [
    `${MEDIA}/a.png`,
  ])
})

test('a page that sells nothing is refused', () => {
  // A category page has no Product in its graph, and a card of empty fields is
  // worse than a refusal.
  assert.equal(parseGardenaProduct('<html><body>Pompy</body></html>', PAGE_URL), null)
})

test('the eighth source is reachable, and publishes no documents', () => {
  assert.equal(importerFor(PAGE_URL)?.label, 'gardena.com')
  assert.equal(importerFor(PAGE_URL)?.manuals, false)
  assert.equal(importerFor('https://gardena.com.evil.example/pl/x.html'), null)
})
