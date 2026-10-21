import assert from 'node:assert/strict'
import test from 'node:test'

import { fitToCard, IMPORT_SOURCES, importerFor } from './index'
import {
  kindOf,
  modelOf,
  notesOf,
  parseXkomProduct,
  photosOf,
  productState,
  sourceUrlOf,
  specifications,
} from './x-kom'

const PAGE_URL =
  'https://www.x-kom.pl/p/437619-telewizor-50-54-samsung-ue50nu7402.html#Specyfikacja'

const CDN = 'https://cdn.x-kom.pl/i/setup/images/prod/big'

// The shop's shape: a Product and a BreadcrumbList for the identity, and the
// page's state — one object assigned to a window property — for the rest.
function page(
  options: {
    crumbs?: string[]
    product?: Record<string, unknown>
    state?: null | Record<string, unknown>
  } = {},
) {
  const product = {
    '@context': 'http://schema.org/',
    '@type': 'Product',
    brand: { '@type': 'Thing', name: 'Samsung' },
    image: [`${CDN}/product-new-big,,2018/7/a_00.jpg`, `${CDN}/product-new-big,,2018/7/a_01.jpg`],
    mpn: 'UE50NU7402UXXH',
    name: 'Samsung UE50NU7402',
    productID: '437619',
    sku: '437619',
    ...options.product,
  }

  const crumbs = options.crumbs ?? ['TV i audio', 'Telewizory', 'Telewizory 50" - 54"']
  const breadcrumbs = {
    '@context': 'http://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((name, index) => ({
      '@type': 'ListItem',
      name,
      position: index + 1,
    })),
  }

  const record =
    options.state === undefined
      ? {
          features: [
            { key: 'Przekątna ekranu', id: '1', values: [{ name: '50"' }] },
            {
              key: 'Wbudowany tuner',
              id: '2',
              values: [{ name: 'DVB-S2' }, { name: 'DVB-T2' }, { name: '' }],
            },
            { key: 'Waga bez podstawy', id: '3', values: [{ name: '13,8 kg' }] },
            { key: 'Pusty', id: '4', values: [] },
          ],
          fullName: 'Samsung UE50NU7402',
          id: 437619,
          name: 'UE50NU7402',
          photos: [
            {
              url: `${CDN}/product-large,,2018/7/a_00.jpg`,
              urlTemplate: `${CDN}/{SIZE},,2018/7/a_00.jpg`,
            },
            {
              url: `${CDN}/product-large,,2018/7/a_01.jpg`,
              urlTemplate: `${CDN}/{SIZE},,2018/7/a_01.jpg`,
            },
            { url: `${CDN}/product-large,,2018/7/a_02.jpg` },
          ],
          producer: { id: '29', name: 'Samsung' },
          producerCode: 'UE50NU7402UXXH',
          productDescription:
            '<div class="content"><!-- Xkom_Only --><div class="contact-bar-wrapper"><h2>Skontaktuj się z naszymi ekspertami</h2><p>Wybierz nr <a href="tel:1">34 377 00 91</a>, a nasi specjaliści pomogą.</p></div><!-- Xkom_Only end --><h2 class="text-left"> Telewizor Ultra HD Samsung UE50NU7402</h2><p>Ciesz się ostrymi obrazami w telewizorze <b>Samsung</b> UHD 4K.</p><p>&nbsp;</p><h2>Moc kolorów</h2></div>',
        }
      : options.state

  const state =
    record === null
      ? ''
      : `<script>window.__ENV = {"a":"b"}; window.__INITIAL_STATE__ = window.__INITIAL_STATE__ || {}; window.__INITIAL_STATE__['app'] = ${JSON.stringify({ globalParameters: { shop_name: 'x-kom', quote: 'a "}" inside' }, products: { '437619': record } })};</script>`

  return `
    <html><head>
    <meta property="og:url" content="https://www.x-kom.pl/p/437619-telewizor-50-54-samsung-ue50nu7402.html"/>
    <script type="application/ld+json">${JSON.stringify(product)}</script>
    <script type="application/ld+json">${JSON.stringify(breadcrumbs)}</script>
    </head><body>
    <h1>Samsung UE50NU7402</h1>
    ${state}
    </body></html>
  `
}

test('the registry knows x-kom.pl, with and without www, and that it has no documents', () => {
  assert.equal(importerFor(PAGE_URL)?.label, 'x-kom.pl')
  assert.equal(importerFor('https://x-kom.pl/p/1-x.html')?.label, 'x-kom.pl')
  assert.ok(IMPORT_SOURCES.some((source) => source.host === 'x-kom.pl' && !source.manuals))
})

test('reads a television into an appliance card', () => {
  const product = parseXkomProduct(page(), PAGE_URL)
  assert.ok(product)

  assert.equal(product.kind, 'appliance')
  assert.equal(product.brand, 'Samsung')
  assert.equal(product.name, 'Samsung UE50NU7402')
  assert.equal(product.model, 'UE50NU7402')
  assert.equal(product.category, 'Telewizory 50" - 54"')
  assert.deepEqual(product.manuals, [])
  assert.equal(
    product.sourceUrl,
    'https://www.x-kom.pl/p/437619-telewizor-50-54-samsung-ue50nu7402.html',
  )
  assert.deepEqual(product.photoUrls, [
    `${CDN}/product-original,,2018/7/a_00.jpg`,
    `${CDN}/product-original,,2018/7/a_01.jpg`,
    `${CDN}/product-large,,2018/7/a_02.jpg`,
  ])
  assert.deepEqual(product.attributes, [
    { name: 'Przekątna ekranu', value: '50"' },
    { name: 'Wbudowany tuner', value: 'DVB-S2, DVB-T2' },
    { name: 'Waga bez podstawy', value: '13,8 kg' },
    { name: 'Kod producenta', value: 'UE50NU7402UXXH' },
  ])
  assert.equal(
    product.notes,
    'Telewizor Ultra HD Samsung UE50NU7402. Ciesz się ostrymi obrazami w telewizorze Samsung UHD 4K. Moc kolorów.',
  )
})

test('a page without a Product, or with a nameless one, is not a product page', () => {
  assert.equal(parseXkomProduct('<html><body>Telewizory</body></html>', PAGE_URL), null)
  assert.equal(parseXkomProduct(page({ product: { name: '' } }), PAGE_URL), null)
})

test('a page without the state is still a card, off the Product alone', () => {
  const product = parseXkomProduct(page({ state: null }), PAGE_URL)
  assert.ok(product)
  assert.equal(product.model, 'UE50NU7402')
  assert.deepEqual(product.attributes, [{ name: 'Kod producenta', value: 'UE50NU7402UXXH' }])
  assert.deepEqual(product.photoUrls, [
    `${CDN}/product-new-big,,2018/7/a_00.jpg`,
    `${CDN}/product-new-big,,2018/7/a_01.jpg`,
  ])
  assert.equal(product.notes, '')
})

test('the state is cut out by its braces, a brace inside a string included, and read under the product number', () => {
  assert.equal(productState(page(), '437619')?.name, 'UE50NU7402')
  assert.equal(productState(page(), '1'), null)
  assert.equal(productState(page(), ''), null)
  assert.equal(
    productState('<script>window.__INITIAL_STATE__[\'app\'] = {"products":{"1":</script>', '1'),
    null,
  )
  assert.equal(productState('<html></html>', '437619'), null)
})

test("the model is the shop's own, else the full name without the maker", () => {
  assert.equal(modelOf({ name: 'UE50NU7402' }, 'Samsung UE50NU7402', 'Samsung'), 'UE50NU7402')
  assert.equal(modelOf(null, 'Samsung UE50NU7402', 'Samsung'), 'UE50NU7402')
  assert.equal(modelOf(null, 'Samsung UE50NU7402', 'LG'), 'Samsung UE50NU7402')
  assert.equal(modelOf(null, 'Samsung UE50NU7402', ''), 'Samsung UE50NU7402')
})

test('the sheet joins several values into one and skips a row with none', () => {
  assert.deepEqual(
    specifications({
      features: [
        { key: 'Aplikacje', values: [{ name: 'Netflix' }, { name: 'YouTube' }] },
        { key: 'Nic', values: [] },
        { values: [{ name: 'x' }] },
      ],
    }),
    [{ name: 'Aplikacje', value: 'Netflix, YouTube' }],
  )
  assert.deepEqual(specifications(null), [])
})

test('the kind is an appliance unless the shelf is the tools', () => {
  assert.equal(kindOf(['TV i audio', 'Telewizory']), 'appliance')
  assert.equal(kindOf(['Akcesoria', 'Narzędzia serwisowe i sieciowe']), 'tool')
  assert.equal(kindOf([]), 'appliance')
})

test('the notes lose the sales box and keep the rest as sentences', () => {
  assert.equal(
    notesOf({
      productDescription:
        '<!-- Xkom_Only --><p>Zadzwoń.</p><!-- Xkom_Only end --><h2>Obraz</h2><p>Jest <b>ostry</b> , naprawdę.</p>',
    }),
    'Obraz. Jest ostry, naprawdę.',
  )
  assert.equal(notesOf({}), '')
  assert.equal(notesOf(null), '')
})

test("the gallery takes the largest size off the template, and the Product's list without it", () => {
  assert.deepEqual(
    photosOf(
      {
        photos: [
          { urlTemplate: `${CDN}/{SIZE},,a.jpg` },
          { url: `${CDN}/product-large,,b.jpg` },
          { url: 'x' },
        ],
      },
      {},
    ),
    [`${CDN}/product-original,,a.jpg`, `${CDN}/product-large,,b.jpg`],
  )
  assert.deepEqual(photosOf(null, { image: 'https://a/1.jpg' }), ['https://a/1.jpg'])
  assert.deepEqual(photosOf({ photos: [] }, {}), [])
})

test("the source is the page's own address without the tab, else what was pasted without its hash", () => {
  assert.equal(
    sourceUrlOf(page(), PAGE_URL),
    'https://www.x-kom.pl/p/437619-telewizor-50-54-samsung-ue50nu7402.html',
  )
  assert.equal(
    sourceUrlOf(
      '<meta property="og:url" content="https://www.x-kom.pl/g/8-tv.html" />',
      'https://www.x-kom.pl/p/1-x.html#Opis',
    ),
    'https://www.x-kom.pl/p/1-x.html',
  )
})

test('fitToCard leaves a page this size alone', () => {
  const product = parseXkomProduct(page(), PAGE_URL)
  assert.ok(product)
  assert.deepEqual(fitToCard(product), product)
})
