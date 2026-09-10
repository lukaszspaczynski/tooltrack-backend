import assert from 'node:assert/strict'
import test from 'node:test'

import {
  defaultQuery,
  mapGoogleResults,
  mapOpenverseResults,
  photoSearchProvider,
  PhotoSearchUnavailableError,
} from './photo-search'

function withEnv(values: Record<string, string | undefined>, fn: () => void): void {
  const previous: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    fn()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('the query identifies the machine, not the category', () => {
  assert.equal(
    defaultQuery({ brand: 'Bosch Professional', model: 'GWS 180-LI', name: 'Szlifierka kątowa' }),
    'Bosch Professional GWS 180-LI',
  )
  // With nothing to identify it by, the name is all there is.
  assert.equal(defaultQuery({ brand: '', model: '', name: 'Młotek' }), 'Młotek')
  assert.equal(defaultQuery({ brand: 'Makita', model: '', name: 'Wiertarka' }), 'Makita')
})

test('Openverse is the provider until Google is configured', () => {
  withEnv(
    {
      GOOGLE_SEARCH_API_KEY: undefined,
      GOOGLE_SEARCH_CX: undefined,
      TOOLTRACK_PHOTO_SEARCH: undefined,
    },
    () => assert.equal(photoSearchProvider(), 'openverse'),
  )

  withEnv(
    { GOOGLE_SEARCH_API_KEY: 'k', GOOGLE_SEARCH_CX: 'c', TOOLTRACK_PHOTO_SEARCH: undefined },
    () => assert.equal(photoSearchProvider(), 'google'),
  )

  // Half-configured Google is refused by name rather than silently falling
  // back: a deploy that meant to use Google should say so, not quietly return
  // stock photography.
  withEnv(
    { GOOGLE_SEARCH_API_KEY: 'k', GOOGLE_SEARCH_CX: undefined, TOOLTRACK_PHOTO_SEARCH: 'google' },
    () => assert.throws(() => photoSearchProvider(), PhotoSearchUnavailableError),
  )

  withEnv({ TOOLTRACK_PHOTO_SEARCH: 'none' }, () => assert.equal(photoSearchProvider(), 'none'))
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
      // No link, no image: dropped rather than turned into a broken tile.
      { title: 'Bez adresu' },
    ],
  })

  assert.equal(suggestions.length, 1)
  assert.deepEqual(suggestions[0], {
    attribution: 'bosch-professional.com',
    height: 800,
    sourceUrl: 'https://www.bosch-professional.com/gws-180-li',
    thumbnailUrl: 'https://encrypted-tbn0.gstatic.com/thumb.jpg',
    title: 'GWS 180-LI',
    url: 'https://www.bosch-professional.com/gws.jpg',
    width: 1200,
  })
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
  assert.equal(suggestions[0].url, 'https://live.staticflickr.com/4127/4999892463.jpg')
})

test('an unexpected payload is an empty list, not a crash', () => {
  for (const payload of [null, undefined, {}, { items: 'nope' }, { results: null }, []]) {
    assert.deepEqual(mapGoogleResults(payload), [])
    assert.deepEqual(mapOpenverseResults(payload), [])
  }
})
