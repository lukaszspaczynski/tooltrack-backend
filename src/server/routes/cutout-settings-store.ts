// Reading and writing the cutout configuration.
//
// The same shape as the search engine store, deliberately: a list of methods,
// each either usable or not, plus the credentials behind them. And the same
// precedence rule — a value saved through the screen wins, the environment
// variable is the bootstrap for a container handed a key it should not store.

import { CUTOUT_METHOD_DEFINITIONS, cutoutMethod, type CutoutMethod } from '../cutout-methods'
import { DEFAULT_CUTOUT_OPTIONS } from '../cutout-local'
import { db, type PgPool } from '../db'
import { maskCredential } from '../search-engines'

export type CutoutMethodSettings = {
  // Has whatever it needs to run: a key, or nothing in the local method's case.
  configured: boolean
  // The admin's switch. A method that is off is not offered at all.
  enabled: boolean
  keyHint: string
  keyLabel: string
  keySource: 'database' | 'environment' | 'none'
  label: string
  method: CutoutMethod
  note: string
  requiresKey: boolean
}

export type CutoutSettings = {
  methods: CutoutMethodSettings[]
  threshold: number
  // How many methods the cutout screen can actually offer. Zero means the
  // wand has nothing to run.
  usable: number
}

// What the cutout itself needs: which methods it may use, and the keys.
export type CutoutConfig = {
  allowed: CutoutMethod[]
  geminiKey: string
  removeBgKey: string
  threshold: number
}

type Row = {
  gemini_api_key: string
  gemini_enabled: boolean
  local_enabled: boolean
  remove_bg_api_key: string
  removebg_enabled: boolean
  threshold: number | string
}

async function readRow(pool: PgPool): Promise<null | Row> {
  const result = await pool.query<Row>(
    `SELECT "local_enabled", "removebg_enabled", "gemini_enabled",
            "remove_bg_api_key", "gemini_api_key", "threshold"
     FROM "account"."cutout_setting" WHERE "id"`,
  )

  return result.rows[0] ?? null
}

function envThreshold(): null | number {
  const raw = process.env.TOOLTRACK_CUTOUT_THRESHOLD
  const parsed = Number(raw)
  if (!raw?.trim() || !Number.isInteger(parsed) || parsed <= 0 || parsed > 765) return null
  return parsed
}

function credentialFor(
  method: CutoutMethod,
  row: null | Row,
): { source: 'database' | 'environment' | 'none'; value: string } {
  const definition = cutoutMethod(method)
  if (!definition.requiresKey) return { source: 'none', value: '' }

  const stored =
    (method === 'removebg' ? row?.remove_bg_api_key : row?.gemini_api_key)?.trim() ?? ''
  if (stored) return { source: 'database', value: stored }

  const fromEnv = (definition.envKey ? process.env[definition.envKey] : '')?.trim() ?? ''
  if (fromEnv) return { source: 'environment', value: fromEnv }

  return { source: 'none', value: '' }
}

function enabledFor(method: CutoutMethod, row: null | Row): boolean {
  if (!row) return true
  if (method === 'local') return row.local_enabled
  if (method === 'removebg') return row.removebg_enabled
  return row.gemini_enabled
}

export async function readCutoutSettings(pool: PgPool = db()): Promise<CutoutSettings> {
  const row = await readRow(pool)

  const methods = CUTOUT_METHOD_DEFINITIONS.map((definition) => {
    const credential = credentialFor(definition.method, row)

    return {
      configured: definition.requiresKey ? Boolean(credential.value) : true,
      enabled: enabledFor(definition.method, row),
      keyHint: maskCredential(credential.value),
      keyLabel: definition.keyLabel,
      keySource: credential.source,
      label: definition.label,
      method: definition.method,
      note: definition.note,
      requiresKey: definition.requiresKey,
    }
  })

  return {
    methods,
    threshold: row ? Number(row.threshold) : (envThreshold() ?? DEFAULT_CUTOUT_OPTIONS.threshold),
    usable: methods.filter((entry) => entry.configured && entry.enabled).length,
  }
}

export async function readCutoutConfig(pool: PgPool = db()): Promise<CutoutConfig> {
  const [row, settings] = await Promise.all([readRow(pool), readCutoutSettings(pool)])

  return {
    allowed: settings.methods
      .filter((entry) => entry.configured && entry.enabled)
      .map((entry) => entry.method),
    geminiKey: credentialFor('gemini', row).value,
    removeBgKey: credentialFor('removebg', row).value,
    threshold: settings.threshold,
  }
}

export async function saveCutoutMethod(
  method: CutoutMethod,
  changes: { apiKey?: string; enabled?: boolean },
  actorId: number,
  pool: PgPool = db(),
): Promise<void> {
  // Column names cannot be parameters, so they come from a fixed map — the
  // method was checked against the registry before it got here, and this is
  // the second gate.
  const enabledColumn = {
    gemini: 'gemini_enabled',
    local: 'local_enabled',
    removebg: 'removebg_enabled',
  }[method]
  const keyColumn = { gemini: 'gemini_api_key', local: null, removebg: 'remove_bg_api_key' }[method]

  // The statement and its parameters are built together. The local method has
  // no key column, so a key placeholder must not appear in either: a parameter
  // the statement never mentions is one Postgres cannot type, and the whole
  // request fails with "could not determine data type of parameter $2".
  const writesKey = Boolean(keyColumn) && changes.apiKey !== undefined
  const params: unknown[] = [changes.enabled ?? null]
  if (writesKey) params.push(changes.apiKey)
  params.push(actorId)

  const keyPlaceholder = writesKey ? '$2' : ''
  const actorPlaceholder = writesKey ? '$3' : '$2'

  await pool.query(
    `
      INSERT INTO "account"."cutout_setting"
        ("id", "${enabledColumn}"${writesKey ? `, "${keyColumn}"` : ''}, "updated_by")
      VALUES (true, COALESCE($1, true)${writesKey ? `, ${keyPlaceholder}` : ''}, ${actorPlaceholder})
      ON CONFLICT ("id") DO UPDATE SET
        "${enabledColumn}" = COALESCE($1, "account"."cutout_setting"."${enabledColumn}"),
        ${writesKey ? `"${keyColumn}" = ${keyPlaceholder},` : ''}
        "updated_by" = ${actorPlaceholder},
        "updated_at" = now()
    `,
    params,
  )
}

export async function saveCutoutThreshold(
  threshold: number,
  actorId: number,
  pool: PgPool = db(),
): Promise<void> {
  await pool.query(
    `
      INSERT INTO "account"."cutout_setting" ("id", "threshold", "updated_by")
      VALUES (true, $1, $2)
      ON CONFLICT ("id") DO UPDATE SET
        "threshold" = $1, "updated_by" = $2, "updated_at" = now()
    `,
    [threshold, actorId],
  )
}
