import assert from 'node:assert/strict'
import test from 'node:test'

import { importerFor } from './index'
import {
  catalogNumberOf,
  categoryOf,
  modelOf,
  parseStanleyProduct,
  photosOf,
  specifications,
} from './stanley'

const PAGE_URL = 'https://www.stanleyworks.pl/produkt/6-tre650/zszywacz-elektryczny-tre650-stanley'

// The plainest shape of the five: a Drupal page with the facts in its markup.
function page(options: { crumbs?: string; heading?: string; rows?: string } = {}) {
  const rows =
    options.rows ??
    `
      <tr><td><div>Materiał korpusu</div></td><td><div>Plastyczny</div></td></tr>
      <tr><td><div>Długość przewodu [m]</div></td><td><div>2.4</div></td></tr>
    `

  return `
    <html><body>
    <nav class="breadcrumbs">
      <h2>Breadcrumb</h2>
      ${options.crumbs ?? '<a href="/">Home</a><a href="/n">Narzędzia ręczne</a><a href="/m">Gwoździarki</a>'}
    </nav>
    <h1>${options.heading ?? 'Zszywacz elektryczny TRE650 Stanley'}</h1>
    <img src="/EMEA/PRODUCT/IMAGES/HIRES/6-TRE650_3.jpg?resize=530x530" alt="">
    <img src="/sites/g/files/xnuzat2116/files/stanley%402x.png" alt="logo">
    <table class="reference_entity_table" data-striping="1"><tbody>${rows}</tbody></table>
    </body></html>
  `
}

test('a product page becomes a card', () => {
  const product = parseStanleyProduct(page(), PAGE_URL)

  assert.ok(product)
  assert.equal(product.name, 'Zszywacz elektryczny TRE650 Stanley')
  assert.equal(product.brand, 'STANLEY')
  assert.equal(product.category, 'Gwoździarki')
  assert.equal(product.sourceUrl, PAGE_URL)
})

test('a page with no spec table is not a product page', () => {
  // A heading and nothing else is a category page or a redirect, and a card of
  // empty fields is worse than a refusal.
  assert.equal(parseStanleyProduct('<html><h1>Narzędzia</h1></html>', PAGE_URL), null)
  assert.equal(parseStanleyProduct(page({ rows: '<tr><td></td><td></td></tr>' }), PAGE_URL), null)
})

test('the model is the shouted token with a digit in it', () => {
  // The maker's own name is shouted too, and so is a Polish word at the start
  // of a sentence — a digit is what tells a model from both.
  assert.equal(modelOf('Zszywacz elektryczny TRE650 Stanley'), 'TRE650')
  assert.equal(modelOf('Młotek ciesielski STANLEY'), '')
  assert.equal(modelOf('Wkrętarka SBD121'), 'SBD121')
})

test('the catalog number is the segment the shop orders it by', () => {
  assert.equal(catalogNumberOf(PAGE_URL), '6-TRE650')
  assert.equal(catalogNumberOf('https://www.stanleyworks.pl/produkt/'), '')
  assert.equal(catalogNumberOf('nie adres'), '')
})

test('the category is the last crumb that is not the product', () => {
  assert.equal(categoryOf(page()), 'Gwoździarki')
  assert.equal(categoryOf(page({ crumbs: '<a href="/">Home</a>' })), '')
  assert.equal(categoryOf('<html></html>'), '')
})

test('a spec row is two cells', () => {
  assert.deepEqual(specifications(page()), [
    { name: 'Materiał korpusu', value: 'Plastyczny' },
    { name: 'Długość przewodu [m]', value: '2.4' },
  ])
})

test('a photograph is kept at the size it was published', () => {
  // `?resize=530x530` is the layout talking, and the site's own furniture is
  // not a picture of the tool.
  assert.deepEqual(photosOf(page()), [
    'https://www.stanleyworks.pl/EMEA/PRODUCT/IMAGES/HIRES/6-TRE650_3.jpg',
  ])
})

test('the fifth source is reachable, and promises no documents', () => {
  // The page links one EU declaration and loads its manuals from an endpoint
  // of its own after rendering. An importer makes one request, so this source
  // says up front that it has none.
  assert.equal(importerFor(PAGE_URL)?.label, 'stanleyworks.pl')
  assert.equal(importerFor(PAGE_URL)?.manuals, false)
  assert.equal(importerFor('https://stanleyworks.pl/produkt/x')?.label, 'stanleyworks.pl')
  assert.equal(importerFor('https://stanleyworks.pl.evil.example/x'), null)
})
