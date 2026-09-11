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
  // Null while the photo belongs to no tool.
  toolId: null | number
  // Where the bytes are served from. Addressed by the photo's own id rather
  // than through a tool, because a photo may not have one.
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
  tool_id: null | number | string
  width: null | number
}

const PHOTO_COLUMNS = `
  "id", "tool_id", "storage_key", "checksum", "content_type", "byte_size",
  "width", "height", "source", "source_url", "attribution", "is_primary",
  "derived_from", "created_by", "created_at"
`

export function photoUrl(photoId: number): string {
  return `/api/photos/${photoId}/file`
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

// By id alone, for the routes that serve bytes and for anything holding an
// unattached photo.
export async function getPhotoById(
  photoId: number,
  pool: PgPool = db(),
): Promise<null | StoredPhotoRow> {
  const result = await pool.query<PhotoRow>(
    `SELECT ${PHOTO_COLUMNS} FROM "catalog"."tool_photo" WHERE "id" = $1`,
    [photoId],
  )

  const row = result.rows[0]
  return row ? { ...toPhoto(row), checksum: row.checksum, storageKey: row.storage_key } : null
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
    // Null for a photo that belongs to no tool yet.
    toolId: null | number
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
          -- Cast, because tool_id may be null and a bare parameter that is
          -- null everywhere it appears has no type Postgres can infer: the
          -- whole insert fails with "could not determine data type of
          -- parameter $1".
          $1::bigint, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          -- The first photo of a tool is its main one. Nobody should have to
          -- upload a picture and then tell the app it is the picture. A photo
          -- with no tool is the main photo of nothing.
          $1::bigint IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM "catalog"."tool_photo" WHERE "tool_id" = $1::bigint),
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
  // Empty for an unattached photo, which the screen shows as "bez narzędzia".
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
    // null means "both": attached and unattached.
    assigned: boolean | null
    direction: 'asc' | 'desc'
    limit: number
    offset: number
    search: null | string
    source: null | PhotoSource
  },
  pool: PgPool = db(),
): Promise<LibraryPage> {
  const direction = query.direction === 'asc' ? 'ASC' : 'DESC'

  const result = await pool.query<PhotoRow & { tool_name: null | string; total_count: string }>(
    `
      SELECT
        ${PHOTO_COLUMNS.split(',')
          .map((column) => `"p".${column.trim()}`)
          .join(', ')},
        "t"."name" AS "tool_name",
        count(*) OVER () AS "total_count"
      FROM "catalog"."tool_photo" AS "p"
      -- LEFT: a photo without a tool is still a photo, and the library is
      -- where it is waiting to be given one.
      LEFT JOIN "catalog"."tool" AS "t" ON "t"."id" = "p"."tool_id"
      WHERE ($1::text IS NULL OR "t"."name" ILIKE $1 OR "t"."brand" ILIKE $1 OR "t"."model" ILIKE $1)
        AND ($2::text IS NULL OR "p"."source" = $2)
        AND ($3::boolean IS NULL OR ("p"."tool_id" IS NOT NULL) = $3)
      ORDER BY "p"."created_at" ${direction}, "p"."id" ${direction}
      LIMIT $4 OFFSET $5
    `,
    [
      query.search === null ? null : `%${query.search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`,
      query.source,
      query.assigned,
      query.limit,
      query.offset,
    ],
  )

  return {
    items: result.rows.map((row) => ({ ...toPhoto(row), toolName: row.tool_name ?? '' })),
    limit: query.limit,
    offset: query.offset,
    total: Number(result.rows[0]?.total_count ?? 0),
  }
}

export type AttachResult = {
  attached: ToolPhoto[]
  failed: { id: number; reason: string }[]
}

// Puts photos that already exist onto a tool.
//
// Two different things, deliberately, depending on where the photo is now. An
// unattached one is **moved**: it keeps its id and leaves the unassigned list,
// which is what "przypisz" means to the person doing it. One that already
// belongs to another tool is **copied** — the same picture can legitimately
// illustrate two tools, and since files are addressed by checksum the copy is
// a row, not another megabyte.
export async function attachPhotosToTool(
  toolId: number,
  photoIds: number[],
  actorId: number,
  pool: PgPool = db(),
): Promise<AttachResult> {
  const attached: ToolPhoto[] = []
  const failed: { id: number; reason: string }[] = []

  for (const photoId of photoIds) {
    const source = await getPhotoById(photoId, pool)
    if (!source) {
      failed.push({ id: photoId, reason: 'Nie ma takiego zdjęcia' })
      continue
    }
    if (source.toolId === toolId) {
      failed.push({ id: photoId, reason: 'To zdjęcie już jest na tej karcie' })
      continue
    }

    try {
      const photo =
        source.toolId === null
          ? await moveToTool(toolId, photoId, pool)
          : await copyToTool(toolId, source, actorId, pool)

      if (photo) attached.push(photo)
      else failed.push({ id: photoId, reason: 'Nie udało się przypisać' })
    } catch (error) {
      // The unique index on (tool_id, checksum): this tool already shows this
      // picture, under another row.
      if ((error as { code?: string }).code === '23505') {
        failed.push({ id: photoId, reason: 'Takie zdjęcie już jest na tej karcie' })
        continue
      }
      throw error
    }
  }

  return { attached, failed }
}

async function moveToTool(
  toolId: number,
  photoId: number,
  pool: PgPool,
): Promise<null | ToolPhoto> {
  const result = await pool.query<PhotoRow>(
    `
      UPDATE "catalog"."tool_photo"
      SET "tool_id" = $1,
          -- The first photo of a tool is its main one, whether it arrived by
          -- upload or by being assigned here.
          "is_primary" = NOT EXISTS (
            SELECT 1 FROM "catalog"."tool_photo" WHERE "tool_id" = $1
          )
      WHERE "id" = $2 AND "tool_id" IS NULL
      RETURNING ${PHOTO_COLUMNS}
    `,
    [toolId, photoId],
  )

  const row = result.rows[0]
  return row ? toPhoto(row) : null
}

async function copyToTool(
  toolId: number,
  source: StoredPhotoRow,
  actorId: number,
  pool: PgPool,
): Promise<ToolPhoto> {
  return insertPhoto(
    {
      attribution: source.attribution,
      metadata: {
        contentType: source.contentType,
        height: source.height ?? 0,
        width: source.width ?? 0,
      },
      source: source.source,
      sourceUrl: source.sourceUrl,
      stored: {
        byteSize: source.byteSize,
        checksum: source.checksum,
        // The same file: content addressed, so a second card showing the same
        // picture costs a row.
        storageKey: source.storageKey,
      },
      toolId,
    },
    actorId,
    pool,
  )
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
  const toolId = row.tool_id === null ? null : Number(row.tool_id)

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
    url: photoUrl(id),
    width: row.width === null ? null : Number(row.width),
  }
}
