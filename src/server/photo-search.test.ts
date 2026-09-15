import assert from 'node:assert/strict'
import test from 'node:test'

import { clampResultLimit, searchEngine } from './search-engines'
import {
  combineFailures,
  defaultQuery,
  mapMistamaGallery,
  matchesQuery,
  mistamaProducts,
  interleave,
  mapBraveResults,
  mapGoogleResults,
  mapOpenverseResults,
  PhotoSearchUnavailableError,
  searchPhotos,
  type PhotoSuggestion,
} from './photo-search'

function suggestion(url: string, provider: PhotoSuggestion['provider']): PhotoSuggestion {
  return {
    attribution: '',
    height: null,
    provider,
    sourceUrl: url,
    thumbnailUrl: url,
    title: url,
    url,
    width: null,
  }
}

test('the query identifies the machine, not the category', () => {
  assert.equal(
    defaultQuery({
      brand: { name: 'Bosch Professional' },
      model: 'GWS 180-LI',
      name: 'Szlifierka kątowa',
    }),
    'Bosch Professional GWS 180-LI',
  )
  // A card with no maker is normal — most hand tools have none — and the name
  // is all there is to search for.
  assert.equal(defaultQuery({ brand: null, model: '', name: 'Młotek' }), 'Młotek')
  assert.equal(defaultQuery({ brand: { name: 'Makita' }, model: '', name: 'Wiertarka' }), 'Makita')
})

test('no engine switched on is an error the screen can explain', async () => {
  await assert.rejects(
    () => searchPhotos('wiertarka', []),
    (error: unknown) => {
      assert.ok(error instanceof PhotoSearchUnavailableError)
      assert.match((error as Error).message, /Ustawienia/)
      return true
    },
  )
})

test('when everything fails, every reason is named', () => {
  // Two engines down for two different reasons — a rejected key and an outage.
  // Reporting only the first sends whoever reads it to fix the wrong thing.
  assert.equal(
    combineFailures([
      { message: 'google: klucz odrzucony (403)', provider: 'google' },
      { message: 'openverse: brak odpowiedzi', provider: 'openverse' },
    ]),
    'google: klucz odrzucony (403) · openverse: brak odpowiedzi',
  )

  assert.equal(combineFailures([]), 'Wyszukiwanie nie powiodło się')
})

test('results from several engines are interleaved, not concatenated', () => {
  // With two engines on, the first row has to show both.
  const merged = interleave(
    [
      [suggestion('g1', 'google'), suggestion('g2', 'google'), suggestion('g3', 'google')],
      [suggestion('b1', 'brave'), suggestion('b2', 'brave')],
    ],
    30,
  )

  assert.deepEqual(
    merged.map((entry) => entry.url),
    ['g1', 'b1', 'g2', 'b2', 'g3'],
  )
})

test('every engine keeps its full share — the limit is per engine', () => {
  // Two engines at ten each is twenty suggestions, not ten split between them.
  // Capping the merged list would silently drop whichever engine sorts last.
  const ten = (prefix: string, provider: 'brave' | 'google') =>
    Array.from({ length: 10 }, (_, index) => suggestion(`${prefix}${index}`, provider))

  const merged = interleave([ten('g', 'google'), ten('b', 'brave')], 2 * 10)

  assert.equal(merged.length, 20)
  assert.equal(merged.filter((entry) => entry.provider === 'google').length, 10)
  assert.equal(merged.filter((entry) => entry.provider === 'brave').length, 10)
})

test('the same picture found twice is one suggestion', () => {
  const merged = interleave(
    [[suggestion('same', 'google')], [suggestion('same', 'brave'), suggestion('other', 'brave')]],
    10,
  )

  assert.deepEqual(
    merged.map((entry) => entry.url),
    ['same', 'other'],
  )
})

test('the limit is respected and an empty engine does not stall the merge', () => {
  const merged = interleave([[], [suggestion('a', 'brave'), suggestion('b', 'brave')]], 1)

  assert.equal(merged.length, 1)
  assert.deepEqual(interleave([[], []], 5), [])
})

test('a Google image result becomes a suggestion', () => {
  const suggestions = mapGoogleResults({
    items: [
      {
        displayLink: 'bosch-professional.com',
        image: {
          contextLink: 'https://www.bosch-professional.com/gws-180-li',
          height: 800,
          thumbnailLink: 'https://encrypted-tbn0.gstatic.com/thumb.jpg',
          width: 1200,
        },
        link: 'https://www.bosch-professional.com/gws.jpg',
        title: 'GWS 180-LI',
      },
      { title: 'Bez adresu' },
    ],
  })

  assert.equal(suggestions.length, 1)
  assert.equal(suggestions[0].provider, 'google')
  assert.equal(suggestions[0].url, 'https://www.bosch-professional.com/gws.jpg')
  assert.equal(suggestions[0].width, 1200)
})

test('a Brave result takes the image, not the page it sits on', () => {
  const suggestions = mapBraveResults({
    results: [
      {
        properties: { url: 'https://cdn.example.com/gws.jpg' },
        source: 'example.com',
        thumbnail: { src: 'https://imgs.search.brave.com/thumb.jpg' },
        title: 'GWS 180-LI',
        url: 'https://example.com/produkt/gws-180-li',
      },
      // A result with no image behind it is dropped rather than turned into a
      // tile that saves the HTML page.
      { title: 'Tylko strona', url: 'https://example.com/artykul' },
    ],
  })

  assert.equal(suggestions.length, 1)
  assert.equal(suggestions[0].url, 'https://cdn.example.com/gws.jpg')
  assert.equal(suggestions[0].sourceUrl, 'https://example.com/produkt/gws-180-li')
  assert.equal(suggestions[0].provider, 'brave')
})

test('an Openverse result carries its author and licence', () => {
  const suggestions = mapOpenverseResults({
    results: [
      {
        creator: 'Public Domain Photos',
        foreign_landing_url: 'https://www.flickr.com/photos/28958738@N06/4999892463',
        height: 360,
        license: 'by',
        license_version: '2.0',
        thumbnail: 'https://api.openverse.org/thumb.jpg',
        title: 'Angle grinder',
        url: 'https://live.staticflickr.com/4127/4999892463.jpg',
        width: 480,
      },
    ],
  })

  assert.equal(suggestions[0].attribution, 'Public Domain Photos · CC BY 2.0')
  assert.equal(suggestions[0].provider, 'openverse')
  // Deliberately the image on its CDN rather than Openverse's own thumbnail
  // service, which drops a third of the requests made to it.
  assert.equal(suggestions[0].thumbnailUrl, 'https://live.staticflickr.com/4127/4999892463.jpg')
})

test('an unexpected payload is an empty list, not a crash', () => {
  for (const payload of [null, undefined, {}, { items: 'nope' }, { results: null }, []]) {
    assert.deepEqual(mapGoogleResults(payload), [])
    assert.deepEqual(mapBraveResults(payload), [])
    assert.deepEqual(mapOpenverseResults(payload), [])
  }
})

// The shop is read as HTML rather than JSON, so the markup below is copied
// from the real pages — the point of pinning it is to fail when the shop
// changes its template, which is the one thing that can quietly break this
// engine.
const SEARCH_HTML = `
<div class="product thumbnail clearfix">
  <div class="image"><a href="/strug-akumulatorowy-gho-185-li-bosch-2x5-0ah.html"><img src="x" /></a></div>
  <p class="name"><a href="/strug-akumulatorowy-gho-185-li-bosch-2x5-0ah.html" class="product_name">Strug akumulatorowy GHO 185-LI BOSCH 2x5,0Ah</a></p>
</div>
<div class="product thumbnail clearfix">
  <p class="name"><a href="/strug-akumulatorowy-gho-185-li-bosch-korpus-body.html" class="product_name">Strug akumulatorowy GHO 185-LI BOSCH (korpus, body)</a></p>
</div>`

const PRODUCT_HTML = `
<meta property="og:image" content="https://mistama.com/media/products/40d2ab20/images/thumbnail/big_IMG-5100-100.jpg?lm=1748667450" />
<img src="/media/products/40d2ab20/images/thumbnail/large_IMG-5100-100.jpg?lm=1" />
<a href="/media/products/40d2ab20/images/thumbnail/big_IMG-5100-100.jpg"></a>
<img src="/media/products/40d2ab20/images/thumbnail/large_IMG-5361-100.jpg" />
<img src="/media/products/40d2ab20/images/thumbnail/large_z1.jpg" />
<img src="/media/products/ffffffff/images/thumbnail/large_inne-narzedzie.jpg" />`

test('the products come back in the order the shop ranked them', () => {
  const products = mistamaProducts(SEARCH_HTML)

  assert.equal(products.length, 2)
  assert.equal(products[0].path, '/strug-akumulatorowy-gho-185-li-bosch-2x5-0ah.html')
  assert.equal(products[0].title, 'Strug akumulatorowy GHO 185-LI BOSCH 2x5,0Ah')
})

test('an article is not a product, and nothing found is not a crash', () => {
  // /webpage/... is a guarantee or a buying guide. It has no gallery, so
  // following it would cost two requests to find that out.
  assert.deepEqual(
    mistamaProducts(
      '<a href="/webpage/5-letnia-gwarancja-skil.html" class="product_name">Gwarancja</a>',
    ),
    [],
  )
  assert.deepEqual(mistamaProducts(''), [])
  assert.deepEqual(mistamaProducts('<html><body>Nic nie znaleziono</body></html>'), [])
})

test('the gallery is the originals, listed once each', () => {
  const suggestions = mapMistamaGallery(PRODUCT_HTML, {
    title: 'Pilarka tarczowa',
    url: 'https://mistama.com/pilarka.html',
  })

  // Three pictures, not four: the same one appears as `large_` and as `big_`.
  assert.equal(suggestions.length, 3)
  // The suggestion points at the untouched original; the grid gets `large_`.
  assert.equal(
    suggestions[0].url,
    'https://mistama.com/media/products/40d2ab20/images/IMG-5100-100.jpg',
  )
  assert.equal(
    suggestions[0].thumbnailUrl,
    'https://mistama.com/media/products/40d2ab20/images/thumbnail/large_IMG-5100-100.jpg',
  )
  assert.equal(suggestions[0].sourceUrl, 'https://mistama.com/pilarka.html')
  assert.equal(suggestions[0].provider, 'mistama')
})

test('another product cross-sold on the page contributes nothing', () => {
  // Anchored on the hash in og:image. A suggestion of the wrong machine is
  // worse than one suggestion fewer.
  const suggestions = mapMistamaGallery(PRODUCT_HTML, { title: 'x', url: 'https://mistama.com/x' })

  assert.ok(suggestions.every((s) => !s.url.includes('ffffffff')))
  assert.ok(suggestions.every((s) => !s.url.includes('inne-narzedzie')))
})

test('a page with no og:image yields nothing rather than guessing', () => {
  assert.deepEqual(mapMistamaGallery('<html></html>', { title: 'x', url: 'y' }), [])
  assert.deepEqual(mapMistamaGallery('', { title: 'x', url: 'y' }), [])
})

test('an engine is never asked for more than its provider will give', () => {
  // Google's `num` above ten is a 400 rather than more results, so the number
  // in the settings screen is capped before it can produce one.
  assert.equal(clampResultLimit(searchEngine('google'), 30), 10)
  assert.equal(clampResultLimit(searchEngine('google'), 5), 5)
  // The rest are capped by ours alone.
  assert.equal(clampResultLimit(searchEngine('mistama'), 30), 30)
  assert.equal(clampResultLimit(searchEngine('openverse'), 999), 30)
  // Nonsense lands on something usable rather than throwing at search time.
  assert.equal(clampResultLimit(searchEngine('brave'), 0), 1)
  assert.equal(clampResultLimit(searchEngine('brave'), -4), 1)
  assert.equal(clampResultLimit(searchEngine('brave'), Number.NaN), 10)
  assert.equal(clampResultLimit(searchEngine('brave'), 7.9), 7)
})

test("the merged list holds every engine's share, not one engine's worth", () => {
  // Three engines at their own limits is the sum. Capping the merge at one
  // share is how a third engine could be switched on and change nothing.
  const list = (prefix: string, provider: 'brave' | 'google', size: number) =>
    Array.from({ length: size }, (_, index) => suggestion(`${prefix}${index}`, provider))

  const merged = interleave([list('g', 'google', 4), list('b', 'brave', 12)], 4 + 12)

  assert.equal(merged.length, 16)
})
