import assert from 'node:assert/strict'
import test from 'node:test'

import {
  categoryOf,
  isHighlight,
  manualsOf,
  notesOf,
  parseBoschHomeProduct,
  photosOf,
  sourceUrlOf,
  specifications,
} from './bosch-home'
import { fitToCard, IMPORT_SOURCES, importerFor } from './index'

const PAGE_URL =
  'https://www.bosch-home.pl/pl/mkt-product/chlodzenie-i-zamrazanie/lodowki/KAD90VB20'

const MEDIA = 'https://media3.bsh-group.com'

// The maker's shape: a Product with the spec sheet inside it as properties
// with units, a BreadcrumbList beside it, and the documents in the
// framework's payload with their quotes escaped.
function page(
  options: {
    crumbs?: string[]
    documents?: null | Record<string, unknown>[]
    product?: Record<string, unknown>
    properties?: Record<string, unknown>[]
  } = {},
) {
  const product = {
    '@context': 'https://schema.org/',
    '@type': 'Product',
    '@id': 'https://www.bosch-home.pl/pl/mkt-product/KAD90VB20',
    additionalProperty: options.properties ?? [
      { '@type': 'PropertyValue', name: 'Dominujący kolor produktu', value: 'Czarny' },
      {
        '@type': 'PropertyValue',
        name: 'Wymiary urządzenia',
        unitText: 'mm',
        value: '1770x910x720',
      },
      { '@type': 'PropertyValue', name: 'Masa brutto (kg)', unitText: 'kg', value: '112.8' },
      {
        '@type': 'PropertyValue',
        name: 'Pojemność XXL: wnętrze gotowe na większe zapasy. Nareszcie miejsce absolutnie na wszystko!',
        value: 'Nasze lodówki Multi Door oferują obszerną przestrzeń do przechowywania.',
      },
      {
        '@type': 'PropertyValue',
        name: 'NoFrost: nigdy więcej rozmrażania zamrażarki',
        value: 'Cyrkulacja suchego zimnego powietrza.',
      },
    ],
    brand: { '@type': 'Brand', name: 'BOSCH' },
    description: 'Series 6 American side by side',
    gtin: '4242002919003',
    image: [
      `${MEDIA}/Product_Shots/MCSA01320894_G0025_KAD90VB20_836229_def.webp`,
      `${MEDIA}/Line_Drawings/MCZ_00766655_411024_KAG90AI20G_pl-PL.webp`,
    ],
    mpn: 'KAD90VB20',
    name: 'Series 6 American side by side 177 x 91 cm Black, Total No Frost',
    ...options.product,
  }

  const crumbs = options.crumbs ?? [
    'Home',
    'Produkty',
    'Chłodzenie i zamrażanie',
    'Lodówki',
    'KAD90VB20',
  ]
  const breadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((name, index) => ({
      '@type': 'ListItem',
      name,
      position: index + 1,
    })),
  }

  const documents =
    options.documents === undefined
      ? [
          { titleKey: 'user-manuals', type: 'IU', url: `${MEDIA}/Documents/9001000225_H.pdf` },
          {
            titleKey: 'installation-instruction',
            type: 'II',
            url: `${MEDIA}/Documents/9001000225_H.pdf`,
          },
          { titleKey: 'user-manuals', type: 'IU', url: `${MEDIA}/Documents/8001221580_C.pdf` },
          {
            titleKey: 'product-specification',
            type: 'x',
            url: `${MEDIA}/Documents/specsheet/pl-PL/KAD90VB20.pdf`,
          },
          {
            titleKey: 'energy-label',
            type: 'x',
            url: `${MEDIA}/Documents/energylabel/pl-PL/KAD90VB20.pdf`,
          },
          {
            titleKey: 'legal-collection',
            type: 'x',
            url: `${MEDIA}/Documents/legalcollection_KAD90VB20_pl-PL.pdf`,
          },
        ]
      : options.documents
  // The framework writes the payload as a JS string: JSON inside JSON.
  const payload =
    documents === null
      ? ''
      : `<script>self.__next_f.push([1,${JSON.stringify(
          `1a:["$","div",null,{"product":{"title":{"headline":"American side by side"},"technicalDocuments":${JSON.stringify(documents)},"pricing":null}}]`,
        )}])</script>`

  return `
    <html><head>
    <script type="application/ld+json">${JSON.stringify(breadcrumbs)}</script>
    <script type="application/ld+json">${JSON.stringify(product)}</script>
    </head><body>
    <h1>Produkt nie jest już dostępny</h1>
    ${payload}
    </body></html>
  `
}

test('the registry knows bosch-home.pl, with and without www, and that it has documents', () => {
  assert.equal(importerFor(PAGE_URL)?.label, 'bosch-home.pl')
  assert.equal(
    importerFor('https://bosch-home.pl/pl/mkt-product/KAD90VB20')?.label,
    'bosch-home.pl',
  )
  assert.ok(IMPORT_SOURCES.some((source) => source.host === 'bosch-home.pl' && source.manuals))
})

test('reads a fridge into an appliance card', () => {
  const product = parseBoschHomeProduct(page(), PAGE_URL)
  assert.ok(product)

  assert.equal(product.kind, 'appliance')
  assert.equal(product.brand, 'Bosch')
  assert.equal(product.name, 'Series 6 American side by side 177 x 91 cm Black, Total No Frost')
  assert.equal(product.model, 'KAD90VB20')
  assert.equal(product.category, 'Lodówki')
  assert.equal(product.sourceUrl, 'https://www.bosch-home.pl/pl/mkt-product/KAD90VB20')
  assert.deepEqual(product.photoUrls, [
    `${MEDIA}/Product_Shots/MCSA01320894_G0025_KAD90VB20_836229_def.webp`,
  ])
  assert.deepEqual(product.attributes, [
    { name: 'Dominujący kolor produktu', value: 'Czarny' },
    { name: 'Wymiary urządzenia', value: '1770x910x720 mm' },
    { name: 'Masa brutto', value: '112.8 kg' },
    { name: 'Kod EAN', value: '4242002919003' },
  ])
  assert.equal(
    product.notes,
    'Pojemność XXL: wnętrze gotowe na większe zapasy. Nareszcie miejsce absolutnie na wszystko! NoFrost: nigdy więcej rozmrażania zamrażarki.',
  )
})

test('a page without a Product, or with a nameless one, is not a product page', () => {
  assert.equal(parseBoschHomeProduct('<html><body>Produkty</body></html>', PAGE_URL), null)
  assert.equal(parseBoschHomeProduct(page({ product: { name: '' } }), PAGE_URL), null)
})

test('a headline is told from a parameter by its colon, or by its length', () => {
  assert.equal(isHighlight({ name: 'Masa netto' }), false)
  assert.equal(isHighlight({ name: 'Kolor / materiał obudowy' }), false)
  assert.equal(isHighlight({ name: 'NoFrost: nigdy więcej rozmrażania' }), true)
  assert.equal(isHighlight({ name: 'x'.repeat(81) }), true)
})

test('a unit joins the value and leaves a name that already said it', () => {
  assert.deepEqual(
    specifications([
      { name: 'Wymiary zapakowanego urządzenia (WxSxG) (mm)', unit: 'mm', value: '1880x970x780' },
      { name: 'Poziom hałasu', unit: 'dB(A) re 1pW', value: '36' },
      { name: 'Total No Frost', unit: '', value: 'Tak' },
    ]),
    [
      { name: 'Wymiary zapakowanego urządzenia (WxSxG)', value: '1880x970x780 mm' },
      { name: 'Poziom hałasu', value: '36 dB(A) re 1pW' },
      { name: 'Total No Frost', value: 'Tak' },
    ],
  )
})

test('the notes are the headlines, each ending a sentence', () => {
  assert.equal(
    notesOf([
      { name: 'Masa netto', unit: 'kg', value: '103.6' },
      { name: 'LED: idealne oświetlenie.', unit: '', value: 'Dzięki oświetleniu LED…' },
      { name: 'Alarm: przypomina o drzwiach', unit: '', value: 'Dźwięk ostrzegawczy…' },
    ]),
    'LED: idealne oświetlenie. Alarm: przypomina o drzwiach.',
  )
  assert.equal(notesOf([]), '')
})

test('the category is the last crumb before the model, else the description without its series', () => {
  const product = { description: 'Series 6 American side by side', mpn: 'KAD90VB20' }
  const list = (names: string[]) => ({
    '@type': 'BreadcrumbList',
    itemListElement: names.map((name) => ({ name })),
  })

  assert.equal(
    categoryOf([list(['Home', 'Produkty', 'Zamrażarki', 'Zamrażarka do zabudowy', 'GIV11AFE0'])], {
      description: 'Serie 4 Zamrażarka do zabudowy',
      mpn: 'GIV11AFE0',
    }),
    'Zamrażarka do zabudowy',
  )
  // A machine no longer sold is filed under nothing.
  assert.equal(
    categoryOf([list(['Home', 'Produkty', 'KAD90VB20'])], product),
    'American side by side',
  )
  assert.equal(
    categoryOf([], { description: 'Serie 4 Odkurzacz bezprzewodowy Flexxo 21.6V' }),
    'Odkurzacz bezprzewodowy Flexxo 21.6V',
  )
  assert.equal(categoryOf([], {}), '')
})

test('the gallery is the product shots, without the line drawings, in order and once', () => {
  assert.deepEqual(
    photosOf({
      image: [
        `${MEDIA}/Product_Shots/a.webp`,
        `${MEDIA}/Line_Drawings/b.webp`,
        `${MEDIA}/Product_Shots/a.webp`,
        `${MEDIA}/Product_Shots/c.webp`,
        'x',
      ],
    }),
    [`${MEDIA}/Product_Shots/a.webp`, `${MEDIA}/Product_Shots/c.webp`],
  )
  assert.deepEqual(photosOf({ image: `${MEDIA}/Product_Shots/a.webp` }), [
    `${MEDIA}/Product_Shots/a.webp`,
  ])
  assert.deepEqual(photosOf({}), [])
})

test('the documents come out of the payload, once per file, titled in Polish', () => {
  assert.deepEqual(manualsOf(page()), [
    { title: 'Instrukcja obsługi', url: `${MEDIA}/Documents/9001000225_H.pdf` },
    { title: 'Instrukcja obsługi (8001221580_C)', url: `${MEDIA}/Documents/8001221580_C.pdf` },
    { title: 'Karta produktu', url: `${MEDIA}/Documents/specsheet/pl-PL/KAD90VB20.pdf` },
  ])
})

test('a page without the payload, or with a damaged one, has no documents', () => {
  assert.deepEqual(manualsOf(page({ documents: null })), [])
  assert.deepEqual(
    manualsOf('<script>x = "\\"technicalDocuments\\":[{\\"titleKey\\":"</script>'),
    [],
  )
  assert.deepEqual(
    manualsOf(page({ documents: [{ titleKey: 'user-manuals', url: 'javascript:alert(1)' }] })),
    [],
  )
})

test("the source is the Product's own address, else what was pasted", () => {
  assert.equal(
    sourceUrlOf({ '@id': 'https://www.bosch-home.pl/pl/mkt-product/KAD90VB20' }, PAGE_URL),
    'https://www.bosch-home.pl/pl/mkt-product/KAD90VB20',
  )
  assert.equal(sourceUrlOf({ '@id': 'https://elsewhere.example/x' }, PAGE_URL), PAGE_URL)
  assert.equal(sourceUrlOf({}, PAGE_URL), PAGE_URL)
})

test('fitToCard keeps a dimension triple: a value that is not one number is not a measurement it can judge', () => {
  const product = parseBoschHomeProduct(page(), PAGE_URL)
  assert.ok(product)
  assert.deepEqual(fitToCard(product), product)
})
