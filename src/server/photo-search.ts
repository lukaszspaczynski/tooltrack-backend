// "Find me pictures of this tool" — the on-demand image search behind
// GET /api/tools/:id/photo-suggestions.
//
// It runs here and not in the browser for three reasons: the API keys stay on
// the server, the browser is not exposed to whatever a provider returns, and
// which engines are used is configuration rather than a frontend release.
//
// Several engines can be enabled at once. They are asked in parallel and every
// one of them contributes up to ten results — the limit is per engine, not per
// search, because two engines switched on should mean twice as much to choose
// from rather than the same ten split between them. The answers are
// interleaved so the first row shows all of them, and an engine that fails
// does not take the others down with it.
//
// Nothing is downloaded here. A suggestion is a link; the bytes are only
// fetched when someone picks one and the server stores it.

import type { SearchCredentials, SearchProvider } from './search-engines'

export type PhotoSuggestion = {
  // Author and licence when the provider states them. Carried through to the
  // stored photo, because an image taken off the web without its attribution
  // is one nobody can defend later.
  attribution: string
  height: null | number
  // The page the image sits on, for anyone who wants to check the source.
  provider: SearchProvider
  sourceUrl: string
  thumbnailUrl: string
  title: string
  url: string
  width: null | number
}

export type PhotoSearchResult = {
  // Which engines actually answered, and which failed — the screen says so
  // rather than quietly showing half a result set.
  failed: { message: string; provider: SearchProvider }[]
  providers: SearchProvider[]
  query: string
  suggestions: PhotoSuggestion[]
}

// Per engine. Three engines enabled means up to thirty suggestions.
export const MAX_SUGGESTIONS_PER_ENGINE = 10

const SEARCH_TIMEOUT_MS = 8000

const USER_AGENT = 'ToolTrack/0.1 (tool catalog; +https://github.com/)'

export class PhotoSearchUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PhotoSearchUnavailableError'
  }
}

// What to search for when the caller does not say. Brand and model are what
// identify the machine; the name alone would find a category, and the notes
// would find nothing.
export function defaultQuery(tool: { brand: string; model: string; name: string }): string {
  const parts = [tool.brand, tool.model].map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) return tool.name.trim()

  return parts.join(' ')
}

// The same question for a case. A case has no model number; what identifies
// it is who makes it and what it is called. The names usually carry the maker
// already ("Qbrick System PRO Toolbox 2.0"), and searching for "Qbrick Qbrick
// System PRO..." finds less than searching for the name alone.
export function defaultCaseQuery(item: { manufacturer: string; name: string }): string {
  const name = item.name.trim()
  const manufacturer = item.manufacturer.trim()

  if (!manufacturer) return name
  if (!name) return manufacturer
  if (name.toLowerCase().includes(manufacturer.toLowerCase())) return name

  return `${manufacturer} ${name}`
}

export type EngineRequest = {
  credentials: SearchCredentials
  provider: SearchProvider
}

export async function searchPhotos(
  query: string,
  engines: EngineRequest[],
  perEngine = MAX_SUGGESTIONS_PER_ENGINE,
): Promise<PhotoSearchResult> {
  const trimmed = query.trim()
  const count = Math.min(Math.max(perEngine, 1), MAX_SUGGESTIONS_PER_ENGINE)

  if (engines.length === 0) {
    throw new PhotoSearchUnavailableError(
      'Żadna wyszukiwarka nie jest włączona — sprawdź Ustawienia',
    )
  }
  if (!trimmed) {
    return {
      failed: [],
      providers: engines.map((e) => e.provider),
      query: trimmed,
      suggestions: [],
    }
  }

  const answers = await Promise.all(
    engines.map(async (engine) => {
      try {
        return { provider: engine.provider, suggestions: await askEngine(engine, trimmed, count) }
      } catch (error) {
        console.error(`[photo-search] ${engine.provider} failed`, error)
        return {
          message: error instanceof Error ? error.message : 'Nieznany błąd',
          provider: engine.provider,
          suggestions: [] as PhotoSuggestion[],
        }
      }
    }),
  )

  const failed = answers
    .filter((answer) => 'message' in answer && answer.message)
    .map((answer) => ({
      message: (answer as { message: string }).message,
      provider: answer.provider,
    }))

  // Everything failed: that is an error, not an empty result set. An empty
  // result set means the engines answered and found nothing.
  //
  // Every failure is named, not just the first. With two engines down for two
  // different reasons — a rejected key and a provider outage — showing one of
  // them sends whoever is reading it to fix the wrong thing.
  if (failed.length === answers.length) {
    throw new PhotoSearchUnavailableError(combineFailures(failed))
  }

  return {
    failed,
    providers: engines.map((engine) => engine.provider),
    query: trimmed,
    // The sum, not one engine's share: two engines switched on mean twice as
    // much to choose from, which is the whole point of switching on a second.
    suggestions: interleave(
      answers.map((answer) => answer.suggestions),
      count * answers.length,
    ),
  }
}

// Pulled out as its own function so the wording is testable without a network:
// what this says is what an operator reads when the button stops working.
export function combineFailures(failed: { message: string; provider: SearchProvider }[]): string {
  if (failed.length === 0) return 'Wyszukiwanie nie powiodło się'
  return failed.map((entry) => entry.message).join(' · ')
}

// Round-robin rather than concatenation: with two engines on, the first screen
// should show both, not ten from one and none from the other.
export function interleave(lists: PhotoSuggestion[][], limit: number): PhotoSuggestion[] {
  const seen = new Set<string>()
  const merged: PhotoSuggestion[] = []

  for (let index = 0; merged.length < limit; index += 1) {
    let exhausted = true

    for (const list of lists) {
      if (index >= list.length) continue
      exhausted = false

      const suggestion = list[index]
      // Two engines finding the same picture is one suggestion.
      if (seen.has(suggestion.url)) continue
      seen.add(suggestion.url)
      merged.push(suggestion)
      if (merged.length >= limit) break
    }

    if (exhausted) break
  }

  return merged
}

function askEngine(
  engine: EngineRequest,
  query: string,
  count: number,
): Promise<PhotoSuggestion[]> {
  switch (engine.provider) {
    case 'brave':
      return brave(engine.credentials, query, count)
    case 'google':
      return google(engine.credentials, query, count)
    case 'mistama':
      return mistama(query, count)
    case 'openverse':
      return openverse(query, count)
  }
}

async function google(
  credentials: SearchCredentials,
  query: string,
  count: number,
): Promise<PhotoSuggestion[]> {
  const url = new URL('https://www.googleapis.com/customsearch/v1')
  url.searchParams.set('key', credentials.key)
  url.searchParams.set('cx', credentials.secret)
  url.searchParams.set('searchType', 'image')
  url.searchParams.set('safe', 'active')
  url.searchParams.set('num', String(count))
  url.searchParams.set('q', query)

  return mapGoogleResults(await callProvider(url, 'google'))
}

async function brave(
  credentials: SearchCredentials,
  query: string,
  count: number,
): Promise<PhotoSuggestion[]> {
  const url = new URL('https://api.search.brave.com/res/v1/images/search')
  url.searchParams.set('q', query)
  url.searchParams.set('count', String(count))
  url.searchParams.set('safesearch', 'strict')

  return mapBraveResults(
    await callProvider(url, 'brave', { 'x-subscription-token': credentials.key }),
  )
}

async function openverse(query: string, count: number): Promise<PhotoSuggestion[]> {
  const url = new URL('https://api.openverse.org/v1/images/')
  url.searchParams.set('q', query)
  url.searchParams.set('page_size', String(count))

  return mapOpenverseResults(await callProvider(url, 'openverse'))
}

// A shop rather than an index: it is asked for the product card and the
// pictures come off that card's gallery. Two hops, so it costs two requests
// and gives back one model photographed from every side at full size —
// exactly what a catalog card wants and what a general image search is worst
// at.
//
// It knows only what the shop sells. That is the trade, and the note on the
// settings screen says so.
const MISTAMA_ORIGIN = 'https://mistama.com'

async function mistama(query: string, count: number): Promise<PhotoSuggestion[]> {
  let product = firstMistamaProduct(await askMistama(query))

  // The shop's search wants every word to match, and a brand it writes
  // differently from us — "BOSCH" against "Bosch Home & Garden" — finds
  // nothing at all. The model is the last thing in the query and the part the
  // shop does index, so a fruitless search is retried on that alone.
  const words = query.split(/\s+/).filter(Boolean)
  if (!product && words.length > 2) {
    product = firstMistamaProduct(await askMistama(words.slice(-2).join(' ')))
  }

  if (!product) return []

  const page = new URL(product.path, MISTAMA_ORIGIN).toString()
  const gallery = mapMistamaGallery(await fetchText(new URL(page), 'mistama'), {
    title: product.title,
    url: page,
  })

  return gallery.slice(0, count)
}

function askMistama(query: string): Promise<string> {
  const url = new URL('/product/search', MISTAMA_ORIGIN)
  url.searchParams.set('query', query)

  return fetchText(url, 'mistama')
}

// The first product the shop ranked, ignoring its articles — /webpage/... is a
// guarantee or a buying guide, never a thing with photographs of a tool.
export function firstMistamaProduct(html: string): null | { path: string; title: string } {
  const match = /<a\s+href="(\/[^"]+\.html)"[^>]*class="product_name"[^>]*>([^<]*)</i.exec(html)
  if (!match || match[1].startsWith('/webpage/')) return null

  return { path: match[1], title: decodeEntities(match[2].trim()) }
}

// The gallery of one product card.
//
// Anchored on the hash in og:image rather than on every product path in the
// page: a card that cross-sells something else would otherwise contribute the
// other tool's photographs, and a suggestion of the wrong machine is worse
// than one fewer suggestion.
//
// The shop serves each picture in three sizes. The grid gets `large_`, which
// is what makes a screen of twenty tiles load, and the suggestion points at
// the untouched original, which is what gets stored when somebody picks it.
export function mapMistamaGallery(
  html: string,
  product: { title: string; url: string },
): PhotoSuggestion[] {
  const ogImage = /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i.exec(html)?.[1] ?? ''
  const hash = /\/media\/products\/([a-f0-9]+)\/images\//i.exec(ogImage)?.[1]
  if (!hash) return []

  const base = `${MISTAMA_ORIGIN}/media/products/${hash}/images`
  const pattern = new RegExp(
    `/media/products/${hash}/images/thumbnail/(?:large|big)_([^"'?\\s]+\\.(?:jpe?g|png|webp))`,
    'gi',
  )

  const seen = new Set<string>()
  const suggestions: PhotoSuggestion[] = []

  for (const match of html.matchAll(pattern)) {
    const name = match[1]
    if (seen.has(name)) continue
    seen.add(name)

    suggestions.push({
      attribution: 'mistama.com',
      // The page states neither, and a number read off a thumbnail name is a
      // number somebody would trust.
      height: null,
      provider: 'mistama' as const,
      sourceUrl: product.url,
      thumbnailUrl: `${base}/thumbnail/large_${name}`,
      title: product.title,
      url: `${base}/${name}`,
      width: null,
    })
  }

  return suggestions
}

// The entities a Polish shop's product name actually contains. A parser for
// the other two thousand would be a dependency for "Bosch &amp; Co".
function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

// Every provider is mapped by a pure function over the parsed JSON, so the
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
        provider: 'google' as const,
        sourceUrl: item.image?.contextLink ?? item.link,
        thumbnailUrl: item.image?.thumbnailLink ?? item.link,
        title: item.title?.trim() ?? '',
        url: item.link,
        width: numberOrNull(item.image?.width),
      },
    ]
  })
}

export function mapBraveResults(payload: unknown): PhotoSuggestion[] {
  const results = asArray((payload as { results?: unknown })?.results)

  return results.flatMap((raw) => {
    const item = raw as {
      properties?: { url?: string }
      source?: string
      thumbnail?: { src?: string }
      title?: string
      url?: string
    }
    // Brave separates the page (`url`) from the image itself
    // (`properties.url`); without the second there is nothing to save.
    const image = item.properties?.url
    if (!image) return []

    return [
      {
        attribution: item.source?.trim() ?? '',
        height: null,
        provider: 'brave' as const,
        sourceUrl: item.url ?? image,
        thumbnailUrl: item.thumbnail?.src ?? image,
        title: item.title?.trim() ?? '',
        url: image,
        width: null,
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
        provider: 'openverse' as const,
        sourceUrl: item.foreign_landing_url ?? item.url,
        // The image itself, not Openverse's `thumbnail` endpoint. That service
        // drops three to five requests in ten — measured, sequentially as well
        // as in parallel — which in a browser is a grid of blank tiles. The
        // original is on the source CDN and answers every time; it costs more
        // bytes, and the grid loads them lazily.
        thumbnailUrl: item.url,
        title: item.title?.trim() ?? '',
        url: item.url,
        width: numberOrNull(item.width),
      },
    ]
  })
}

async function callProvider(
  url: URL,
  provider: SearchProvider,
  headers: Record<string, string> = {},
): Promise<unknown> {
  const response = await call(url, provider, { accept: 'application/json', ...headers })

  try {
    return await response.json()
  } catch {
    throw new PhotoSearchUnavailableError(`${provider}: nieczytelna odpowiedź`)
  }
}

// The same request, read as a page. One engine reads a shop rather than an
// API, and what fails is identical either way — so the deciding is here, once,
// and only the parsing differs.
async function fetchText(url: URL, provider: SearchProvider): Promise<string> {
  const response = await call(url, provider, { accept: 'text/html' })

  try {
    return await response.text()
  } catch {
    throw new PhotoSearchUnavailableError(`${provider}: nieczytelna odpowiedź`)
  }
}

async function call(
  url: URL,
  provider: SearchProvider,
  headers: Record<string, string>,
): Promise<Response> {
  let response: Response
  try {
    response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, ...headers },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    })
  } catch {
    throw new PhotoSearchUnavailableError(`${provider}: brak odpowiedzi`)
  }

  if (!response.ok) {
    // The provider's own message is not shown: it can carry the API key back,
    // and it is written for us rather than for whoever clicked the button.
    console.error(`[photo-search] ${url.host} answered ${response.status}`)
    throw new PhotoSearchUnavailableError(
      response.status === 429
        ? `${provider}: wyczerpany limit zapytań`
        : response.status === 401 || response.status === 403
          ? `${provider}: klucz odrzucony (${response.status})`
          : `${provider}: błąd ${response.status}`,
    )
  }

  return response
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function numberOrNull(value: unknown): null | number {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
