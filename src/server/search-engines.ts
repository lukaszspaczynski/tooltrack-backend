// The catalogue of image search providers: what each one is called, what it
// needs to work, and where its credentials come from.
//
// Pure and free of I/O, because three different places have to agree about it
// — the settings screen, the store that holds the keys, and the search itself.

export const SEARCH_PROVIDERS = ['google', 'brave', 'openverse', 'mistama'] as const

export type SearchProvider = (typeof SEARCH_PROVIDERS)[number]

// How many pictures one engine may contribute to a search. Configurable per
// engine because they differ in what they are good for: an index that finds
// ten plausible pictures has said all it has to say, while a shop's product
// card holds twenty photographs of the one right machine.
export const DEFAULT_RESULT_LIMIT = 10
export const MAX_RESULT_LIMIT = 30

export type SearchEngineDefinition = {
  // Which environment variables seed this engine when the database has no
  // credentials for it yet. Configuration moved into the database so an admin
  // can change it without a deploy; the variables stay as the bootstrap and
  // the way a container can be handed a key it never stores.
  envKey?: string
  envSecret?: string
  keyLabel: string
  label: string
  // Lower than MAX_RESULT_LIMIT when the provider itself refuses to return
  // more. Only set where that is documented rather than guessed.
  maxResults?: number
  note: string
  provider: SearchProvider
  requiresKey: boolean
  requiresSecret: boolean
  secretLabel: string
}

export const SEARCH_ENGINES: readonly SearchEngineDefinition[] = [
  {
    envKey: 'GOOGLE_SEARCH_API_KEY',
    envSecret: 'GOOGLE_SEARCH_CX',
    keyLabel: 'Klucz API',
    label: 'Google Custom Search',
    // The API's own ceiling: `num` above ten is a 400, not more results.
    maxResults: 10,
    note: 'Najlepsze wyniki dla konkretnych modeli. Wymaga klucza z Google Cloud i identyfikatora wyszukiwarki (cx). Darmowe 100 zapytań dziennie.',
    provider: 'google',
    requiresKey: true,
    requiresSecret: true,
    secretLabel: 'Identyfikator wyszukiwarki (cx)',
  },
  {
    envKey: 'BRAVE_SEARCH_API_KEY',
    keyLabel: 'Klucz API (X-Subscription-Token)',
    label: 'Brave Search',
    note: 'Wyszukiwarka grafiki z własnym indeksem. Klucz z api-dashboard.search.brave.com, darmowy pakiet miesięczny.',
    provider: 'brave',
    requiresKey: true,
    requiresSecret: false,
    secretLabel: '',
  },
  {
    keyLabel: '',
    label: 'mistama.com',
    note: 'Sklep z elektronarzędziami. Nie szuka obrazków w sieci — znajduje kartę produktu i bierze zdjęcia z jej galerii, więc dostaje się komplet ujęć jednego modelu w pełnej rozdzielczości. Bez klucza. Zna tylko to, czym sklep handluje.',
    provider: 'mistama',
    requiresKey: false,
    requiresSecret: false,
    secretLabel: '',
  },
  {
    keyLabel: '',
    label: 'Openverse',
    note: 'Bez klucza, działa od razu. Indeksuje zdjęcia na wolnych licencjach, więc znajdzie „szlifierkę kątową”, ale nie „GWS 180-LI”.',
    provider: 'openverse',
    requiresKey: false,
    requiresSecret: false,
    secretLabel: '',
  },
]

// What this engine may actually be asked for. The stored setting is trusted
// no further than the provider's own limit, so raising the number in the
// screen can never turn a search into a rejected request.
export function clampResultLimit(engine: SearchEngineDefinition, value: number): number {
  const ceiling = Math.min(engine.maxResults ?? MAX_RESULT_LIMIT, MAX_RESULT_LIMIT)
  if (!Number.isFinite(value)) return Math.min(DEFAULT_RESULT_LIMIT, ceiling)

  return Math.min(Math.max(Math.trunc(value), 1), ceiling)
}

export function isSearchProvider(value: unknown): value is SearchProvider {
  return typeof value === 'string' && (SEARCH_PROVIDERS as readonly string[]).includes(value)
}

export function searchEngine(provider: SearchProvider): SearchEngineDefinition {
  const engine = SEARCH_ENGINES.find((candidate) => candidate.provider === provider)
  if (!engine) throw new Error(`Unknown search provider: ${provider}`)
  return engine
}

export type SearchCredentials = {
  key: string
  secret: string
}

// An engine can run when it is switched on and has whatever it needs.
// Openverse and mistama need nothing, which is why those two are what works on
// a fresh install.
export function isUsable(
  engine: SearchEngineDefinition,
  credentials: SearchCredentials,
  enabled: boolean,
): boolean {
  if (!enabled) return false
  if (engine.requiresKey && !credentials.key.trim()) return false
  if (engine.requiresSecret && !credentials.secret.trim()) return false
  return true
}

// What the settings screen may see. Never the credentials themselves: a key
// that has been saved can be replaced, but it is never read back out of the
// server — not to the admin who typed it, not to anyone.
export function maskCredential(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.length <= 4) return '••••'
  return `••••${trimmed.slice(-4)}`
}
