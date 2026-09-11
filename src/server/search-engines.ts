// The catalogue of image search providers: what each one is called, what it
// needs to work, and where its credentials come from.
//
// Pure and free of I/O, because three different places have to agree about it
// — the settings screen, the store that holds the keys, and the search itself.

export const SEARCH_PROVIDERS = ['google', 'brave', 'openverse'] as const

export type SearchProvider = (typeof SEARCH_PROVIDERS)[number]

export type SearchEngineDefinition = {
  // Which environment variables seed this engine when the database has no
  // credentials for it yet. Configuration moved into the database so an admin
  // can change it without a deploy; the variables stay as the bootstrap and
  // the way a container can be handed a key it never stores.
  envKey?: string
  envSecret?: string
  keyLabel: string
  label: string
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
    label: 'Openverse',
    note: 'Bez klucza, działa od razu. Indeksuje zdjęcia na wolnych licencjach, więc znajdzie „szlifierkę kątową”, ale nie „GWS 180-LI”.',
    provider: 'openverse',
    requiresKey: false,
    requiresSecret: false,
    secretLabel: '',
  },
]

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

// An engine can run when it is switched on and has whatever it needs. Openverse
// needs nothing, which is why it is the one that works on a fresh install.
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
