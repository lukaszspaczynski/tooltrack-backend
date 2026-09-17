import assert from 'node:assert/strict'
import test from 'node:test'

import { fitToCard, IMPORT_SOURCES, importerFor } from './index'
import {
  attributesOf,
  descriptionOf,
  dimensions,
  measurement,
  nameOf,
  parseQbrickCase,
  photosOf,
  specifications,
  lineOf,
  modelOf,
} from './qbrick'

const PAGE_URL = 'https://qbricksystem.com/product/qbrick-model-pro-toolcase-protective-foam/'

const UPLOADS = 'https://qbricksystem.com/wp-content/uploads/2025/01'

// The maker's shape: one small table where every unit is written into the
// value, and a WooCommerce gallery.
function page(options: { content?: string; heading?: string; rows?: string } = {}) {
  const rows =
    options.rows ??
    `
      <tr><td>Wymiary zewnętrzne</td><td>450 [L] x 322 [W] x 126 [H] mm</td></tr>
      <tr><td>Wymiary wewnętrzne</td><td>408 [L] x 226 [W] x 100 [H] mm</td></tr>
      <tr><td>Przekątna</td><td>495 mm</td></tr>
      <tr><td>Pojemność</td><td>11 L</td></tr>
      <tr><td>Ładowność</td><td>15kg</td></tr>
      <tr><td>Waga</td><td>1.4kg</td></tr>
      <tr><td>Ilość na palecie</td><td>94</td></tr>
      <tr><td>EAN</td><td>5901238254232</td></tr>
      <tr><td>SKU</td><td>SKRQTCPROFCZAPG001</td></tr>
    `

  // The description is an Elementor widget rather than WooCommerce's own
  // short-description or tab: this site has neither.
  const content =
    options.content ??
    `<p>Qbrick System PRO Toolcase to uniwersalny i modułowy pojemnik na elektronarzędzia.</p>
     <p>Poliamidowe konektory boczne pozwolą na łączenie QS PRO Toolcase z pozostałymi modułami.</p>`

  return `
    <html><body>
    <h1>${options.heading ?? 'QBRICK SYSTEM PRO TOOLCASE'}</h1>
    <div class="elementor-element elementor-widget"
         data-widget_type="woocommerce-product-content.default">
      <div class="elementor-widget-container">${content}</div></div>
    <div class="woocommerce-product-gallery">
      <div data-thumb="${UPLOADS}/Toolcase-150x150.png">
        <img src="${UPLOADS}/Toolcase-600x600.png"
             data-large_image="${UPLOADS}/Toolcase.png" />
      </div>
      <div><img src="${UPLOADS}/Toolcase-back-600x600.png"
                data-large_image="${UPLOADS}/Toolcase-back.png" /></div>
    </div>
    <table><tbody>${rows}</tbody></table>
    </body></html>
  `
}

test('a product page becomes a case', () => {
  const found = parseQbrickCase(page(), PAGE_URL)

  assert.ok(found)
  assert.equal(found.brand, 'Qbrick')
  // Every product on this site is one, and it is not read off the page: the
  // breadcrumb there names the range rather than the kind of thing.
  assert.equal(found.category, 'Pojemniki')
  // A box is a card of kind 'case', which is what tells the import route to
  // write one rather than a tool.
  assert.equal(found.kind, 'case')
  assert.equal(found.model, 'PRO Toolcase')
  // The barcode and the catalogue number are parameters now, like every other
  // row the table states.
  assert.equal(valueOf(found.attributes, 'EAN'), '5901238254232')
  assert.equal(valueOf(found.attributes, 'SKU'), 'SKRQTCPROFCZAPG001')
  assert.equal(found.sourceUrl, PAGE_URL)
})

test('the page shouts and the catalog does not', () => {
  // A van full of boxes labelled in capitals is a van nobody can read. The
  // model goes back as it was: "Pro" is a word, "PRO" is the name of a line.
  assert.equal(nameOf('QBRICK SYSTEM PRO TOOLCASE', 'PRO'), 'Qbrick System PRO Toolcase')
  assert.equal(
    nameOf('QBRICK SYSTEM PRO TECHNICIAN CASE 2.0', 'PRO'),
    'Qbrick System PRO Technician Case 2.0',
  )
})

test('the model is the heading without the maker in front of it', () => {
  // The range alone — "PRO" — is what every Qbrick in a workshop is, so it
  // tells none of them apart. What does is the rest of the heading.
  assert.equal(modelOf('QBRICK SYSTEM PRO TOOLCASE'), 'PRO Toolcase')
  assert.equal(
    modelOf('QBRICK SYSTEM PRO DRAWER 3 TOOLBOX 2.0 EXPERT'),
    'PRO Drawer 3 Toolbox 2.0 Expert',
  )
  // Nothing to strip is nothing to call a model: it would be the name repeated
  // one line down, which is worse than an empty field.
  assert.equal(modelOf('Skrzynka bez systemu'), '')
})

test('the range is the one word the heading shouts on purpose', () => {
  assert.equal(lineOf('QBRICK SYSTEM PRO TOOLCASE'), 'PRO')
  assert.equal(lineOf('Skrzynka bez systemu'), '')
})

test('a box is three numbers, whatever the labels around them say', () => {
  assert.deepEqual(dimensions('450 [L] x 322 [W] x 126 [H] mm'), [450, 322, 126])
  // A page that dropped the brackets would still be stating the same box.
  assert.deepEqual(dimensions('450 x 322 x 126 mm'), [450, 322, 126])
  assert.deepEqual(dimensions('brak danych'), [null, null, null])
})

test('the unit is written into the value, with a space or without', () => {
  assert.equal(measurement('11 L'), 11)
  assert.equal(measurement('15kg'), 15)
  assert.equal(measurement('1.4kg'), 1.4)
  assert.equal(measurement('495 mm'), 495)
  assert.equal(measurement(undefined), null)
})

test('the measurements land in the right corners of the box', () => {
  // Three numbers on one row of the page become three parameters. A length and
  // a width are two facts, and a screen showing them as one string cannot
  // compare two boxes.
  const found = parseQbrickCase(page(), PAGE_URL)

  assert.ok(found)
  assert.equal(valueOf(found.attributes, 'Długość zewnętrzna'), '450 mm')
  assert.equal(valueOf(found.attributes, 'Szerokość zewnętrzna'), '322 mm')
  assert.equal(valueOf(found.attributes, 'Wysokość zewnętrzna'), '126 mm')
  assert.equal(valueOf(found.attributes, 'Długość wewnętrzna'), '408 mm')
  assert.equal(valueOf(found.attributes, 'Przekątna'), '495 mm')
  // The unit travels in the value, as it does for every other parameter.
  assert.equal(valueOf(found.attributes, 'Pojemność'), '11 L')
  assert.equal(valueOf(found.attributes, 'Ładowność'), '15 kg')
})

test('the note is what the maker writes about the box', () => {
  // It used to be the weight and the address, both of which are parameters
  // now. That left two of the five cases with a note that was a bare link and
  // nothing a person reads.
  const notes = parseQbrickCase(page(), PAGE_URL)?.notes ?? ''

  assert.match(notes, /^Qbrick System PRO Toolcase to uniwersalny/)
  assert.match(notes, /Poliamidowe konektory boczne/)
  assert.doesNotMatch(notes, /https:\/\//)
  // Two paragraphs on the page stay two paragraphs on the card.
  assert.equal(notes.split('\n\n').length, 2)
})

test('only the product’s own paragraphs are the description', () => {
  // A footer, a cookie notice and what the shop suggests buying next are all
  // paragraphs too, and none of them is about this box.
  const html = `
    <p>Newsletter</p>
    <div data-widget_type="woocommerce-product-content.default">
      <div class="elementor-widget-container"><p>O tej skrzynce.</p></div></div>
    <p>Polityka prywatności</p>
  `

  assert.equal(descriptionOf(html), 'O tej skrzynce.')
  // A page without the widget has no description rather than the whole page.
  assert.equal(descriptionOf('<html><body><p>Cokolwiek</p></body></html>'), '')
})

test('the whole table goes on the sheet, in the order a box is read in', () => {
  // Nine rows on the page, thirteen parameters on the card: the two dimension
  // rows are three numbers each. Outside, inside, diagonal, what goes in, what
  // it carries, then the numbers that identify the product.
  assert.deepEqual(
    attributesOf(specifications(page())).map((one) => one.name),
    [
      'Długość zewnętrzna',
      'Szerokość zewnętrzna',
      'Wysokość zewnętrzna',
      'Długość wewnętrzna',
      'Szerokość wewnętrzna',
      'Wysokość wewnętrzna',
      'Przekątna',
      'Pojemność',
      'Ładowność',
      'Waga',
      'Ilość na palecie',
      'EAN',
      'SKU',
    ],
  )
})

test('an imported case carries the address it was read from', () => {
  // The same field an item card gets, and what the "update from the page"
  // button on a case looks for. The analytics tail is not part of it.
  const fitted = fitToCard(parseQbrickCase(page(), `${PAGE_URL}?utm_source=nl`)!)

  assert.equal(fitted.sourceUrl, PAGE_URL)
  assert.equal(fitted.attributes.length, 13)
})

test('a photograph comes at the size it was uploaded', () => {
  // `data-large_image` is the original; the `src` beside it is whichever
  // thumbnail the layout asked for.
  assert.deepEqual(photosOf(page()), [`${UPLOADS}/Toolcase.png`, `${UPLOADS}/Toolcase-back.png`])
})

test('a page with no table is not a product', () => {
  // Every page on this site has a heading; only a product has the table. A case
  // of empty measurements is worse than a refusal.
  assert.equal(
    parseQbrickCase('<html><body><h1>EVERYTHING FITS</h1></body></html>', PAGE_URL),
    null,
  )
})

test('a measurement nobody could have taken is dropped, not stored', () => {
  // These were columns with a CHECK on them; free text has no CHECK, so the
  // reading is where it happens. A page stating 495000 mm has a decimal point
  // in the wrong place, and a card repeating it is worse than a card silent
  // about it.
  const absurd = parseQbrickCase(
    page({ rows: '<tr><td>Przekątna</td><td>495000 mm</td></tr><tr><td>EAN</td><td>1</td></tr>' }),
    PAGE_URL,
  )

  assert.ok(absurd)
  assert.equal(valueOf(fitToCard(absurd).attributes, 'Przekątna'), undefined)
  // What is plausible stays, so the check cannot be "drop everything".
  assert.equal(valueOf(fitToCard(absurd).attributes, 'EAN'), '1')
})

test('the boxes are in the one registry, beside the drills', () => {
  // There were two while a case was a table of its own: the scripts answered
  // different shapes, so the dialog asking "where is this box from" could not
  // be shown the same list as one asking about a drill. They answer the same
  // shape now, and which sort of card a page describes is the page's own
  // answer rather than the dialog's question.
  assert.equal(importerFor(PAGE_URL)?.label, 'qbricksystem.com')
  assert.ok(IMPORT_SOURCES.some((source) => source.host === 'qbricksystem.com'))
  assert.ok(IMPORT_SOURCES.some((source) => source.host === 'nac.com.pl'))
})

function valueOf(attributes: { name: string; value: string }[], name: string) {
  return attributes.find((attribute) => attribute.name === name)?.value
}
