import assert from 'node:assert/strict'
import test from 'node:test'

import { importerFor } from './index'
import {
  categoryOf,
  eanOf,
  manualsOf,
  modelOf,
  notesOf,
  parseNacProduct,
  photosOf,
  specifications,
} from './nac'

const PAGE_URL = 'https://nac.com.pl/rozdrabniacz-elektryczny-do-galezi-nac-she280s-box-g/'

const UPLOADS = 'https://nac.com.pl/wp-content/uploads'

// The maker's shape: WordPress underneath, so the only schema.org here is a
// BlogPosting, and the facts live under the anchors the page links to itself.
function page(options: { heading?: string; rows?: string } = {}) {
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BlogPosting',
        articleSection: 'Rozdrabniacze',
        headline: 'Rozdrabniacz elektryczny do gałęzi SHE280S-BOX-G',
      },
      {
        '@type': 'WebPage',
        image: { '@type': 'ImageObject', url: `${UPLOADS}/2025/10/SHE280S-BOX-G_1.webp` },
        url: PAGE_URL,
      },
    ],
  }

  const rows =
    options.rows ??
    `
      <li><em>silnik</em> <strong>elektryczny, komutatorowy</strong></li>
      <li><em>moc nominalna silnika</em> <strong>2800 W</strong></li>
      <li><em>pojemność silnika</em> <strong>212 cm<sup>3</sup></strong></li>
      <li><em>Ochrona IP:</em> <strong>IPX4</strong></li>
      <li><em>waga</em> <strong>19,2 kg</strong></li>
    `

  return `
    <html><head>
    <script type="application/ld+json">${JSON.stringify(graph)}</script>
    </head><body>
    <nav><a href="${UPLOADS}/2026/07/Katalog-NAC-2026-A4-PL-internet.pdf">Katalog</a></nav>
    <h4 class="elementor-heading-title">Łuparki i rozdrabniacze</h4>
    <h1 class="elementor-heading-title">${options.heading ?? 'Rozdrabniacz elektryczny\n<span>SHE280S-BOX-G<span></span></span>'}</h1>
    <div class="elementor-element ean-style elementor-widget-jet-listing-dynamic-field">
      <div class="elementor-widget-container"><div class="jet-listing jet-listing-dynamic-field">
      <div class="jet-listing-dynamic-field__inline-wrap">
      <div class="jet-listing-dynamic-field__content" >5902067856109</div></div></div></div>
    </div>
    <div class="elementor-icon-box-content">
      <h3 class="elementor-icon-box-title">
        <a href="${UPLOADS}/2025/10/SHE280S-BOX-G_z_CE_2025.pdf" >Instrukcja obsługi</a>
      </h3>
    </div>
    <div class="elementor-icon-box-content">
      <h3 class="elementor-icon-box-title">
        <a href="${UPLOADS}/2026/03/Deklaracja-SHE280S-BOX-G-PL.pdf" >Certyfikaty</a>
      </h3>
    </div>
    <div class="elementor-icon-box-content">
      <h3 class="elementor-icon-box-title">
        <a href="${UPLOADS}/2026/03/SHE280S-BOX-G_TABLICZKA.jpg" >Etykieta</a>
      </h3>
    </div>
    <div class="elementor-element e-con-parent" id="galeria">
      <h3>Galeria Produktu</h3>
      <div class="elementor-image-carousel swiper-wrapper">
        <div class="swiper-slide"><a href="${UPLOADS}/2025/10/SHE280S-BOX-G_4.webp"><figure><img class="swiper-slide-image" src="${UPLOADS}/2025/10/SHE280S-BOX-G_4-300x300.webp" /></figure></a></div>
        <div class="swiper-slide"><a href="${UPLOADS}/2025/10/SHE280S-BOX-G_1.webp"><figure><img class="swiper-slide-image" src="${UPLOADS}/2025/10/SHE280S-BOX-G_1-300x300.webp" /></figure></a></div>
      </div>
    </div>
    <div class="elementor-element e-con-parent" id="parametry">
      <h3 class="elementor-heading-title">Parametry</h3>
      <div class="elementor-element list-style-2"><ul>${rows}</ul></div>
    </div>
    <div class="elementor-element e-con-parent" id="opis">
      <h3 class="elementor-heading-title">Opis produktu</h3>
      <div class="elementor-element list-style-1"><ul>
        <li>Rozdrabniacz do gałęzi NAC SHE280S-BOX-G rozdrabnia gałęzie o średnicy do 44 mm.</li>
        <li>Wydajny silnik o mocy 2800 W z zabezpieczeniem przeciążeniowym</li>
      </ul></div>
    </div>
    <div class="elementor-element" id="podobne">
      <h3>Zobacz podobne produkty</h3>
      <a href="${UPLOADS}/2026/02/LRP40-212T-TX_1.webp">Wertykulator</a>
    </div>
    </body></html>
  `
}

test('a product page becomes a card', () => {
  const product = parseNacProduct(page(), PAGE_URL)

  assert.ok(product)
  assert.equal(product.name, 'Rozdrabniacz elektryczny SHE280S-BOX-G')
  assert.equal(product.brand, 'NAC')
  assert.equal(product.category, 'Rozdrabniacze')
  assert.equal(product.sourceUrl, PAGE_URL)
})

test('the model is the part of the heading the theme sets apart', () => {
  // The heading is written in two pieces so the model gets a line of its own.
  assert.equal(
    modelOf('Rozdrabniacz elektryczny\n<span>SHE280S-BOX-G<span></span></span>'),
    'SHE280S-BOX-G',
  )
  assert.equal(modelOf('Aerator wertykulator elektryczny\n<span>SCE200-40-W</span>'), 'SCE200-40-W')
  assert.equal(modelOf('Kosiarki'), '')
})

test('the category is what the post is filed under, not the shelf above the heading', () => {
  // "Łuparki i rozdrabniacze" is a heading among many; this is a field.
  assert.equal(categoryOf(page()), 'Rozdrabniacze')
  assert.equal(categoryOf('<html></html>'), '')
})

test('the specification is a list of em and strong, not a table', () => {
  assert.deepEqual(specifications(page()), [
    { name: 'silnik', value: 'elektryczny, komutatorowy' },
    { name: 'moc nominalna silnika', value: '2800 W' },
    // Tags out, "212 cm<sup>3</sup>" would be "212 cm 3" — a different number.
    { name: 'pojemność silnika', value: '212 cm³' },
    // Somebody typed a colon on this row and not on the others.
    { name: 'Ochrona IP', value: 'IPX4' },
    { name: 'waga', value: '19,2 kg' },
  ])
})

test('the barcode comes off the field the theme prints under the heading', () => {
  assert.equal(eanOf(page()), '5902067856109')

  const attributes = parseNacProduct(page(), PAGE_URL)?.attributes ?? []
  assert.equal(attributes.find((attribute) => attribute.name === 'Kod EAN')?.value, '5902067856109')
})

test('the note is what the tool is for, and every bullet ends as a sentence', () => {
  // Run together as they were typed, they read as one sentence that never
  // finishes: the shop ended one of these with a full stop and one without.
  assert.equal(
    notesOf(page()),
    'Rozdrabniacz do gałęzi NAC SHE280S-BOX-G rozdrabnia gałęzie o średnicy do 44 mm. Wydajny silnik o mocy 2800 W z zabezpieczeniem przeciążeniowym.',
  )
})

test("the shop's own picture comes first, because the carousel does not lead with it", () => {
  // The slides are in the order they were uploaded; the first photograph is
  // the one the card shows, so the main image goes in front and only once.
  assert.deepEqual(photosOf(page()), [
    `${UPLOADS}/2025/10/SHE280S-BOX-G_1.webp`,
    `${UPLOADS}/2025/10/SHE280S-BOX-G_4.webp`,
  ])
})

test('a photograph of a different machine further down the page is not the card’s', () => {
  assert.ok(!photosOf(page()).some((url) => url.includes('LRP40')))
})

test('the documents are the icon boxes that link a PDF', () => {
  assert.deepEqual(manualsOf(page()), [
    { title: 'Instrukcja obsługi', url: `${UPLOADS}/2025/10/SHE280S-BOX-G_z_CE_2025.pdf` },
    { title: 'Certyfikaty', url: `${UPLOADS}/2026/03/Deklaracja-SHE280S-BOX-G-PL.pdf` },
  ])
})

test('the rating plate is a photograph and the catalogue is the whole shop', () => {
  // "Etykieta" is a JPG of the plate, and the catalogue in the navigation is
  // every machine NAC makes — neither is a document about this one.
  const urls = manualsOf(page()).map((manual) => manual.url)

  assert.ok(!urls.some((url) => url.includes('TABLICZKA')))
  assert.ok(!urls.some((url) => url.includes('Katalog')))
})

test('a page that is a shelf rather than a machine is refused', () => {
  // Every page on this site is a post, so what tells them apart is the model
  // in the heading — and a card of empty fields is worse than a refusal.
  assert.equal(parseNacProduct(page({ heading: 'Kosiarki' }), PAGE_URL), null)
  assert.equal(parseNacProduct('<html><body>Regulamin</body></html>', PAGE_URL), null)
})

test('the seventh source is reachable, and publishes its documents', () => {
  assert.equal(importerFor(PAGE_URL)?.label, 'nac.com.pl')
  assert.equal(importerFor(PAGE_URL)?.manuals, true)
  assert.equal(importerFor('https://nac.com.pl.evil.example/produkt/x'), null)
})
