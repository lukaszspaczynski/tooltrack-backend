import assert from 'node:assert/strict'
import test from 'node:test'

import { caseImporterFor, CASE_IMPORT_SOURCES, fitCaseToCard, importerFor } from './index'
import {
  attributesOf,
  descriptionOf,
  dimensions,
  measurement,
  nameOf,
  parseQbrickCase,
  photosOf,
  specifications,
  systemOf,
} from './qbrick'

const PAGE_URL = 'https://qbricksystem.com/product/qbrick-system-pro-toolcase-protective-foam/'

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
  assert.equal(found.manufacturer, 'Qbrick')
  assert.equal(found.system, 'PRO')
  assert.equal(found.ean, '5901238254232')
  assert.equal(found.sku, 'SKRQTCPROFCZAPG001')
  assert.equal(found.sourceUrl, PAGE_URL)
})

test('the page shouts and the catalog does not', () => {
  // A van full of boxes labelled in capitals is a van nobody can read. The
  // system goes back as it was: "Pro" is a word, "PRO" is the name of a line.
  assert.equal(nameOf('QBRICK SYSTEM PRO TOOLCASE', 'PRO'), 'Qbrick System PRO Toolcase')
  assert.equal(
    nameOf('QBRICK SYSTEM PRO TECHNICIAN CASE 2.0', 'PRO'),
    'Qbrick System PRO Technician Case 2.0',
  )
})

test('the system is the word after "system"', () => {
  assert.equal(systemOf('QBRICK SYSTEM PRO TOOLCASE'), 'PRO')
  assert.equal(systemOf('Skrzynka bez systemu'), '')
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
  const found = parseQbrickCase(page(), PAGE_URL)

  assert.equal(found?.outerLengthMm, 450)
  assert.equal(found?.outerWidthMm, 322)
  assert.equal(found?.outerHeightMm, 126)
  assert.equal(found?.innerLengthMm, 408)
  assert.equal(found?.innerWidthMm, 226)
  assert.equal(found?.innerHeightMm, 100)
  assert.equal(found?.diagonalMm, 495)
  assert.equal(found?.capacityL, 11)
  assert.equal(found?.loadKg, 15)
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

test('the two rows that are not columns go on the sheet', () => {
  // Nine rows, seven of them columns. The weight and the pallet count are what
  // the page states and the catalog has no field for.
  assert.deepEqual(attributesOf(specifications(page())), [
    { name: 'Ilość na palecie', value: '94' },
    { name: 'Waga', value: '1.4kg' },
  ])

  // A row nobody has decided where to put stays off the sheet: the EAN has a
  // column, and printing it twice is worse than not at all.
  assert.deepEqual(
    attributesOf(specifications(page())).map((one) => one.name),
    ['Ilość na palecie', 'Waga'],
  )
})

test('an imported case carries the address it was read from', () => {
  // The same field a tool card gets, and what the "update from the page"
  // button on a case looks for. The analytics tail is not part of it: it says
  // nothing about the box, and the card would show it as its source for ever.
  const fitted = fitCaseToCard(parseQbrickCase(page(), `${PAGE_URL}?utm_source=nl`)!)

  assert.equal(fitted.sourceUrl, PAGE_URL)
  // The sheet stays the two rows the page states and no column holds.
  assert.deepEqual(
    fitted.attributes.map((one) => one.name),
    ['Ilość na palecie', 'Waga'],
  )
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
  // A number typed in micrometres looks like a fact once it is on a card.
  const absurd = parseQbrickCase(
    page({ rows: '<tr><td>Przekątna</td><td>495000 mm</td></tr><tr><td>EAN</td><td>1</td></tr>' }),
    PAGE_URL,
  )

  assert.equal(fitCaseToCard(absurd!).diagonalMm, null)
})

test('a case source is its own registry, not the tool one', () => {
  // A page that sells drills has nothing to say about a box, and the dialog
  // asking where this one is from should never offer one.
  assert.equal(caseImporterFor(PAGE_URL)?.label, 'qbricksystem.com')
  assert.equal(importerFor(PAGE_URL), null)
  assert.equal(caseImporterFor('https://nac.com.pl/rozdrabniacz/'), null)
  assert.deepEqual(
    CASE_IMPORT_SOURCES.map((source) => source.host),
    ['qbricksystem.com'],
  )
})
