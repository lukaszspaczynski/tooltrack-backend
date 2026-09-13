// Everything that touches `catalog.manual` and `catalog.manual_tool`.
// src/server/manual-storage.ts owns the bytes; this module owns the rows.
//
// A manual row is one document, once. Which tools it belongs to lives in the
// link table, so one PDF can be the manual of three identical grinders with
// its title and its provenance written down a single time.

import { db, withTransaction, type PgPool } from '../db'
import { t } from '../i18n'
import { deleteManualFile, type StoredManual } from '../manual-storage'

export const MANUAL_SOURCES = ['upload', 'url', 'import'] as const

export type ManualSource = (typeof MANUAL_SOURCES)[number]

export type Manual = {
  byteSize: number
  createdAt: string
  createdBy: null | number
  id: number
  source: ManualSource
  sourceUrl: string
  title: string
  // Where the bytes are served from. By the manual's own id, because it is not
  // reached through any one card.
  url: string
}

export type StoredManualRow = Manual & {
  checksum: string
  storageKey: string
}

export class ManualAlreadyOnCardError extends Error {
  constructor() {
    super(t('Ta instrukcja jest już na tej karcie'))
    this.name = 'ManualAlreadyOnCardError'
  }
}

type ManualRow = {
  byte_size: number | string
  checksum: string
  created_at: Date | string
  created_by: null | number | string
  id: number | string
  source: string
  source_url: string
  storage_key: string
  title: string
}

const MANUAL_COLUMNS = `
  "id", "storage_key", "checksum", "byte_size", "title", "source", "source_url",
  "created_by", "created_at"
`

const PREFIXED_COLUMNS = MANUAL_COLUMNS.split(',')
  .map((column) => `"m".${column.trim()}`)
  .join(', ')

export function manualUrl(manualId: number): string {
  return `/api/manuals/${manualId}/file`
}

export async function listManuals(toolId: number, pool: PgPool = db()): Promise<Manual[]> {
  const result = await pool.query<ManualRow>(
    `
      SELECT ${PREFIXED_COLUMNS}
      FROM "catalog"."manual_tool" AS "l"
      JOIN "catalog"."manual" AS "m" ON "m"."id" = "l"."manual_id"
      WHERE "l"."tool_id" = $1
      ORDER BY "l"."created_at" ASC, "m"."id" ASC
    `,
    [toolId],
  )

  return result.rows.map(toManual)
}

export async function getManualById(
  manualId: number,
  pool: PgPool = db(),
): Promise<null | StoredManualRow> {
  const result = await pool.query<ManualRow>(
    `SELECT ${MANUAL_COLUMNS} FROM "catalog"."manual" WHERE "id" = $1`,
    [manualId],
  )

  const row = result.rows[0]
  return row ? toStored(row) : null
}

// Writes the document, or finds the one already written. The checksum is
// unique, so the same manual arriving from an upload and from the maker's
// website is one row — and the title of the first one stands, because it is
// the one somebody has already corrected.
export async function insertManual(
  input: {
    source: ManualSource
    sourceUrl?: string
    stored: StoredManual
    title: string
  },
  actorId: number,
  pool: PgPool = db(),
): Promise<Manual> {
  const result = await pool.query<ManualRow>(
    `
      INSERT INTO "catalog"."manual"
        ("storage_key", "checksum", "byte_size", "title", "source", "source_url", "created_by")
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT ("checksum") DO NOTHING
      RETURNING ${MANUAL_COLUMNS}
    `,
    [
      input.stored.storageKey,
      input.stored.checksum,
      input.stored.byteSize,
      input.title,
      input.source,
      input.sourceUrl ?? '',
      actorId,
    ],
  )

  if (result.rows[0]) return toManual(result.rows[0])

  const existing = await pool.query<ManualRow>(
    `SELECT ${MANUAL_COLUMNS} FROM "catalog"."manual" WHERE "checksum" = $1`,
    [input.stored.checksum],
  )

  return toManual(existing.rows[0])
}

export async function linkManual(
  toolId: number,
  manualId: number,
  actorId: number,
  pool: PgPool = db(),
): Promise<void> {
  const result = await pool.query(
    `
      INSERT INTO "catalog"."manual_tool" ("tool_id", "manual_id", "created_by")
      VALUES ($1, $2, $3)
      ON CONFLICT DO NOTHING
    `,
    [toolId, manualId, actorId],
  )

  if ((result.rowCount ?? 0) === 0) throw new ManualAlreadyOnCardError()
}

export async function renameManual(
  toolId: number,
  manualId: number,
  title: string,
  pool: PgPool = db(),
): Promise<null | Manual> {
  // Scoped by the card as well: the id in the path came from somewhere, but
  // not necessarily from a card this person was looking at.
  const result = await pool.query<ManualRow>(
    `
      UPDATE "catalog"."manual" AS "m"
      SET "title" = $3
      WHERE "m"."id" = $2
        AND EXISTS (
          SELECT 1 FROM "catalog"."manual_tool"
          WHERE "manual_id" = "m"."id" AND "tool_id" = $1
        )
      RETURNING ${MANUAL_COLUMNS}
    `,
    [toolId, manualId, title],
  )

  const row = result.rows[0]
  return row ? toManual(row) : null
}

// Taking a manual off a card. The document itself goes when no card keeps it
// any more — a bin on a card has to mean the file is gone rather than that it
// moved to a library nobody asked to fill.
export async function unlinkManual(
  toolId: number,
  manualId: number,
  pool: PgPool = db(),
): Promise<boolean> {
  return withTransaction(pool, async (client) => {
    const removed = await client.query(
      `DELETE FROM "catalog"."manual_tool" WHERE "tool_id" = $1 AND "manual_id" = $2`,
      [toolId, manualId],
    )

    if ((removed.rowCount ?? 0) === 0) return false

    for (const key of await dropIfUnused(client, [manualId])) await deleteManualFile(key)

    return true
  })
}

// Called when a whole tool goes: its links cascade away with it, and this
// clears the documents nothing keeps any more.
export async function dropOrphanedManuals(
  manualIds: number[],
  pool: PgPool = db(),
): Promise<number> {
  if (manualIds.length === 0) return 0

  const keys = await withTransaction(pool, (client) => dropIfUnused(client, manualIds))
  for (const key of keys) await deleteManualFile(key)

  return keys.length
}

export async function manualIdsOf(toolId: number, pool: PgPool = db()): Promise<number[]> {
  const result = await pool.query<{ manual_id: number | string }>(
    `SELECT "manual_id" FROM "catalog"."manual_tool" WHERE "tool_id" = $1`,
    [toolId],
  )

  return result.rows.map((row) => Number(row.manual_id))
}

// Puts every manual one card keeps onto another. Cheap now that a pairing is a
// row: a duplicated card costs a link rather than a second copy of a 7 MB PDF.
export async function copyManualLinks(
  fromToolId: number,
  toToolId: number,
  actorId: number,
  pool: PgPool = db(),
): Promise<number> {
  const result = await pool.query(
    `
      INSERT INTO "catalog"."manual_tool" ("tool_id", "manual_id", "created_by")
      SELECT $2, "manual_id", $3
      FROM "catalog"."manual_tool"
      WHERE "tool_id" = $1
      ON CONFLICT DO NOTHING
    `,
    [fromToolId, toToolId, actorId],
  )

  return result.rowCount ?? 0
}

// The manuals this card is the only keeper of: what deleting it would take
// with it. The same question the photographs answer before a delete.
export async function exclusiveManualIds(toolId: number, pool: PgPool = db()): Promise<number[]> {
  const result = await pool.query<{ manual_id: number | string }>(
    `
      SELECT "l"."manual_id"
      FROM "catalog"."manual_tool" AS "l"
      WHERE "l"."tool_id" = $1
        AND NOT EXISTS (
          SELECT 1 FROM "catalog"."manual_tool" AS "other"
          WHERE "other"."manual_id" = "l"."manual_id" AND "other"."tool_id" <> $1
        )
    `,
    [toolId],
  )

  return result.rows.map((row) => Number(row.manual_id))
}

async function dropIfUnused(
  client: { query: PgPool['query'] },
  manualIds: number[],
): Promise<string[]> {
  if (manualIds.length === 0) return []

  const deleted = await client.query<{ storage_key: string }>(
    `
      DELETE FROM "catalog"."manual" AS "m"
      WHERE "m"."id" = ANY($1::bigint[])
        AND NOT EXISTS (SELECT 1 FROM "catalog"."manual_tool" WHERE "manual_id" = "m"."id")
      RETURNING "storage_key"
    `,
    [manualIds],
  )

  const keys = [...new Set(deleted.rows.map((row) => row.storage_key))]
  if (keys.length === 0) return []

  // The same bytes may be a second row under another checksum-equal name —
  // they are not, since the checksum is the key, but a file is only unlinked
  // when nothing at all points at it.
  const stillUsed = await client.query<{ storage_key: string }>(
    `SELECT DISTINCT "storage_key" FROM "catalog"."manual" WHERE "storage_key" = ANY($1::text[])`,
    [keys],
  )
  const used = new Set(stillUsed.rows.map((row) => row.storage_key))

  return keys.filter((key) => !used.has(key))
}

function toManual(row: ManualRow): Manual {
  return {
    byteSize: Number(row.byte_size),
    createdAt: toIsoString(row.created_at),
    createdBy: row.created_by === null ? null : Number(row.created_by),
    id: Number(row.id),
    source: isManualSource(row.source) ? row.source : 'upload',
    sourceUrl: row.source_url,
    title: row.title,
    url: manualUrl(Number(row.id)),
  }
}

function toStored(row: ManualRow): StoredManualRow {
  return { ...toManual(row), checksum: row.checksum, storageKey: row.storage_key }
}

function isManualSource(value: string): value is ManualSource {
  return (MANUAL_SOURCES as readonly string[]).includes(value)
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
