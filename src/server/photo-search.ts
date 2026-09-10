// "Find me pictures of this tool" — the on-demand image search behind
// GET /api/tools/:id/photo-suggestions.
//
// It runs here and not in the browser for three reasons: the API key stays on
// the server, the browser is not exposed to whatever a search provider returns,
// and swapping the provider is a deploy variable rather than a frontend
// release. The client only ever sees the normalised list below.
//
// Nothing is downloaded at this point. A suggestion is a link; the bytes are
// only fetched when someone picks one and the server stores it.

export type PhotoSuggestion = {
  // Author and licence when the provider states them. Carried through to the
  // stored photo, because an image taken off the web without its attribution
  // is one nobody can defend later.
  attribution: string
  height: null | number
  // The page the image sits on, for anyone who wants to check the source.
  sourceUrl: string
  thumbnailUrl: string
  title: string
  url: string
  width: null | number
}

export type PhotoSearchResult = {
  provider: PhotoSearchProvider
  query: string
  suggestions: PhotoSuggestion[]
}

export type PhotoSearchProvider = 'google' | 'none' | 'openverse'

export const MAX_SUGGESTIONS = 10

const SEARCH_TIMEOUT_MS = 8000

const USER_AGENT = 'ToolTrack/0.1 (tool catalog; +https://github.com/)'

export class PhotoSearchUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PhotoSearchUnavailableError'
  }
}

// Google Custom Search when it is configured, Openverse otherwise. Openverse
// needs no key and therefore works on a fresh checkout, but it indexes openly
// licensed photography — it will find "angle grinder", not "GWS 180-LI".
// Google is what makes the feature useful for specific models; see README.
export function photoSearchProvider(): PhotoSearchProvider {
  const configured = process.env.TOOLTRACK_PHOTO_SEARCH?.trim().toLowerCase()
  if (configured === 'none') return 'none'
  if (configured === 'openverse') return 'openverse'

  const hasGoogleKeys = Boolean(
    process.env.GOOGLE_SEARCH_API_KEY?.trim() && process.env.GOOGLE_SEARCH_CX?.trim(),
  )
  if (configured === 'google') {
    if (!hasGoogleKeys) {
      throw new PhotoSearchUnavailableError(
        'Wyszukiwanie zdjęć ustawione na Google, ale brakuje GOOGLE_SEARCH_API_KEY lub GOOGLE_SEARCH_CX',
      )
    }
    return 'google'
  }

  return hasGoogleKeys ? 'google' : 'openverse'
}

// What to search for when the caller does not say. Brand and model are what
// identify the machine; the name alone would find a category, and the notes
// would find nothing.
export function defaultQuery(tool: { brand: string; model: string; name: string }): string {
  const parts = [tool.brand, tool.model].map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) return tool.name.trim()

  return parts.join(' ')
}

export async function searchPhotos(
  query: string,
  limit = MAX_SUGGESTIONS,
): Promise<PhotoSearchResult> {
  const trimmed = query.trim()
  const provider = photoSearchProvider()
  const count = Math.min(Math.max(limit, 1), MAX_SUGGESTIONS)

  if (provider === 'none') {
    throw new PhotoSearchUnavailableError('Wyszukiwanie zdjęć jest wyłączone na tym serwerze')
  }
  if (!trimmed) return { provider, query: trimmed, suggestions: [] }

  const suggestions =
    provider === 'google'
      ? mapGoogleResults(await callProvider(googleUrl(trimmed, count)))
      : mapOpenverseResults(await callProvider(openverseUrl(trimmed, count)))

  return { provider, query: trimmed, suggestions: suggestions.slice(0, count) }
}

// Both providers are mapped by pure functions over the parsed JSON, so the
// shape each one returns is pinned by a test rather than discovered in
// production.
export function mapGoogleResults(payload: unknown): PhotoSuggestion[] {
  const items = asArray((payload as { items?: unknown })?.items)

  return items.flatMap((raw) => {
    const item = raw as {
      displayLink?: string
      image?: { contextLink?: string; height?: number; thumbnailLink?: string; width?: number }
      link?: string
      title?: string
    }
    if (!item.link) return []

    return [
      {
        attribution: item.displayLink?.trim() ?? '',
        height: numberOrNull(item.image?.height),
        sourceUrl: item.image?.contextLink ?? item.link,
        thumbnailUrl: item.image?.thumbnailLink ?? item.link,
        title: item.title?.trim() ?? '',
        url: item.link,
        width: numberOrNull(item.image?.width),
      },
    ]
  })
}

export function mapOpenverseResults(payload: unknown): PhotoSuggestion[] {
  const results = asArray((payload as { results?: unknown })?.results)

  return results.flatMap((raw) => {
    const item = raw as {
      creator?: string
      foreign_landing_url?: string
      height?: number
      license?: string
      license_version?: string
      thumbnail?: string
      title?: string
      url?: string
      width?: number
    }
    if (!item.url) return []

    const licence = [item.license?.toUpperCase(), item.license_version].filter(Boolean).join(' ')

    return [
      {
        attribution: [item.creator, licence && `CC ${licence}`].filter(Boolean).join(' · '),
        height: numberOrNull(item.height),
        sourceUrl: item.foreign_landing_url ?? item.url,
        thumbnailUrl: item.thumbnail ?? item.url,
        title: item.title?.trim() ?? '',
        url: item.url,
        width: numberOrNull(item.width),
      },
    ]
  })
}

function googleUrl(query: string, count: number): URL {
  const url = new URL('https://www.googleapis.com/customsearch/v1')
  url.searchParams.set('key', process.env.GOOGLE_SEARCH_API_KEY ?? '')
  url.searchParams.set('cx', process.env.GOOGLE_SEARCH_CX ?? '')
  url.searchParams.set('searchType', 'image')
  url.searchParams.set('safe', 'active')
  url.searchParams.set('num', String(count))
  url.searchParams.set('q', query)
  return url
}

function openverseUrl(query: string, count: number): URL {
  const url = new URL('https://api.openverse.org/v1/images/')
  url.searchParams.set('q', query)
  url.searchParams.set('page_size', String(count))
  return url
}

async function callProvider(url: URL): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    })
  } catch {
    throw new PhotoSearchUnavailableError(unavailableMessage('Wyszukiwarka zdjęć nie odpowiada'))
  }

  if (!response.ok) {
    // The provider's own message is not shown: it can carry the API key back,
    // and it is written for us rather than for whoever clicked the button.
    console.error(`[photo-search] ${url.host} answered ${response.status}`)
    throw new PhotoSearchUnavailableError(
      unavailableMessage(
        response.status === 429
          ? 'Wyczerpany limit zapytań do wyszukiwarki'
          : 'Wyszukiwarka zdjęć odpowiedziała błędem',
      ),
    )
  }

  try {
    return await response.json()
  } catch {
    throw new PhotoSearchUnavailableError('Wyszukiwarka zdjęć zwróciła nieczytelną odpowiedź')
  }
}

// Openverse is the fallback precisely because it needs no key, and it rations
// anonymous callers accordingly. When it is the one failing, the message says
// what to do about it instead of leaving someone to retry a button that will
// keep not working.
function unavailableMessage(reason: string): string {
  if (photoSearchProvider() !== 'openverse') return reason

  return `${reason}. Darmowe wyszukiwanie (Openverse) ma niski limit zapytań — ustaw GOOGLE_SEARCH_API_KEY i GOOGLE_SEARCH_CX, żeby korzystać z Google.`
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function numberOrNull(value: unknown): null | number {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
