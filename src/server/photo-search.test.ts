import assert from 'node:assert/strict'
import test from 'node:test'

import {
  combineFailures,
  defaultQuery,
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
    defaultQuery({ brand: 'Bosch Professional', model: 'GWS 180-LI', name: 'Szlifierka kątowa' }),
    'Bosch Professional GWS 180-LI',
  )
  assert.equal(defaultQuery({ brand: '', model: '', name: 'Młotek' }), 'Młotek')
  assert.equal(defaultQuery({ brand: 'Makita', model: '', name: 'Wiertarka' }), 'Makita')
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
