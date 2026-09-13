import assert from 'node:assert/strict'
import test from 'node:test'

import { modelOf, parseBoschDiyProduct, specifications } from './bosch-diy'
import { importerFor } from './index'

const PAGE_URL = 'https://www.bosch-diy.com/pl/pl/p/citymower-18v-32-300-06008b9a08'

// The shape the maker's own page has: everything in __NEXT_DATA__, under a
// component key that is a hash of the page — which is why the parser finds it
// by what it carries rather than by where it sits.
function page(
  options: {
    kits?: unknown[]
    gallery?: unknown[]
    name?: string
    sku?: string
    specs?: unknown
  } = {},
) {
  const product = {
    models: {
      productDescriptionSection: { text: '<p>CityMower18 to lekka kosiarka.</p>' },
      scopeOfDeliverySection: {
        content: {
          kits: options.kits ?? [
            {
              deliveryDetails: ['1 akumulator PBA 18V 4.0Ah', 'Ładowarka AL 1830 CV'],
              eanCode: '4059952562988',
              name: '1 akumulator 4,0 Ah | ładowarka',
              orderNumber: '06008B9A07',
            },
            {
              deliveryDetails: ['Kartonowe pudełko'],
              eanCode: '4059952562995',
              name: 'Bez akumulatora | Bez ładowarki',
              orderNumber: '06008B9A08',
            },
          ],
        },
      },
      stageSection: {
        categories: [{ name: 'Kosiarka akumulatorowa' }],
        gallery: options.gallery ?? [
          {
            stageImage: {
              d: { src: '/imagestorage/pl-pl/kosiarki-359149_w_1600_h_800.png?imgWidth=1600' },
              xs: { src: '/imagestorage/pl-pl/kosiarki-359149_w_415_h_234.png?imgWidth=415' },
            },
            thumbnail: { d: { src: '/imagestorage/pl-pl/kosiarki-359149_w_960_h_540.png' } },
          },
        ],
        name: options.name ?? 'CityMower 18V-32-300 - Bez akumulatora | Bez ładowarki',
        sku: options.sku ?? '06008B9A08',
      },
      technicalSpecificationsSection: options.specs ?? {
        properties: [
          { name: 'Napięcie akumulatora', value: '18.0 V' },
          { name: 'Szerokość cięcia', value: '32 cm' },
        ],
        sectionTitle: 'Dane techniczne',
      },
    },
  }

  const data = {
    props: { pageProps: { page: { page: { u2bcbad3df0934fdda3396505ca838ffa: product } } } },
  }

  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`
}

test('a product page becomes a card', () => {
  const product = parseBoschDiyProduct(page(), PAGE_URL)

  assert.ok(product)
  assert.equal(product.name, 'CityMower 18V-32-300 - Bez akumulatora | Bez ładowarki')
  assert.equal(product.category, 'Kosiarka akumulatorowa')
  assert.equal(product.notes, 'CityMower18 to lekka kosiarka.')
  assert.equal(product.sourceUrl, PAGE_URL)
})

test('the maker is the site, not a guess', () => {
  // The whole of bosch-diy.com is one line of one maker. Reading it off a
  // breadcrumb would be tea leaves about a fact the address already settles.
  assert.equal(parseBoschDiyProduct(page(), PAGE_URL)?.brand, 'Bosch Home & Garden')
})

test('the model is the machine, not the box it comes in', () => {
  assert.equal(
    modelOf('CityMower 18V-32-300 - Bez akumulatora | Bez ładowarki'),
    'CityMower 18V-32-300',
  )
  assert.equal(modelOf('AdvancedRotak 36-750 – 1 akumulator'), 'AdvancedRotak 36-750')
  // A name with no such suffix is the model, which on this site it is.
  assert.equal(modelOf('UniversalImpact 800'), 'UniversalImpact 800')
})

test('a page that is not a product is refused', () => {
  // Both sections, not either: a listing page has a stage of its own.
  assert.equal(parseBoschDiyProduct('<html><body>Kontakt</body></html>', PAGE_URL), null)
  assert.equal(parseBoschDiyProduct('<script id="__NEXT_DATA__">{oops</script>', PAGE_URL), null)
})

test('the numbers describe the configuration the page is about', () => {
  // A product page offers several kits — with a battery, with two, with
  // neither — and only one of them is the thing at this address. The others
  // describe a tool nobody bought.
  const attributes = parseBoschDiyProduct(page(), PAGE_URL)?.attributes ?? []
  const value = (name: string) => attributes.find((entry) => entry.name === name)?.value

  assert.equal(value('Numer katalogowy'), '06008B9A08')
  assert.equal(value('Kod EAN'), '4059952562995')
  assert.equal(value('W zestawie'), 'Kartonowe pudełko')
})

test('the second half of the spec sheet is the same spec sheet', () => {
  // Noise and vibration sit behind "Pokaż więcej", written as a row of titles
  // and a row of values rather than as pairs.
  const specs = specifications({
    properties: [{ name: 'Waga', value: '9,400 kg' }],
    showMoreSection: {
      properties: [{ values: ['2,5 m/s²', '1,5 m/s²'] }],
      valueTitles: ['Wartość emisji drgań ah', 'Błąd pomiaru K'],
    },
  })

  assert.deepEqual(specs, [
    { name: 'Waga', value: '9,400 kg' },
    { name: 'Wartość emisji drgań ah', value: '2,5 m/s²' },
    { name: 'Błąd pomiaru K', value: '1,5 m/s²' },
  ])
})

test('the biggest picture the page names is the one kept', () => {
  // Every picture is offered in a handful of widths, baked into the file name.
  // A card is looked at on a phone today and printed on a label tomorrow.
  assert.deepEqual(parseBoschDiyProduct(page(), PAGE_URL)?.photoUrls, [
    'https://www.bosch-diy.com/imagestorage/pl-pl/kosiarki-359149_w_1600_h_800.png?imgWidth=1600',
  ])
})

test('the maker’s own site is where the documents are', () => {
  assert.equal(importerFor(PAGE_URL)?.manuals, true)
})

test('every source the registry holds is reachable, and nothing else is', () => {
  assert.equal(importerFor(PAGE_URL)?.label, 'bosch-diy.com')
  assert.equal(importerFor('https://bosch-diy.com/pl/pl/p/x')?.label, 'bosch-diy.com')
  assert.equal(importerFor('https://mistama.com/x.html')?.label, 'mistama.com')
  assert.equal(
    importerFor('https://www.bosch-professional.com/pl/pl/products/x')?.label,
    'bosch-professional.com',
  )
  // The two lines are separate sites and separate scripts; a host that merely
  // contains one of their names is neither.
  assert.equal(importerFor('https://bosch-diy.com.evil.example/x'), null)
  assert.equal(importerFor('https://allegro.pl/oferta/1'), null)
})
