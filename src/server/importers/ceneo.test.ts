import assert from 'node:assert/strict'
import test from 'node:test'

import {
  categoryPath,
  kindOf,
  modelOf,
  notesOf,
  parseCeneoProduct,
  photosOf,
  sourceUrlOf,
  specifications,
} from './ceneo'
import { fitToCard, IMPORT_SOURCES, importerFor } from './index'

const PAGE_URL = 'https://www.ceneo.pl/79216673#tab=spec'

const IMAGES = 'https://image.ceneostatic.pl/data/products/79216673'

// The site's shape: a Product for the name, the maker and the gallery, the
// category path in the head, and a spec table of groups with a hint hanging
// off some of the names.
function page(
  options: {
    category?: null | string
    description?: string
    product?: Record<string, unknown>
    rows?: string
  } = {},
) {
  const product = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    brand: { '@type': 'Brand', name: 'Philips' },
    description: 'Co wyróżnia ekspres Philips 2200 LatteGo? System LatteGo z wysoką...',
    image: [
      `${IMAGES}/i-ekspres-philips-2200-lattego-ep2231-40-czarny.jpg`,
      `${IMAGES}/5c97c07d_i-ekspres-philips-2200-lattego-ep2231-40-czarny.jpg`,
    ],
    name: 'Ekspres PHILIPS 2200 LatteGo EP2231/40 czarny',
    sku: '79216673',
    ...options.product,
  }

  const category =
    options.category === undefined
      ? 'Sprzęt AGD > Małe AGD do kuchni > Ekspresy do kawy > Ekspresy ciśnieniowe'
      : options.category

  const rows =
    options.rows ??
    `
      <tr class="product-spec__group__attributes__row">
        <td class="product-spec__group__attributes__row__name"> Marka </td>
        <td class="product-spec__group__attributes__row__value"> <a href="/p:Philips.htm">Philips</a> </td>
      </tr>
      <tr class="product-spec__group__attributes__row">
        <td class="product-spec__group__attributes__row__name"> Model </td>
        <td class="product-spec__group__attributes__row__value"> LatteGO </td>
      </tr>
      <tr class="product-spec__group__attributes__row">
        <td class="product-spec__group__attributes__row__name">
          Moc <span class="hint-handle js_productTechSpecsSyncTip" data-tiptitle="Moc">?<span class="hidden js_context-datahint">Moc ekspresu do kawy jest zasadniczym parametrem.</span></span>
        </td>
        <td class="product-spec__group__attributes__row__value"> 230W </td>
      </tr>
      <tr class="product-spec__group__attributes__row">
        <td class="product-spec__group__attributes__row__name"> Liczba bieg&#243;w </td>
        <td class="product-spec__group__attributes__row__value"> 2 </td>
      </tr>
    `

  const description =
    options.description ??
    `
      <div class="product-full-description js_product-full-description" data-max-height="700">
        <article>
          <h2>Co wyróżnia ekspres Philips 2200 <b>LatteGo</b>?</h2>
          <h3>Szybkie czyszczenie</h3>
          <p>System LatteGo składa się tylko z dwóch części.</p>
          <ul><li>Mycie w zmywarce</li></ul>
        </article>
      </div>
      <div class="js_article-desc-end"></div>
    `

  return `
    <html><head>
    <meta property="og:url" content="https://www.ceneo.pl/79216673" />
    ${category === null ? '' : `<meta property="product:category" content="${category}" />`}
    <meta property="product:brand" content="Philips" />
    <script type="application/ld+json">${JSON.stringify(product)}</script>
    </head><body>
    <nav class="js_breadcrumbs breadcrumbs">
      <div><a href="/"><span itemprop="name">Ceneo</span></a></div>
      <div><a href="/Sprzet_AGD"><span itemprop="name">Sprzęt AGD</span></a></div>
      <div><a href="/Ekspresy_cisnieniowe"><span itemprop="name">Ekspresy ciśnieniowe</span></a></div>
      <div><a href="/Ekspresy_cisnieniowe;0234"><span itemprop="name">Automatyczne</span></a></div>
    </nav>
    <section id="productTechSpecs" class="product-spec">
      <table class="product-spec__group__attributes">
        <tbody class="product-spec__group">
          <tr><th class="product-spec__group__header" colspan="2"><h3>Podstawowe informacje</h3></th></tr>
          ${rows}
          <tr><td colspan="2"><div class="text-center link--accent"></div></td></tr>
        </tbody>
      </table>
    </section>
    ${description}
    </body></html>
  `
}

test('the registry knows ceneo.pl, with and without www', () => {
  assert.equal(importerFor(PAGE_URL)?.label, 'ceneo.pl')
  assert.equal(importerFor('https://ceneo.pl/76832205')?.label, 'ceneo.pl')
  assert.ok(IMPORT_SOURCES.some((source) => source.host === 'ceneo.pl' && !source.manuals))
})

test('reads a coffee machine into an appliance card', () => {
  const product = parseCeneoProduct(page(), PAGE_URL)
  assert.ok(product)

  assert.equal(product.name, 'Ekspres PHILIPS 2200 LatteGo EP2231/40 czarny')
  assert.equal(product.brand, 'Philips')
  assert.equal(product.kind, 'appliance')
  assert.equal(product.category, 'Ekspresy ciśnieniowe')
  assert.equal(product.model, 'EP2231/40')
  assert.deepEqual(product.manuals, [])
  assert.equal(product.sourceUrl, 'https://www.ceneo.pl/79216673')
  assert.deepEqual(product.photoUrls, [
    `${IMAGES}/i-ekspres-philips-2200-lattego-ep2231-40-czarny.jpg`,
    `${IMAGES}/5c97c07d_i-ekspres-philips-2200-lattego-ep2231-40-czarny.jpg`,
  ])
})

test('a page without a Product, or with a nameless one, is not a product page', () => {
  assert.equal(parseCeneoProduct('<html><body>Kategoria</body></html>', PAGE_URL), null)
  assert.equal(parseCeneoProduct(page({ product: { name: '' } }), PAGE_URL), null)
})

test('the spec rows lose their hints and their entities, and the maker is not a parameter', () => {
  const product = parseCeneoProduct(page(), PAGE_URL)
  assert.ok(product)

  assert.deepEqual(product.attributes, [
    { name: 'Model', value: 'LatteGO' },
    { name: 'Moc', value: '230W' },
    { name: 'Liczba biegów', value: '2' },
  ])
})

test('specifications reads every row as written, hints aside', () => {
  assert.deepEqual(specifications(page()), [
    { name: 'Marka', value: 'Philips' },
    { name: 'Model', value: 'LatteGO' },
    { name: 'Moc', value: '230W' },
    { name: 'Liczba biegów', value: '2' },
  ])
  assert.deepEqual(specifications('<html></html>'), [])
})

test('the model is the stated one when it has a number, else the run in the name', () => {
  assert.equal(modelOf('DeWalt DCD796P1', [{ name: 'Model', value: 'DCD796P1' }]), 'DCD796P1')
  assert.equal(
    modelOf('Bosch GSB 18V-55 Professional', [{ name: 'Model', value: 'GSB 18V-55' }]),
    'GSB 18V-55',
  )
  assert.equal(
    modelOf('Ekspres PHILIPS 2200 LatteGo EP2231/40 czarny', [{ name: 'Model', value: 'LatteGO' }]),
    'EP2231/40',
  )
  // A wattage and a voltage have letters and digits too, and neither is a model.
  assert.equal(modelOf('Czajnik Bosch TWK3A011 2400W', []), 'TWK3A011')
  assert.equal(modelOf('Pralka Samsung 8kg', []), '')
})

test("the stated model stays a parameter only when it is not the card's model", () => {
  const stated = parseCeneoProduct(
    page({
      product: { name: 'DeWalt DCD796P1' },
      rows: `
        <tr class="product-spec__group__attributes__row"><td class="n"> Model </td><td class="v"> DCD796P1 </td></tr>
        <tr class="product-spec__group__attributes__row"><td class="n"> Napięcie </td><td class="v"> 18 V </td></tr>
      `,
    }),
    PAGE_URL,
  )
  assert.ok(stated)
  assert.equal(stated.model, 'DCD796P1')
  assert.deepEqual(stated.attributes, [{ name: 'Napięcie', value: '18 V' }])
})

test('the category path comes from the head, and from the breadcrumb without it', () => {
  assert.deepEqual(categoryPath(page()), [
    'Sprzęt AGD',
    'Małe AGD do kuchni',
    'Ekspresy do kawy',
    'Ekspresy ciśnieniowe',
  ])
  // The breadcrumb goes one step further, to a filter, and drops the site.
  assert.deepEqual(categoryPath(page({ category: null })), [
    'Sprzęt AGD',
    'Ekspresy ciśnieniowe',
    'Automatyczne',
  ])
  assert.deepEqual(categoryPath('<html></html>'), [])
})

test('the kind is read off where the site files the page', () => {
  assert.equal(kindOf(['Sprzęt AGD', 'AGD wolnostojące', 'Pralki']), 'appliance')
  assert.equal(kindOf(['RTV', 'Telewizory']), 'appliance')
  assert.equal(
    kindOf(['Budowa i remont', 'Narzędzia i warsztat', 'Elektronarzędzia', 'Wiertarko-wkrętarki']),
    'tool',
  )
  assert.equal(kindOf(['Dom i ogród', 'Ogród', 'Kosiarki']), 'tool')
  assert.equal(kindOf(['Budowa i remont', 'Narzędzia i warsztat', 'Skrzynki narzędziowe']), 'case')
  assert.equal(kindOf([]), 'appliance')
})

test('a drill page becomes a tool card with the drill filed under its own category', () => {
  const product = parseCeneoProduct(
    page({
      category: 'Budowa i remont > Narzędzia i warsztat > Elektronarzędzia > Wiertarko-wkrętarki',
      product: { brand: { '@type': 'Brand', name: 'DeWalt' }, name: 'DeWalt DCD796P1' },
    }),
    'https://www.ceneo.pl/76832205',
  )
  assert.ok(product)
  assert.equal(product.kind, 'tool')
  assert.equal(product.category, 'Wiertarko-wkrętarki')
  assert.equal(product.brand, 'DeWalt')
})

test('the notes are the description block, one sentence per line', () => {
  assert.equal(
    notesOf(page(), {}),
    'Co wyróżnia ekspres Philips 2200 LatteGo? Szybkie czyszczenie. System LatteGo składa się tylko z dwóch części. Mycie w zmywarce.',
  )
})

test("without a description block the notes are the Product's copy, minus its ellipsis", () => {
  const product = {
    description: 'Co wyróżnia ekspres Philips 2200 LatteGo? System LatteGo z wysoką...',
  }
  assert.equal(
    notesOf(page({ description: '' }), product),
    'Co wyróżnia ekspres Philips 2200 LatteGo? System LatteGo z wysoką',
  )
  assert.equal(notesOf(page({ description: '' }), {}), '')
})

test('the brand falls back to the head when the Product has none', () => {
  const product = parseCeneoProduct(page({ product: { brand: undefined } }), PAGE_URL)
  assert.equal(product?.brand, 'Philips')
})

test('the gallery keeps order and drops repeats and non-addresses', () => {
  assert.deepEqual(
    photosOf({ image: ['https://a/1.jpg', 'https://a/1.jpg', 'x', 7, 'https://a/2.jpg'] }),
    ['https://a/1.jpg', 'https://a/2.jpg'],
  )
  assert.deepEqual(photosOf({ image: 'https://a/1.jpg' }), ['https://a/1.jpg'])
  assert.deepEqual(photosOf({}), [])
})

test("the source is the product's own address, whatever was pasted", () => {
  assert.equal(sourceUrlOf(page(), PAGE_URL), 'https://www.ceneo.pl/79216673')
  assert.equal(
    sourceUrlOf('<html></html>', 'https://www.ceneo.pl/79216673#tab=spec'),
    'https://www.ceneo.pl/79216673',
  )
  // A canonical address that is not a product's is not trusted over the pasted one.
  assert.equal(
    sourceUrlOf(
      '<meta property="og:url" content="https://www.ceneo.pl/Pralki" />',
      'https://www.ceneo.pl/1#x',
    ),
    'https://www.ceneo.pl/1',
  )
})

test('fitToCard leaves a page this size alone', () => {
  const product = parseCeneoProduct(page(), PAGE_URL)
  assert.ok(product)
  assert.deepEqual(fitToCard(product), product)
})
