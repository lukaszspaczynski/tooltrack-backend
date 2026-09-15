import assert from 'node:assert/strict'
import test from 'node:test'

import { fitToCard, importerFor } from './index'
import { mergeDuplicates } from './attributes'
import { modelOf, parseMistamaProduct, specifications } from './mistama'

const PAGE_URL = 'https://mistama.com/podkaszarka-akumulatorowa-easygrasscut-18v-bosch-korpus.html'

// The shapes the shop's own pages have, kept small enough to argue with: the
// JSON-LD graph the fields come from, and the spec list that is scraped.
function page(options: { crumbs?: string[]; product?: Record<string, unknown>; specs?: string }) {
  const graph = [
    { '@type': 'Organization', name: 'MISTAMA.COM' },
    {
      '@type': 'BreadcrumbList',
      itemListElement: (
        options.crumbs ?? [
          'Strona główna',
          'BOSCH OGRÓD',
          'Podkaszarki',
          'Podkaszarki akumulatorowe',
          'Seria 18V',
          'Podkaszarka akumulatorowa 26 cm EASYGRASSCUT 18V-26 BOSCH (korpus)',
        ]
      ).map((name, index) => ({ '@type': 'ListItem', name, position: index + 1 })),
    },
    {
      '@type': 'Product',
      brand: { '@type': 'Brand', name: 'BOSCH' },
      category: 'Seria 18V',
      description: 'Akumulatorowa podkaszarka żyłkowa EASYGRASSCUT 18 BOSCH (korpus)',
      gtin13: '3165140973380',
      image: [
        'https://mistama.com/media/products/4d33/images/thumbnail/large_miniatura.jpg?lm=1748441230',
        'https://mistama.com/media/products/4d33/images/thumbnail/large_IMG-4380.jpg?lm=1772114980',
      ],
      name: 'Podkaszarka akumulatorowa 26 cm EASYGRASSCUT 18V-26 BOSCH (korpus)',
      sku: '06008C1C04',
      ...options.product,
    },
  ]

  return `
    <html><head>
    <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>
    </head><body>
    <h2 class="seo-title">Opis produktu</h2>
    <div class="seo-content"><p>Marketing.</p></div>
    <h2 class="seo-title">Parametry techniczne</h2>
    <div class="seo-content"><ul>
    ${options.specs ?? '<li>Napięcie akumulatora&nbsp;<strong>18 V</strong></li>'}
    </ul></div>
    <h2 class="seo-title">Dostawa zawiera</h2>
    <div class="seo-content"><ul><li>Podkaszarkę</li><li>Szpulę z żyłką</li></ul></div>
    </body></html>
  `
}

test('a product page becomes a card', () => {
  const product = parseMistamaProduct(page({}), PAGE_URL)

  assert.ok(product)
  assert.equal(product.name, 'Podkaszarka akumulatorowa 26 cm EASYGRASSCUT 18V-26 BOSCH (korpus)')
  assert.equal(product.sourceUrl, PAGE_URL)
  assert.match(product.notes, /^Akumulatorowa podkaszarka/)
})

test('a page that sells nothing is refused rather than half-read', () => {
  // A card of empty fields is worse than a refusal: somebody has to undo it.
  assert.equal(parseMistamaProduct('<html><body>Regulamin</body></html>', PAGE_URL), null)
  assert.equal(
    parseMistamaProduct('<script type="application/ld+json">{oops</script>', PAGE_URL),
    null,
  )
})

test('which Bosch it is comes from the breadcrumb, not from the shop', () => {
  // The shop writes one maker, "BOSCH". The catalog keeps the lines apart,
  // because a green drill and a blue one are not the same item to anybody
  // holding them.
  assert.equal(parseMistamaProduct(page({}), PAGE_URL)?.brand, 'Bosch Home & Garden')

  const professional = page({
    crumbs: ['Strona główna', 'BOSCH PROFESSIONAL', 'Wiertarki', 'Wkrętarka GSB 185-LI'],
  })
  assert.equal(parseMistamaProduct(professional, PAGE_URL)?.brand, 'Bosch Professional')

  // A maker the script has no line for keeps the shop's own spelling: a brand
  // nobody uses is visible and fixable, an invented one is not.
  const other = page({
    crumbs: ['Strona główna', 'Narzędzia', 'Młotki'],
    product: { brand: { '@type': 'Brand', name: 'Stanley' } },
  })
  assert.equal(parseMistamaProduct(other, PAGE_URL)?.brand, 'Stanley')
})

test('the category is the kind of item, not the shelf it is sold from', () => {
  // The last crumb is as often "Seria 18V" as it is a kind of thing, and the
  // one before the home page is the maker's own section.
  assert.equal(parseMistamaProduct(page({}), PAGE_URL)?.category, 'Podkaszarki akumulatorowe')

  const noCrumbs = page({ crumbs: ['Strona główna', 'Produkt'] })
  // Nothing usable: the shop's own field, rather than a guess.
  assert.equal(parseMistamaProduct(noCrumbs, PAGE_URL)?.category, 'Seria 18V')
})

test('the model is the shouted part of the name, without the maker', () => {
  assert.equal(
    modelOf('Wkrętarka z udarem GSB 185-LI BOSCH 2x2,0Ah + walizka', 'Bosch Professional'),
    'GSB 185-LI',
  )
  assert.equal(
    modelOf(
      'Podkaszarka akumulatorowa 26 cm EASYGRASSCUT 18V-26 BOSCH (korpus)',
      'Bosch Home & Garden',
    ),
    'EASYGRASSCUT 18V-26',
  )
  // Nothing shouted is nothing written: a model invented from the first two
  // words of a Polish sentence is worse than an empty field.
  assert.equal(modelOf('Szpula z żyłką do podkaszarki', 'Bosch'), '')
})

test('a parameter is the plain text and its value is the bold', () => {
  const specs = specifications(
    page({
      specs: `
      <li>Napięcie akumulatora&nbsp;<strong>18 V</strong></li>
      <li>Prędkość obrotowa <strong>8.500 obr/min</strong></li>
      <li>Ciężar z akumulatorem <strong>2,1 kg</strong> (akumulator 2,5Ah)</li>
    `,
    }),
  )

  assert.deepEqual(specs, [
    { name: 'Napięcie akumulatora', value: '18 V' },
    { name: 'Prędkość obrotowa', value: '8.500 obr/min' },
    { name: 'Ciężar z akumulatorem', value: '2,1 kg (akumulator 2,5Ah)' },
  ])
})

test('a bullet with no name is a feature, and a dash is not a value', () => {
  // "Metalowy kabłąk w wyposażeniu" is bold all the way through: it says
  // something about the item but it is not a parameter called nothing. "-" is
  // the shop saying the field does not apply to this machine.
  const specs = specifications(
    page({
      specs: `
      <li><strong>Metalowy kabłąk chroniący rośliny</strong></li>
      <li>Pojemność akumulatora&nbsp;<strong>-</strong></li>
      <li>Wysokość drążka <strong>90 cm</strong></li>
    `,
    }),
  )

  assert.deepEqual(specs, [{ name: 'Wysokość drążka', value: '90 cm' }])
})

test('a parameter named twice becomes one with both readings', () => {
  // A drill lists torque for hard materials and for soft, and the card cannot
  // hold the name twice. Neither reading is worth losing — the qualifiers are
  // what tell them apart.
  const merged = mergeDuplicates([
    { name: 'Moment obrotowy', value: '50 Nm (twarde)' },
    { name: 'Moment obrotowy', value: '21 Nm (miękkie)' },
    { name: 'moment obrotowy', value: '21 Nm (miękkie)' },
    { name: 'Ciężar', value: '1,3 kg' },
  ])

  assert.deepEqual(merged, [
    { name: 'Moment obrotowy', value: '50 Nm (twarde); 21 Nm (miękkie)' },
    { name: 'Ciężar', value: '1,3 kg' },
  ])
})

test('the catalog number is taken, the EAN only when it is one', () => {
  // The shop fills gtin13 with the catalog number on some cards, and "Kod EAN"
  // repeating the line above it is worse than no line at all.
  const named = (html: string) =>
    (parseMistamaProduct(html, PAGE_URL)?.attributes ?? []).map((attribute) => attribute.name)

  assert.ok(named(page({})).includes('Kod EAN'))
  assert.ok(!named(page({ product: { gtin13: '06019K3100' } })).includes('Kod EAN'))
  assert.ok(named(page({})).includes('Numer katalogowy'))
  assert.ok(named(page({})).includes('W zestawie'))
})

test('the pictures are the originals, not the thumbnails', () => {
  // A catalog outlives the shop's idea of what "large" means, and `?lm=` is a
  // cache-buster rather than part of the file.
  assert.deepEqual(parseMistamaProduct(page({}), PAGE_URL)?.photoUrls, [
    'https://mistama.com/media/products/4d33/images/miniatura.jpg',
    'https://mistama.com/media/products/4d33/images/IMG-4380.jpg',
  ])
})

test('a shop that publishes no documents says so about itself', () => {
  // Which is what keeps a screen asking for manuals from offering a page that
  // can only ever answer "none".
  assert.equal(importerFor('https://mistama.com/x.html')?.manuals, false)
})

test('an address from anywhere else has no importer', () => {
  assert.equal(importerFor('https://mistama.com/cokolwiek.html')?.label, 'mistama.com')
  assert.equal(importerFor('https://www.mistama.com/cokolwiek.html')?.label, 'mistama.com')
  assert.equal(importerFor('https://MISTAMA.COM/cokolwiek.html')?.label, 'mistama.com')
  assert.equal(importerFor('https://allegro.pl/oferta/1'), null)
  assert.equal(importerFor('https://mistama.com.evil.example/x'), null)
  assert.equal(importerFor('file:///etc/passwd'), null)
  assert.equal(importerFor('nie adres'), null)
  assert.equal(importerFor(''), null)
})

test('every import says where it came from', () => {
  // A card that arrived by import is one somebody will want to check against
  // its source later. It is the card's own field rather than a line on its
  // spec sheet: every imported card has exactly one and none has two, and on
  // the sheet it sorted among the voltages where anybody could rename it.
  const read = parseMistamaProduct(page({}), PAGE_URL)

  assert.ok(read)
  assert.equal(fitToCard(read).sourceUrl, PAGE_URL)
  // And nowhere else. Two places holding one fact is two places to disagree.
  assert.ok(!fitToCard(read).attributes.some((attribute) => attribute.name === 'Referencja'))
})

test('an address is never cut in the middle to fit', () => {
  // Everything else on a card is clamped to what its column takes. Half an
  // address is not an address, so this one is cleaned and left whole.
  const long = `${PAGE_URL}?${'x'.repeat(400)}`
  const product = fitToCard({
    attributes: [],
    brand: 'Bosch',
    category: '',
    manuals: [],
    model: '',
    name: 'Kosiarka',
    notes: '',
    photoUrls: [],
    sourceUrl: long,
  })

  assert.equal(product.sourceUrl, long)
})

test('what the page says is cut to what the card can hold', () => {
  const product = fitToCard({
    attributes: [
      { name: 'W zestawie', value: `${'x'.repeat(400)} koniec` },
      { name: '', value: 'bez nazwy' },
    ],
    brand: 'Bosch',
    category: 'Podkaszarki',
    manuals: [],
    model: 'EASYGRASSCUT',
    name: 'a'.repeat(400),
    notes: 'Opis',
    photoUrls: [],
    sourceUrl: PAGE_URL,
  })

  assert.equal(product.name.length, 200)
  assert.ok(product.name.endsWith('…'))
  // The page's one usable parameter, and nothing the import adds of its own.
  assert.deepEqual(
    product.attributes.map((attribute) => attribute.name),
    ['W zestawie'],
  )
  assert.ok(product.attributes[0].value.length <= 200)
  // A parameter with nothing on one side is dropped rather than sent to be
  // refused by a rule that would fail the whole import.
  assert.ok(!product.attributes.some((attribute) => attribute.name === ''))
})
