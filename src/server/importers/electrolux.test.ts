import assert from 'node:assert/strict'
import test from 'node:test'

import {
  categoryOf,
  component,
  manualsOf,
  notesOf,
  parseElectroluxProduct,
  photosOf,
  sourceUrlOf,
  specifications,
} from './electrolux'
import { fitToCard, IMPORT_SOURCES, importerFor } from './index'

const PAGE_URL =
  'https://www.electrolux.pl/laundry/laundry/washing-machines/front-loader-washing-machine/ew7f3482p/?utm_source=x'

const IMAGES = 'https://www.electrolux.pl/services/eml/transform/WS_PN'

// The maker's shape: a Product with the identity, and the framework's payload
// with the spec sheet, the documents and the benefit tiles, as components
// found by name.
function page(
  options: {
    breadcrumb?: string
    components?: unknown[]
    product?: Record<string, unknown>
    withPayload?: boolean
  } = {},
) {
  const product = {
    '@context': 'http://schema.org/',
    '@type': 'Product',
    brand: { '@type': 'Brand', name: 'Electrolux' },
    category: 'Pralka ładowana od frontu',
    description: 'Pralka ładowana od frontu SteamCare z funkcją TimeManager, pojemność 8 kg.',
    gtin: '7333394041117',
    image: [`${IMAGES}/122dfe51/2024955760-eps`, `${IMAGES}/670911bf/2024957896-eps`],
    mpn: '914933001',
    name: 'Pralka SteamCare 700 AbsoluteCare 8 kg',
    sku: 'EW7F3482P',
    ...options.product,
  }

  const components = options.components ?? [
    { name: 'Header', props: {}, components: [] },
    {
      name: 'PDPContainer',
      props: { productCode: '914933001' },
      components: [
        {
          name: 'TechnicalSpecifications',
          props: {},
          components: [
            {
              name: 'DocumentsContent',
              props: {
                document: {
                  heading: 'Dokumenty związane z produktem',
                  documents: [
                    {
                      name: 'karta katalogowa produktu',
                      url: 'Https://productinformation.electrolux.com/x/GetDatasheetPDF/productid=1',
                      mediaFormat: 'PDF',
                    },
                    {
                      name: 'instrukcja obsługi',
                      url: 'https://electrolux.bynder.com/asset/42925056/250427F8ET-pdf.pdf',
                      mediaFormat: 'PDF',
                    },
                    {
                      name: 'etykieta energetyczna',
                      url: 'https://support.electroluxgroup.eu/x/eLabel/latest/PDF',
                      mediaFormat: 'PDF',
                    },
                    {
                      name: 'karta informacyjna UE',
                      url: 'https://support.electroluxgroup.eu/x/Combined/latest/PDF/PL',
                      mediaFormat: 'PDF',
                    },
                    {
                      name: 'instrukcja instalacji PDF',
                      url: 'https://electrolux.bynder.com/asset/0eb672a8/cca24a27-pdf.pdf',
                      mediaFormat: 'PDF',
                    },
                    {
                      name: 'instrukcja obsługi',
                      url: 'https://electrolux.bynder.com/asset/42925056/250427F8ET-pdf.pdf',
                      mediaFormat: 'PDF',
                    },
                    {
                      name: 'film',
                      url: 'https://electrolux.bynder.com/asset/1/x.mp4',
                      mediaFormat: 'MP4',
                    },
                  ],
                },
              },
            },
            {
              name: 'FullSpecification',
              props: {
                label: 'Pełne dane techniczne',
                pncTitle: 'Kod produktu (PNC)',
                attributes: [
                  {
                    label: 'Funkcje',
                    items: [
                      { label: 'Maksymalna prędkość wirowania: 1400 obr./min', infoText: '' },
                      { label: 'Maksymalny wsad: 8 kg', infoText: '' },
                      { label: 'System płukania zapobiegający powstawaniu piany', infoText: '' },
                    ],
                  },
                  {
                    label: 'Specyfikacja',
                    items: [
                      { label: 'Maks. pojemność prania (UE 2017/1369) [kg]', infoText: '8.0' },
                      { label: 'Czas trwania cyklu Eco 40-60 [godz.:min.]', infoText: '3:35' },
                      { label: 'Poziom hałasu (UE 2017/1369) [dB(A)] ', infoText: '74' },
                      { label: 'Kolor', infoText: 'biel' },
                    ],
                  },
                ],
              },
            },
          ],
        },
        {
          name: 'ProductBenefits',
          props: {},
          components: [
            {
              name: 'BenefitWithoutImage',
              props: {
                heading: 'SteamRefresh odświeża za pomocą pary, oszczędzając do 96% wody*',
                body: '<p>…</p>',
              },
            },
            {
              name: 'BenefitWithImage',
              props: { heading: 'Bęben Care Drum łagodny dla tkanin', body: '<p>…</p>' },
            },
          ],
        },
      ],
    },
  ]

  const payload = { props: { pageProps: { pageData: { id: 1, name: 'PDPPage', components } } } }

  const breadcrumb =
    options.breadcrumb ??
    `<ol class="_breadcrumb_pba9p_1 appliance-breadcrumb container-fluid">
      <li itemProp="itemListElement"><a href="/"><span class="_breadcrumb-item__name" itemProp="name">Urządzenia AGD</span></a></li>
      <li itemProp="itemListElement"><a href="/laundry/"><span itemProp="name">Pranie i suszenie</span></a></li>
      <li itemProp="itemListElement"><a href="/laundry/x/"><span itemProp="name">Pralka ładowana od frontu</span></a></li>
    </ol>`

  return `
    <html><head>
    <meta property="og:url" content="https://www.electrolux.pl/laundry/laundry/washing-machines/front-loader-washing-machine/ew7f3482p/"/>
    <script type="application/ld+json">${JSON.stringify(product)}</script>
    </head><body>
    ${breadcrumb}
    <h1>Pralka SteamCare 700 AbsoluteCare 8 kg</h1>
    ${options.withPayload === false ? '' : `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script>`}
    </body></html>
  `
}

test('the registry knows electrolux.pl, with and without www, and that it has documents', () => {
  assert.equal(importerFor(PAGE_URL)?.label, 'electrolux.pl')
  assert.equal(importerFor('https://electrolux.pl/x/ew7f3482p/')?.label, 'electrolux.pl')
  assert.ok(IMPORT_SOURCES.some((source) => source.host === 'electrolux.pl' && source.manuals))
})

test('reads a washing machine into an appliance card', () => {
  const product = parseElectroluxProduct(page(), PAGE_URL)
  assert.ok(product)

  assert.equal(product.kind, 'appliance')
  assert.equal(product.brand, 'Electrolux')
  assert.equal(product.name, 'Pralka SteamCare 700 AbsoluteCare 8 kg')
  assert.equal(product.model, 'EW7F3482P')
  assert.equal(product.category, 'Pralka ładowana od frontu')
  assert.equal(
    product.sourceUrl,
    'https://www.electrolux.pl/laundry/laundry/washing-machines/front-loader-washing-machine/ew7f3482p/',
  )
  assert.deepEqual(product.photoUrls, [
    `${IMAGES}/122dfe51/2024955760-eps`,
    `${IMAGES}/670911bf/2024957896-eps`,
  ])
  assert.deepEqual(product.attributes, [
    { name: 'Maksymalna prędkość wirowania', value: '1400 obr./min' },
    { name: 'Maksymalny wsad', value: '8 kg' },
    { name: 'Maks. pojemność prania (UE 2017/1369)', value: '8.0 kg' },
    { name: 'Czas trwania cyklu Eco 40-60 [godz.:min.]', value: '3:35' },
    { name: 'Poziom hałasu (UE 2017/1369)', value: '74 dB(A)' },
    { name: 'Kolor', value: 'biel' },
    { name: 'Kod produktu (PNC)', value: '914933001' },
    { name: 'Kod EAN', value: '7333394041117' },
  ])
  assert.equal(
    product.notes,
    'Pralka ładowana od frontu SteamCare z funkcją TimeManager, pojemność 8 kg. System płukania zapobiegający powstawaniu piany. SteamRefresh odświeża za pomocą pary, oszczędzając do 96% wody. Bęben Care Drum łagodny dla tkanin.',
  )
  assert.deepEqual(product.manuals, [
    {
      title: 'Karta katalogowa produktu',
      url: 'https://productinformation.electrolux.com/x/GetDatasheetPDF/productid=1',
    },
    {
      title: 'Instrukcja obsługi',
      url: 'https://electrolux.bynder.com/asset/42925056/250427F8ET-pdf.pdf',
    },
    {
      title: 'Instrukcja instalacji',
      url: 'https://electrolux.bynder.com/asset/0eb672a8/cca24a27-pdf.pdf',
    },
  ])
})

test('a page without a Product, or with a nameless one, is not a product page', () => {
  assert.equal(parseElectroluxProduct('<html><body>Pralki</body></html>', PAGE_URL), null)
  assert.equal(parseElectroluxProduct(page({ product: { name: '' } }), PAGE_URL), null)
})

test('a page without the payload is still a card, with the identity and no sheet', () => {
  const product = parseElectroluxProduct(page({ withPayload: false }), PAGE_URL)
  assert.ok(product)
  assert.equal(product.model, 'EW7F3482P')
  assert.deepEqual(product.attributes, [
    { name: 'Kod produktu (PNC)', value: '914933001' },
    { name: 'Kod EAN', value: '7333394041117' },
  ])
  assert.deepEqual(product.manuals, [])
  assert.equal(
    product.notes,
    'Pralka ładowana od frontu SteamCare z funkcją TimeManager, pojemność 8 kg.',
  )
})

test('a component is found by name wherever it sits, and its absence is null', () => {
  const tree = {
    components: [{ name: 'A', props: { a: 1 }, components: [{ name: 'B', props: { b: 2 } }] }],
  }
  assert.deepEqual(component(tree, 'B'), { b: 2 })
  assert.equal(component(tree, 'C'), null)
  assert.equal(component(null, 'A'), null)
})

test('the sheet splits a row written into its label, and keeps a row with no colon as a feature', () => {
  const sheet = specifications({
    attributes: [
      {
        label: 'Funkcje',
        items: [
          { label: 'Nóżki: 4 regulowane nóżki', infoText: '' },
          { label: 'Programy prania: bawełna, Eco 40-60, wełna/jedwab', infoText: '' },
          { label: 'Specjalny program do jedwabiu ', infoText: '' },
        ],
      },
      { label: 'Instalacja', items: [{ label: 'Długość przewodu [m]', infoText: '1,8' }] },
    ],
  })
  assert.deepEqual(sheet.attributes, [
    { name: 'Nóżki', value: '4 regulowane nóżki' },
    { name: 'Programy prania', value: 'bawełna, Eco 40-60, wełna/jedwab' },
    { name: 'Długość przewodu', value: '1,8 m' },
  ])
  assert.deepEqual(sheet.features, ['Specjalny program do jedwabiu'])
  assert.deepEqual(specifications(null), { attributes: [], features: [] })
})

test('the notes are the description, the features and the benefits, once each and as sentences', () => {
  assert.equal(
    notesOf(
      { description: 'Pralka 8 kg.' },
      ['Bęben Care Drum', 'Pralka 8 kg.'],
      ['Odśwież ubrania parą', 'Bęben Care Drum'],
    ),
    'Pralka 8 kg. Bęben Care Drum. Odśwież ubrania parą.',
  )
  assert.equal(notesOf({}, [], []), '')
})

test('the category falls back to the last crumb when the Product has none', () => {
  const product = parseElectroluxProduct(page({ product: { category: undefined } }), PAGE_URL)
  assert.equal(product?.category, 'Pralka ładowana od frontu')
  assert.equal(categoryOf('<html></html>'), '')
})

test('the documents lose the paperwork and the repeats, and get their capital and a lower-case scheme', () => {
  assert.deepEqual(
    manualsOf({
      document: {
        documents: [
          { name: 'instrukcja obsługi', url: 'HTTPS://a.example/m.pdf', mediaFormat: 'PDF' },
          { name: 'instrukcja obsługi', url: 'https://a.example/m.pdf', mediaFormat: 'PDF' },
          { name: 'etykieta energetyczna', url: 'https://a.example/e.pdf', mediaFormat: 'PDF' },
          { name: 'szybki przewodnik', url: 'http://a.example/q.pdf', mediaFormat: 'PDF' },
          { name: 'szybki przewodnik', url: 'javascript:alert(1)', mediaFormat: 'PDF' },
        ],
      },
    }),
    [{ title: 'Instrukcja obsługi', url: 'https://a.example/m.pdf' }],
  )
  assert.deepEqual(manualsOf(null), [])
  assert.deepEqual(manualsOf({ document: {} }), [])
})

test('the gallery keeps order and drops repeats and non-addresses', () => {
  assert.deepEqual(photosOf({ image: ['https://a/1', 'https://a/1', 'x', 7, 'https://a/2'] }), [
    'https://a/1',
    'https://a/2',
  ])
  assert.deepEqual(photosOf({ image: 'https://a/1' }), ['https://a/1'])
  assert.deepEqual(photosOf({}), [])
})

test("the source is the page's canonical address, else what was pasted", () => {
  assert.equal(
    sourceUrlOf(page(), PAGE_URL),
    'https://www.electrolux.pl/laundry/laundry/washing-machines/front-loader-washing-machine/ew7f3482p/',
  )
  assert.equal(
    sourceUrlOf(
      '<meta property="og:url" content="https://elsewhere.example/" />',
      'https://www.electrolux.pl/x/',
    ),
    'https://www.electrolux.pl/x/',
  )
  assert.equal(
    sourceUrlOf('<html></html>', 'https://www.electrolux.pl/x/'),
    'https://www.electrolux.pl/x/',
  )
})

test('fitToCard leaves a page this size alone', () => {
  const product = parseElectroluxProduct(page(), PAGE_URL)
  assert.ok(product)
  assert.deepEqual(fitToCard(product), product)
})
