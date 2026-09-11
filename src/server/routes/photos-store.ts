// Everything that touches `catalog.tool_photo`. The bytes are handled by
// src/server/photo-storage.ts; this module owns the rows that describe them.

import { db, withTransaction, type PgPool } from '../db'
import { deletePhotoFile, type StoredPhoto } from '../photo-storage'
import type { ImageMetadata } from '../image-metadata'

export const PHOTO_SOURCES = ['upload', 'url', 'search', 'edit'] as const

export type PhotoSource = (typeof PHOTO_SOURCES)[number]

export type ToolPhoto = {
  attribution: string
  byteSize: number
  contentType: string
  createdAt: string
  createdBy: null | number
  // The photo this one was cut out from, when source is 'edit'. The original
  // is never touched, so an unconvincing cutout is one delete away from undone.
  derivedFrom: null | number
  height: null | number
  id: number
  isPrimary: boolean
  source: PhotoSource
  sourceUrl: string
  toolId: number
  // Where the bytes are served from. The client never sees the storage key:
  // that is an implementation detail of where files happen to live today.
  url: string
  width: null | number
}

// What the file-serving route needs on top of what a client sees: where the
// bytes are and what they hash to. Neither is part of the API surface — the
// storage layout is ours to change.
export type StoredPhotoRow = ToolPhoto & {
  checksum: string
  storageKey: string
}

export class PhotoAlreadyExistsError extends Error {
  constructor() {
    super('To zdjęcie jest już przypisane do tego narzędzia')
    this.name = 'PhotoAlreadyExistsError'
  }
}

type PhotoRow = {
  attribution: string
  byte_size: number | string
  checksum: string
  content_type: string
  created_at: Date | string
  created_by: null | number | string
  derived_from: null | number | string
  height: null | number
  id: number | string
  is_primary: boolean
  source: string
  source_url: string
  storage_key: string
  tool_id: number | string
  width: null | number
}

const PHOTO_COLUMNS = `
  "id", "tool_id", "storage_key", "checksum", "content_type", "byte_size",
  "width", "height", "source", "source_url", "attribution", "is_primary",
  "derived_from", "created_by", "created_at"
`

export function photoUrl(toolId: number, photoId: number): string {
  return `/api/tools/${toolId}/photos/${photoId}/file`
}

export async function listPhotos(toolId: number, pool: PgPool = db()): Promise<ToolPhoto[]> {
  const result = await pool.query<PhotoRow>(
    `
      SELECT ${PHOTO_COLUMNS}
      FROM "catalog"."tool_photo"
      WHERE "tool_id" = $1
      -- The main photo first, then oldest to newest: the order the gallery
      -- shows, decided once here rather than in every client.
      ORDER BY "is_primary" DESC, "id" ASC
    `,
    [toolId],
  )

  return result.rows.map(toPhoto)
}

// One query for a whole page of tools, so the catalog grid can show thumbnails
// without asking per card.
export async function primaryPhotoIds(
  toolIds: number[],
  pool: PgPool = db(),
): Promise<Map<number, number>> {
  if (toolIds.length === 0) return new Map()

  const result = await pool.query<{ id: number | string; tool_id: number | string }>(
    `
      SELECT "id", "tool_id"
      FROM "catalog"."tool_photo"
      WHERE "tool_id" = ANY($1::bigint[]) AND "is_primary"
    `,
    [toolIds],
  )

  return new Map(result.rows.map((row) => [Number(row.tool_id), Number(row.id)]))
}

export async function getPhoto(
  toolId: number,
  photoId: number,
  pool: PgPool = db(),
): Promise<null | StoredPhotoRow> {
  const result = await pool.query<PhotoRow>(
    `SELECT ${PHOTO_COLUMNS} FROM "catalog"."tool_photo" WHERE "tool_id" = $1 AND "id" = $2`,
    [toolId, photoId],
  )

  const row = result.rows[0]
  return row ? { ...toPhoto(row), checksum: row.checksum, storageKey: row.storage_key } : null
}

export async function insertPhoto(
  input: {
    attribution?: string
    derivedFrom?: number
    metadata: ImageMetadata
    source: PhotoSource
    sourceUrl?: string
    stored: StoredPhoto
    toolId: number
  },
  actorId: number,
  pool: PgPool = db(),
): Promise<ToolPhoto> {
  try {
    const result = await pool.query<PhotoRow>(
      `
        INSERT INTO "catalog"."tool_photo"
          ("tool_id", "storage_key", "checksum", "content_type", "byte_size",
           "width", "height", "source", "source_url", "attribution", "is_primary",
           "derived_from", "created_by")
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          -- The first photo of a tool is its main one. Nobody should have to
          -- upload a picture and then tell the app it is the picture.
          NOT EXISTS (SELECT 1 FROM "catalog"."tool_photo" WHERE "tool_id" = $1),
          $11, $12
        )
        RETURNING ${PHOTO_COLUMNS}
      `,
      [
        input.toolId,
        input.stored.storageKey,
        input.stored.checksum,
        input.metadata.contentType,
        input.stored.byteSize,
        input.metadata.width,
        input.metadata.height,
        input.source,
        input.sourceUrl ?? '',
        input.attribution ?? '',
        input.derivedFrom ?? null,
        actorId,
      ],
    )

    return toPhoto(result.rows[0])
  } catch (error) {
    // The unique index on (tool_id, checksum): the same image twice on one
    // card is a mistake, not a second photo.
    if ((error as { code?: string }).code === '23505') throw new PhotoAlreadyExistsError()
    throw error
  }
}

export async function setPrimaryPhoto(
  toolId: number,
  photoId: number,
  pool: PgPool = db(),
): Promise<null | ToolPhoto> {
  // A transaction because the partial unique index allows exactly one primary
  // row per tool: the old one has to be cleared before the new one is set, and
  // a crash between the two would otherwise leave a tool with no main photo.
  return withTransaction(pool, async (client) => {
    const exists = await client.query(
      `SELECT 1 FROM "catalog"."tool_photo" WHERE "tool_id" = $1 AND "id" = $2`,
      [toolId, photoId],
    )
    if ((exists.rowCount ?? 0) === 0) return null

    await client.query(
      `UPDATE "catalog"."tool_photo" SET "is_primary" = false
       WHERE "tool_id" = $1 AND "is_primary" AND "id" <> $2`,
      [toolId, photoId],
    )

    const result = await client.query<PhotoRow>(
      `UPDATE "catalog"."tool_photo" SET "is_primary" = true
       WHERE "tool_id" = $1 AND "id" = $2
       RETURNING ${PHOTO_COLUMNS}`,
      [toolId, photoId],
    )

    return toPhoto(result.rows[0])
  })
}

export async function deletePhoto(
  toolId: number,
  photoId: number,
  pool: PgPool = db(),
): Promise<boolean> {
  const removed = await withTransaction(pool, async (client) => {
    const result = await client.query<PhotoRow>(
      `DELETE FROM "catalog"."tool_photo" WHERE "tool_id" = $1 AND "id" = $2 RETURNING ${PHOTO_COLUMNS}`,
      [toolId, photoId],
    )

    const row = result.rows[0]
    if (!row) return null

    // Deleting the main photo must not leave the tool without one: the oldest
    // remaining picture takes over.
    if (row.is_primary) {
      await client.query(
        `UPDATE "catalog"."tool_photo" SET "is_primary" = true
         WHERE "id" = (SELECT "id" FROM "catalog"."tool_photo" WHERE "tool_id" = $1 ORDER BY "id" ASC LIMIT 1)`,
        [toolId],
      )
    }

    // Files are shared between rows: the storage key is the checksum, so the
    // same picture on two tools is one file. It is only unlinked when the last
    // row pointing at it is gone.
    const stillUsed = await client.query(
      `SELECT 1 FROM "catalog"."tool_photo" WHERE "storage_key" = $1 LIMIT 1`,
      [row.storage_key],
    )

    return (stillUsed.rowCount ?? 0) === 0 ? row.storage_key : ''
  })

  if (removed === null) return false
  if (removed) await deletePhotoFile(removed)
  return true
}

// --- The photo library ------------------------------------------------------
//
// Everything above answers "what does this tool look like". The two functions
// below answer "what is on our disk", which is a different question with a
// different screen behind it: an operator cleaning up after an import that
// pulled in the wrong pictures.

export type LibraryPhoto = ToolPhoto & {
  toolName: string
}

export type LibraryPage = {
  items: LibraryPhoto[]
  limit: number
  offset: number
  total: number
}

export async function listAllPhotos(
  query: {
    direction: 'asc' | 'desc'
    limit: number
    offset: number
    search: null | string
    source: null | PhotoSource
  },
  pool: PgPool = db(),
): Promise<LibraryPage> {
  const direction = query.direction === 'asc' ? 'ASC' : 'DESC'

  const result = await pool.query<PhotoRow & { tool_name: string; total_count: string }>(
    `
      SELECT
        ${PHOTO_COLUMNS.split(',')
          .map((column) => `"p".${column.trim()}`)
          .join(', ')},
        "t"."name" AS "tool_name",
        count(*) OVER () AS "total_count"
      FROM "catalog"."tool_photo" AS "p"
      JOIN "catalog"."tool" AS "t" ON "t"."id" = "p"."tool_id"
      WHERE ($1::text IS NULL OR "t"."name" ILIKE $1 OR "t"."brand" ILIKE $1 OR "t"."model" ILIKE $1)
        AND ($2::text IS NULL OR "p"."source" = $2)
      ORDER BY "p"."created_at" ${direction}, "p"."id" ${direction}
      LIMIT $3 OFFSET $4
    `,
    [
      query.search === null ? null : `%${query.search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`,
      query.source,
      query.limit,
      query.offset,
    ],
  )

  return {
    items: result.rows.map((row) => ({ ...toPhoto(row), toolName: row.tool_name })),
    limit: query.limit,
    offset: query.offset,
    total: Number(result.rows[0]?.total_count ?? 0),
  }
}

export type BulkDeleteResult = {
  deleted: number
  // Tools whose main photo was among the deleted rows and now show a
  // different one. Reported so the screen can say what else changed.
  promotedTools: number[]
}

export async function deletePhotosByIds(
  ids: number[],
  pool: PgPool = db(),
): Promise<BulkDeleteResult> {
  if (ids.length === 0) return { deleted: 0, promotedTools: [] }

  const { promotedTools, removed, storageKeys } = await withTransaction(pool, async (client) => {
    const deleted = await client.query<{
      is_primary: boolean
      storage_key: string
      tool_id: string
    }>(
      `DELETE FROM "catalog"."tool_photo" WHERE "id" = ANY($1::bigint[])
       RETURNING "tool_id", "storage_key", "is_primary"`,
      [ids],
    )

    const orphanedTools = [
      ...new Set(deleted.rows.filter((row) => row.is_primary).map((row) => Number(row.tool_id))),
    ]

    // A tool that lost its main photo gets the oldest remaining one, exactly
    // as a single delete does. One statement for all of them.
    const promoted = await client.query<{ tool_id: string }>(
      `
        UPDATE "catalog"."tool_photo" SET "is_primary" = true
        WHERE "id" IN (
          SELECT DISTINCT ON ("tool_id") "id"
          FROM "catalog"."tool_photo"
          WHERE "tool_id" = ANY($1::bigint[])
          ORDER BY "tool_id", "id" ASC
        )
        RETURNING "tool_id"
      `,
      [orphanedTools],
    )

    // Files are shared by checksum, so a key is only unlinked once no row
    // anywhere points at it.
    const keys = [...new Set(deleted.rows.map((row) => row.storage_key))]
    const stillUsed = await client.query<{ storage_key: string }>(
      `SELECT DISTINCT "storage_key" FROM "catalog"."tool_photo" WHERE "storage_key" = ANY($1::text[])`,
      [keys],
    )
    const used = new Set(stillUsed.rows.map((row) => row.storage_key))

    return {
      promotedTools: promoted.rows.map((row) => Number(row.tool_id)),
      removed: deleted.rows.length,
      storageKeys: keys.filter((key) => !used.has(key)),
    }
  })

  // Outside the transaction: a failed unlink must not roll back rows that are
  // already gone. An orphaned file is a wasted byte; a row pointing at a
  // deleted file is a broken photo.
  for (const key of storageKeys) await deletePhotoFile(key)

  return { deleted: removed, promotedTools }
}

function toPhoto(row: PhotoRow): ToolPhoto {
  const id = Number(row.id)
  const toolId = Number(row.tool_id)

  return {
    attribution: row.attribution,
    byteSize: Number(row.byte_size),
    contentType: row.content_type,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
    createdBy: row.created_by === null ? null : Number(row.created_by),
    derivedFrom: row.derived_from === null ? null : Number(row.derived_from),
    height: row.height === null ? null : Number(row.height),
    id,
    isPrimary: row.is_primary,
    source: (PHOTO_SOURCES as readonly string[]).includes(row.source)
      ? (row.source as PhotoSource)
      : 'upload',
    sourceUrl: row.source_url,
    toolId,
    url: photoUrl(toolId, id),
    width: row.width === null ? null : Number(row.width),
  }
}
