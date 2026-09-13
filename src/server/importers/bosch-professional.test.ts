import assert from 'node:assert/strict'
import test from 'node:test'

import {
  categoryOf,
  manualsOf,
  modelOf,
  parseBoschProfessionalProduct,
  specifications,
} from './bosch-professional'
import { importerFor } from './index'

const PAGE_URL = 'https://www.bosch-professional.com/pl/pl/products/gbh-18v-26-f-0611910000'

// The shape the blue line's own site has: a schema.org Product that leaves out
// the spec table, the category and the documents, and markup that has them.
function page(options: { crumbs?: string; product?: Record<string, unknown>; rows?: string } = {}) {
  const product = {
    '@type': 'Product',
    brand: { '@type': 'Brand', name: 'Bosch Professional' },
    description: 'PRO GBH 18V-26F Akumulatorowe młoty udarowo-obrotowe | Oferuje energię udaru.',
    gtin13: '3165140807937',
    image: [
      'https://www.bosch-professional.com/pl/pl/ocsmedia/230392-54/application-image/full/mlot.jpg',
      'https://www.bosch-professional.com/pl/pl/ocsmedia/238267-117/application-image/full/mlot2.jpg',
    ],
    name: 'PRO GBH 18V-26F',
    sku: '0611910000',
    ...options.product,
  }

  const crumbs =
    options.crumbs ??
    '["Elektronarz\\u0119dzia profesjonalne","Elektronarz\\u0119dzia akumulatorowe","Akumulatorowe m\\u0142oty udarowo-obrotowe","PRO GBH 18V-26F"]'

  const rows =
    options.rows ??
    `
      <div class="table__body-row">
        <div class="table__body-cell"><span>Napięcie akumulatora*</span></div>
        <div class="table__body-cell"><span>18,0 V </span></div>
      </div>
      <div class="table__body-row">
        <div class="table__body-cell"><span>Energia udaru*</span></div>
        <div class="table__body-cell"><span>2,6 J</span></div>
      </div>
    `

  return `
    <html><head>
    <script type="application/ld+json">${JSON.stringify(product)}</script>
    </head><body>
    <script>utag_data.page_breadcrumb = ${crumbs};</script>
    <h2>Dane techniczne</h2>${rows}
    <a href="https://www.bosch-professional.com/binary/manualsmedia/o431771.pdf" target="_blank">
      Instrukcja obsługi |&nbsp;GBH 18V-26, GBH 18V-26 F (PDF&nbsp;12.4&nbsp;MB)
    </a>
    <a href="https://www.bosch-professional.com/binary/manualsmedia/o580555.pdf">
      Karta danych produktu UE | PRO GBH 18V-26F (PDF 0.2 MB)
    </a>
    </body></html>
  `
}

test('a product page becomes a card', () => {
  const product = parseBoschProfessionalProduct(page(), PAGE_URL)

  assert.ok(product)
  assert.equal(product.name, 'PRO GBH 18V-26F')
  assert.equal(product.brand, 'Bosch Professional')
  assert.equal(product.sourceUrl, PAGE_URL)
  assert.equal(product.photoUrls.length, 2)
})

test('the model is the name without the line it belongs to', () => {
  // The catalog keeps the line in the brand, so "PRO" on the front of a model
  // number would be the same fact written twice.
  assert.equal(modelOf('PRO GBH 18V-26F'), 'GBH 18V-26F')
  assert.equal(modelOf('GWS 18V-10'), 'GWS 18V-10')
})

test('the category comes out of the page’s own analytics payload', () => {
  // An odd place, and the only one that has it: the JSON-LD carries no
  // category and the breadcrumb markup on this site is a list of empty names.
  // The last entry is the product, so the one before it is its kind.
  assert.equal(categoryOf(page()), 'Akumulatorowe młoty udarowo-obrotowe')
  assert.equal(categoryOf(page({ crumbs: '["Sklep","PRO GBH"]' })), 'Sklep')
  assert.equal(categoryOf(page({ crumbs: '[]' })), '')
  assert.equal(categoryOf('<html></html>'), '')
})

test('a spec row is two cells, and the footnote marker is not part of the name', () => {
  // "Napięcie akumulatora*" points at small print the card has no room for.
  assert.deepEqual(specifications(page()), [
    { name: 'Napięcie akumulatora', value: '18,0 V' },
    { name: 'Energia udaru', value: '2,6 J' },
  ])
})

test('a parameter measured four ways becomes one with all four readings', () => {
  // The vibration figures repeat for four ways of holding the machine, and the
  // card cannot hold the name twice.
  const product = parseBoschProfessionalProduct(
    page({
      rows: `
        <div class="table__body-row">
          <div class="table__body-cell"><span>Wartość emisji drgań ah</span></div>
          <div class="table__body-cell"><span>15,2 m/s²</span></div>
        </div>
        <div class="table__body-row">
          <div class="table__body-cell"><span>Wartość emisji drgań ah</span></div>
          <div class="table__body-cell"><span>9,6 m/s²</span></div>
        </div>
      `,
    }),
    PAGE_URL,
  )

  assert.equal(
    product?.attributes.find((attribute) => attribute.name === 'Wartość emisji drgań ah')?.value,
    '15,2 m/s²; 9,6 m/s²',
  )
})

test('a document is titled by its own link, not by the heading above it', () => {
  // The heading says "Instrukcja obsługi" for all of them; the link says which
  // machines each one covers, which is what tells two apart on a card.
  assert.deepEqual(manualsOf(page()), [
    {
      title: 'Instrukcja obsługi | GBH 18V-26, GBH 18V-26 F',
      url: 'https://www.bosch-professional.com/binary/manualsmedia/o431771.pdf',
    },
    {
      title: 'Karta danych produktu UE | PRO GBH 18V-26F',
      url: 'https://www.bosch-professional.com/binary/manualsmedia/o580555.pdf',
    },
  ])
})

test('the catalog number is taken, the EAN only when it is one', () => {
  const named = (html: string) =>
    (parseBoschProfessionalProduct(html, PAGE_URL)?.attributes ?? []).map((a) => a.name)

  assert.ok(named(page()).includes('Numer katalogowy'))
  assert.ok(named(page()).includes('Kod EAN'))
  assert.ok(!named(page({ product: { gtin13: '0611910000' } })).includes('Kod EAN'))
})

test('a page that sells nothing is refused', () => {
  assert.equal(parseBoschProfessionalProduct('<html><body>Kontakt</body></html>', PAGE_URL), null)
})

test('the third source is reachable, and publishes documents', () => {
  assert.equal(importerFor(PAGE_URL)?.label, 'bosch-professional.com')
  assert.equal(importerFor(PAGE_URL)?.manuals, true)
  assert.equal(importerFor('https://bosch-professional.com/pl/pl/products/x')?.manuals, true)
  assert.equal(importerFor('https://bosch-professional.com.evil.example/x'), null)
})
