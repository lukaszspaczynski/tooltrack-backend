// Reading and writing search engine configuration: the global rows an admin
// owns, and the per-account switches each user owns.
//
// The precedence rule lives here and nowhere else: a credential saved in the
// database wins, and the environment variable is what an engine falls back to
// when nobody has configured it through the screen. That is what lets a
// container be handed a key it never stores while an admin can still change it
// without a deploy.

import { db, type PgPool } from '../db'
import {
  isUsable,
  maskCredential,
  SEARCH_ENGINES,
  searchEngine,
  type SearchCredentials,
  type SearchProvider,
} from '../search-engines'

export type EngineSettings = {
  // What the settings screen shows. `configured` is the answer to "will this
  // engine run", and it is derived here rather than guessed by the client.
  configured: boolean
  globallyEnabled: boolean
  keyHint: string
  // What to call the two credential fields. They come from the registry so the
  // screen does not have to know that Google's second field is a search engine
  // id and Brave has none.
  keyLabel: string
  keySource: 'database' | 'environment' | 'none'
  label: string
  note: string
  provider: SearchProvider
  requiresKey: boolean
  requiresSecret: boolean
  secretHint: string
  secretLabel: string
  // The caller's own switch. Absent row means on.
  usedByMe: boolean
}

type GlobalRow = {
  api_key: string
  api_secret: string
  enabled: boolean
  provider: string
}

async function globalRows(pool: PgPool): Promise<Map<SearchProvider, GlobalRow>> {
  const result = await pool.query<GlobalRow>(
    `SELECT "provider", "enabled", "api_key", "api_secret" FROM "account"."search_engine"`,
  )

  return new Map(result.rows.map((row) => [row.provider as SearchProvider, row]))
}

async function userRows(userId: number, pool: PgPool): Promise<Map<SearchProvider, boolean>> {
  const result = await pool.query<{ enabled: boolean; provider: string }>(
    `SELECT "provider", "enabled" FROM "account"."user_search_engine" WHERE "user_id" = $1`,
    [userId],
  )

  return new Map(result.rows.map((row) => [row.provider as SearchProvider, row.enabled]))
}

function credentialsFor(
  provider: SearchProvider,
  row: undefined | GlobalRow,
): { credentials: SearchCredentials; source: EngineSettings['keySource'] } {
  const engine = searchEngine(provider)

  const stored = { key: row?.api_key?.trim() ?? '', secret: row?.api_secret?.trim() ?? '' }
  if (stored.key || stored.secret) return { credentials: stored, source: 'database' }

  const fromEnv = {
    key: (engine.envKey ? process.env[engine.envKey] : '')?.trim() ?? '',
    secret: (engine.envSecret ? process.env[engine.envSecret] : '')?.trim() ?? '',
  }
  if (fromEnv.key || fromEnv.secret) return { credentials: fromEnv, source: 'environment' }

  return { credentials: { key: '', secret: '' }, source: 'none' }
}

export async function listEngineSettings(
  userId: number,
  pool: PgPool = db(),
): Promise<EngineSettings[]> {
  const [globals, mine] = await Promise.all([globalRows(pool), userRows(userId, pool)])

  return SEARCH_ENGINES.map((engine) => {
    const row = globals.get(engine.provider)
    const { credentials, source } = credentialsFor(engine.provider, row)
    const globallyEnabled = row?.enabled ?? true

    return {
      configured: isUsable(engine, credentials, true),
      globallyEnabled,
      keyHint: maskCredential(credentials.key),
      keyLabel: engine.keyLabel,
      keySource: source,
      label: engine.label,
      note: engine.note,
      provider: engine.provider,
      requiresKey: engine.requiresKey,
      requiresSecret: engine.requiresSecret,
      secretHint: maskCredential(credentials.secret),
      secretLabel: engine.secretLabel,
      usedByMe: mine.get(engine.provider) ?? true,
    }
  })
}

// The engines a given account's search actually runs against: switched on
// globally, switched on by that account, and holding whatever credentials they
// need. An empty list is the answer to "why is the button greyed out".
export async function resolveProvidersFor(
  userId: number,
  pool: PgPool = db(),
): Promise<SearchProvider[]> {
  const settings = await listEngineSettings(userId, pool)

  return settings
    .filter((entry) => entry.configured && entry.globallyEnabled && entry.usedByMe)
    .map((entry) => entry.provider)
}

// Credentials are fetched separately from the settings list so that the list —
// the thing that goes to a browser — never carries them in the first place.
export async function credentialsForSearch(
  providers: SearchProvider[],
  pool: PgPool = db(),
): Promise<Map<SearchProvider, SearchCredentials>> {
  const globals = await globalRows(pool)

  return new Map(
    providers.map((provider) => [
      provider,
      credentialsFor(provider, globals.get(provider)).credentials,
    ]),
  )
}

export async function saveGlobalEngine(
  provider: SearchProvider,
  changes: { apiKey?: string; apiSecret?: string; enabled?: boolean },
  actorId: number,
  pool: PgPool = db(),
): Promise<void> {
  // An omitted field keeps what is stored; an empty string clears it. That is
  // the difference between "I did not touch the key" and "remove this key",
  // and the settings form relies on it: it never sends a key back that it
  // never received.
  await pool.query(
    `
      INSERT INTO "account"."search_engine" ("provider", "enabled", "api_key", "api_secret", "updated_by")
      VALUES ($1, COALESCE($2, true), COALESCE($3, ''), COALESCE($4, ''), $5)
      ON CONFLICT ("provider") DO UPDATE SET
        "enabled" = COALESCE($2, "account"."search_engine"."enabled"),
        "api_key" = COALESCE($3, "account"."search_engine"."api_key"),
        "api_secret" = COALESCE($4, "account"."search_engine"."api_secret"),
        "updated_by" = $5,
        "updated_at" = now()
    `,
    [provider, changes.enabled ?? null, changes.apiKey ?? null, changes.apiSecret ?? null, actorId],
  )
}

export async function saveUserEngine(
  userId: number,
  provider: SearchProvider,
  enabled: boolean,
  pool: PgPool = db(),
): Promise<void> {
  await pool.query(
    `
      INSERT INTO "account"."user_search_engine" ("user_id", "provider", "enabled")
      VALUES ($1, $2, $3)
      ON CONFLICT ("user_id", "provider") DO UPDATE SET "enabled" = $3, "updated_at" = now()
    `,
    [userId, provider, enabled],
  )
}
