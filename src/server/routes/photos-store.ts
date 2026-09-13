// Everything that touches `catalog.photo` and the two link tables.
// src/server/photo-storage.ts owns the bytes; this module owns the rows.
//
// A photo row is one picture, once. Which cards show it lives in
// `photo_tool` and `photo_case`, so the same photograph can illustrate several
// tools, several cases, and a tool together with the case it lives in — with
// its attribution, its source and its cutout lineage written down a single
// time instead of copied per card.
//
// Which link table to use is chosen from a fixed map in photo-owner.ts, so
// nothing a client sends can reach the query text.

import { db, withTransaction, type PgPool } from '../db'
import { deletePhotoFile, type StoredPhoto } from '../photo-storage'
import type { ImageMetadata } from '../image-metadata'
import { linkTable, ownerColumn, type PhotoOwner, type PhotoOwnerKind } from './photo-owner'
import { t } from '../i18n'

export const PHOTO_SOURCES = ['upload', 'url', 'search', 'edit'] as const

export type PhotoSource = (typeof PHOTO_SOURCES)[number]

export type Photo = {
  attribution: string
  byteSize: number
  contentType: string
  createdAt: string
  createdBy: null | number
  // The picture this one was cut out from, when source is 'edit'. The original
  // is never touched, so an unconvincing cutout is one delete away from undone.
  derivedFrom: null | number
  height: null | number
  id: number
  source: PhotoSource
  sourceUrl: string
  // Where the bytes are served from. By the picture's own id, because it is
  // not reached through any one card.
  url: string
  width: null | number
}

// A picture as one card shows it. Being the main photo is a property of the
// pairing: the same photograph can head one card and sit fourth on another.
export type CardPhoto = Photo & {
  isPrimary: boolean
}

// What the file-serving route needs on top of what a client sees: where the
// bytes are and what they hash to. Neither is part of the API surface — the
// storage layout is ours to change.
export type StoredPhotoRow = CardPhoto & {
  checksum: string
  storageKey: string
}

export class PhotoAlreadyExistsError extends Error {
  constructor() {
    super(t('To zdjęcie jest już na tej karcie'))
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
  is_primary?: boolean
  source: string
  source_url: string
  storage_key: string
  width: null | number
}

const PHOTO_COLUMNS = `
  "id", "storage_key", "checksum", "content_type", "byte_size", "width", "height",
  "source", "source_url", "attribution", "derived_from", "created_by", "created_at"
`

const PREFIXED_COLUMNS = PHOTO_COLUMNS.split(',')
  .map((column) => `"p".${column.trim()}`)
  .join(', ')

export function photoUrl(photoId: number): string {
  return `/api/photos/${photoId}/file`
}

export async function listPhotos(owner: PhotoOwner, pool: PgPool = db()): Promise<CardPhoto[]> {
  const result = await pool.query<PhotoRow>(
    `
      SELECT ${PREFIXED_COLUMNS}, "l"."is_primary"
      FROM "catalog"."${linkTable(owner.kind)}" AS "l"
      JOIN "catalog"."photo" AS "p" ON "p"."id" = "l"."photo_id"
      WHERE "l"."${ownerColumn(owner.kind)}" = $1
      -- The main photo first, then oldest attachment to newest: the order the
      -- gallery shows, decided once here rather than in every client.
      ORDER BY "l"."is_primary" DESC, "l"."created_at" ASC, "p"."id" ASC
    `,
    [owner.id],
  )

  return result.rows.map(toCardPhoto)
}

// One query for a whole page of tools or cases, so a grid can show thumbnails
// without asking per card.
export async function primaryPhotoIds(
  kind: PhotoOwnerKind,
  ownerIds: number[],
  pool: PgPool = db(),
): Promise<Map<number, number>> {
  if (ownerIds.length === 0) return new Map()

  const column = ownerColumn(kind)
  const result = await pool.query<{ owner_id: number | string; photo_id: number | string }>(
    `
      SELECT "${column}" AS "owner_id", "photo_id"
      FROM "catalog"."${linkTable(kind)}"
      WHERE "${column}" = ANY($1::bigint[]) AND "is_primary"
    `,
    [ownerIds],
  )

  return new Map(result.rows.map((row) => [Number(row.owner_id), Number(row.photo_id)]))
}

// Whether these bytes are already a picture here. The checksum is unique, so
// this is what tells "written" apart from "found" — which the library import
// says out loud rather than claiming to have added something.
export async function findPhotoByChecksum(
  checksum: string,
  pool: PgPool = db(),
): Promise<null | Photo> {
  const result = await pool.query<PhotoRow>(
    `SELECT ${PHOTO_COLUMNS} FROM "catalog"."photo" WHERE "checksum" = $1`,
    [checksum],
  )

  const row = result.rows[0]
  return row ? toPhoto(row) : null
}

export async function getPhotoById(
  photoId: number,
  pool: PgPool = db(),
): Promise<null | StoredPhotoRow> {
  const result = await pool.query<PhotoRow>(
    `SELECT ${PHOTO_COLUMNS} FROM "catalog"."photo" WHERE "id" = $1`,
    [photoId],
  )

  const row = result.rows[0]
  return row ? toStored(row) : null
}

// The picture, but only if this card actually shows it. Every per-card route
// asks through this, so a photo id from another card cannot be edited by
// guessing a URL.
export async function getCardPhoto(
  owner: PhotoOwner,
  photoId: number,
  pool: PgPool = db(),
): Promise<null | StoredPhotoRow> {
  const result = await pool.query<PhotoRow>(
    `
      SELECT ${PREFIXED_COLUMNS}, "l"."is_primary"
      FROM "catalog"."${linkTable(owner.kind)}" AS "l"
      JOIN "catalog"."photo" AS "p" ON "p"."id" = "l"."photo_id"
      WHERE "l"."${ownerColumn(owner.kind)}" = $1 AND "p"."id" = $2
    `,
    [owner.id, photoId],
  )

  const row = result.rows[0]
  return row ? toStored(row) : null
}

// Writes the picture, or finds the one already written. The checksum is unique
// now, so the same bytes arriving twice — a re-import, the same address pasted
// again — is one row rather than a conflict the caller has to handle.
export async function insertPhoto(
  input: {
    attribution?: string
    derivedFrom?: number
    metadata: ImageMetadata
    source: PhotoSource
    sourceUrl?: string
    stored: StoredPhoto
  },
  actorId: number,
  pool: PgPool = db(),
): Promise<Photo> {
  const result = await pool.query<PhotoRow>(
    `
      INSERT INTO "catalog"."photo"
        ("storage_key", "checksum", "content_type", "byte_size", "width", "height",
         "source", "source_url", "attribution", "derived_from", "created_by")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT ("checksum") DO NOTHING
      RETURNING ${PHOTO_COLUMNS}
    `,
    [
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

  if (result.rows[0]) return toPhoto(result.rows[0])

  // Already on our disk under another row: the existing picture is the answer,
  // and its provenance is left as first recorded.
  const existing = await pool.query<PhotoRow>(
    `SELECT ${PHOTO_COLUMNS} FROM "catalog"."photo" WHERE "checksum" = $1`,
    [input.stored.checksum],
  )

  return toPhoto(existing.rows[0])
}

// Puts an existing picture on a card. The first picture of a card becomes its
// main one: nobody should have to upload a photo and then tell the app it is
// the photo.
export async function linkPhoto(
  owner: PhotoOwner,
  photoId: number,
  actorId: number,
  pool: PgPool = db(),
): Promise<CardPhoto> {
  const column = ownerColumn(owner.kind)
  const table = linkTable(owner.kind)

  const inserted = await pool.query(
    `
      INSERT INTO "catalog"."${table}" ("${column}", "photo_id", "is_primary", "created_by")
      VALUES (
        $1, $2,
        NOT EXISTS (SELECT 1 FROM "catalog"."${table}" WHERE "${column}" = $1),
        $3
      )
      ON CONFLICT DO NOTHING
    `,
    [owner.id, photoId, actorId],
  )

  if ((inserted.rowCount ?? 0) === 0) throw new PhotoAlreadyExistsError()

  const photo = await getCardPhoto(owner, photoId, pool)
  if (!photo) throw new Error('link written but the photo cannot be read back')

  return photo
}

export async function setPrimaryPhoto(
  owner: PhotoOwner,
  photoId: number,
  pool: PgPool = db(),
): Promise<null | CardPhoto> {
  const column = ownerColumn(owner.kind)
  const table = linkTable(owner.kind)

  // A transaction because the partial unique index allows exactly one primary
  // link per card: the old one has to be cleared before the new one is set, and
  // a crash between the two would otherwise leave a card with no main photo.
  return withTransaction(pool, async (client) => {
    const exists = await client.query(
      `SELECT 1 FROM "catalog"."${table}" WHERE "${column}" = $1 AND "photo_id" = $2`,
      [owner.id, photoId],
    )
    if ((exists.rowCount ?? 0) === 0) return null

    await client.query(
      `UPDATE "catalog"."${table}" SET "is_primary" = false
       WHERE "${column}" = $1 AND "is_primary" AND "photo_id" <> $2`,
      [owner.id, photoId],
    )
    await client.query(
      `UPDATE "catalog"."${table}" SET "is_primary" = true
       WHERE "${column}" = $1 AND "photo_id" = $2`,
      [owner.id, photoId],
    )

    return getCardPhoto(owner, photoId, client as unknown as PgPool)
  }).then((photo) => (photo ? { ...photo, isPrimary: true } : null))
}

// Takes a picture off a card. If no card shows it any more it is deleted
// outright, file and all — a bin on a card means the picture is gone, not that
// it has moved to a library nobody asked to fill.
export async function unlinkPhoto(
  owner: PhotoOwner,
  photoId: number,
  pool: PgPool = db(),
): Promise<boolean> {
  const column = ownerColumn(owner.kind)
  const table = linkTable(owner.kind)

  const orphanedKey = await withTransaction(pool, async (client) => {
    const removed = await client.query<{ is_primary: boolean }>(
      `DELETE FROM "catalog"."${table}" WHERE "${column}" = $1 AND "photo_id" = $2
       RETURNING "is_primary"`,
      [owner.id, photoId],
    )
    if ((removed.rowCount ?? 0) === 0) return null

    // Removing the main photo must not leave the card without one: the oldest
    // remaining attachment takes over.
    if (removed.rows[0].is_primary) {
      await client.query(
        `UPDATE "catalog"."${table}" SET "is_primary" = true
         WHERE ("${column}", "photo_id") = (
           SELECT "${column}", "photo_id" FROM "catalog"."${table}"
           WHERE "${column}" = $1 ORDER BY "created_at" ASC, "photo_id" ASC LIMIT 1
         )`,
        [owner.id],
      )
    }

    return dropIfUnused(client, [photoId])
  })

  if (orphanedKey === null) return false
  for (const key of orphanedKey) await deletePhotoFile(key)
  return true
}

// --- The photo library ------------------------------------------------------
//
// Everything above answers "what does this card look like". The functions
// below answer "what is on our disk", which is a different question with a
// different screen behind it: an operator cleaning up after an import that
// pulled in the wrong pictures. One picture appears once here, however many
// cards show it.

export type PhotoOwnerRef = {
  id: number
  // Whether this picture is the one heading that card. A property of the
  // pairing, so it belongs here rather than on the picture.
  isPrimary: boolean
  kind: PhotoOwnerKind
  name: string
}

export type LibraryPhoto = Photo & {
  // The brand this picture is the logo of, if any. Not an owner: a logo is not
  // "on a card", cannot be attached through the photo routes, and does not
  // make the picture count as assigned. It is, however, the thing a delete
  // would quietly take away, so the screen has to be told.
  logoForBrand: null | { id: number; name: string }
  // Every card showing this picture. Empty while nobody has placed it.
  owners: PhotoOwnerRef[]
}

export type LibraryPage = {
  items: LibraryPhoto[]
  limit: number
  offset: number
  total: number
}

export async function listAllPhotos(
  query: {
    // null means "both": placed and unplaced.
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

  const result = await pool.query<
    PhotoRow & {
      logo_for_brand: null | { id: number | string; name: string }
      owners: null | PhotoOwnerRef[]
      total_count: string
    }
  >(
    `
      WITH "owners" AS (
        SELECT "l"."photo_id",
               jsonb_agg(jsonb_build_object('kind', 'tool', 'id', "t"."id", 'name', "t"."name",
                                            'isPrimary', "l"."is_primary")
                         ORDER BY "t"."name") AS "refs",
               string_agg("t"."name" || ' ' || "t"."brand" || ' ' || "t"."model", ' ') AS "text"
        FROM "catalog"."photo_tool" AS "l"
        JOIN "catalog"."tool" AS "t" ON "t"."id" = "l"."tool_id"
        GROUP BY "l"."photo_id"
        UNION ALL
        SELECT "l"."photo_id",
               jsonb_agg(jsonb_build_object('kind', 'case', 'id', "c"."id", 'name', "c"."name",
                                            'isPrimary', "l"."is_primary")
                         ORDER BY "c"."name"),
               string_agg("c"."name" || ' ' || "c"."manufacturer", ' ')
        FROM "catalog"."photo_case" AS "l"
        JOIN "catalog"."tool_case" AS "c" ON "c"."id" = "l"."case_id"
        GROUP BY "l"."photo_id"
      ),
      "rolled" AS (
        SELECT "photo_id",
               jsonb_agg("ref") AS "refs",
               string_agg("text", ' ') AS "text"
        FROM "owners", LATERAL jsonb_array_elements("refs") AS "ref"
        GROUP BY "photo_id"
      )
      SELECT ${PREFIXED_COLUMNS},
             COALESCE("r"."refs", '[]'::jsonb) AS "owners",
             (SELECT jsonb_build_object('id', "b"."id", 'name', "b"."name")
              FROM "catalog"."photo_brand" AS "pb"
              JOIN "catalog"."brand" AS "b" ON "b"."id" = "pb"."brand_id"
              WHERE "pb"."photo_id" = "p"."id") AS "logo_for_brand",
             count(*) OVER () AS "total_count"
      FROM "catalog"."photo" AS "p"
      LEFT JOIN "rolled" AS "r" ON "r"."photo_id" = "p"."id"
      WHERE ($1::text IS NULL OR "r"."text" ILIKE $1)
        AND ($2::text IS NULL OR "p"."source" = $2)
        AND ($3::boolean IS NULL OR ("r"."photo_id" IS NOT NULL) = $3)
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
    items: result.rows.map((row) => ({
      ...toPhoto(row),
      // Nullish rather than null: the column is absent from a row the caller
      // built by hand, and both absences mean the same thing.
      logoForBrand: row.logo_for_brand
        ? { id: Number(row.logo_for_brand.id), name: row.logo_for_brand.name }
        : null,
      owners: (row.owners ?? []).map((owner) => ({ ...owner, id: Number(owner.id) })),
    })),
    limit: query.limit,
    offset: query.offset,
    // No rows means no matches, not an empty page of an unknown total.
    total: Number(result.rows[0]?.total_count ?? 0),
  }
}

export type AttachResult = {
  attached: CardPhoto[]
  failed: { id: number; reason: string }[]
}

// Puts pictures that already exist onto a card. With the links in their own
// table this is one insert each: nothing moves, nothing is copied, and the
// library keeps showing the picture because the library is about pictures.
export async function attachPhotosTo(
  owner: PhotoOwner,
  photoIds: number[],
  actorId: number,
  pool: PgPool = db(),
): Promise<AttachResult> {
  const attached: CardPhoto[] = []
  const failed: { id: number; reason: string }[] = []

  for (const photoId of photoIds) {
    if (!(await getPhotoById(photoId, pool))) {
      failed.push({ id: photoId, reason: t('Nie ma takiego zdjęcia') })
      continue
    }

    try {
      attached.push(await linkPhoto(owner, photoId, actorId, pool))
    } catch (error) {
      if (error instanceof PhotoAlreadyExistsError) {
        failed.push({ id: photoId, reason: error.message })
        continue
      }
      throw error
    }
  }

  return { attached, failed }
}

export type BulkDeleteResult = {
  deleted: number
  // Cards whose main photo was among the deleted pictures and now show a
  // different one. Reported so the screen can say what else changed.
  promoted: PhotoOwner[]
}

// Deletes pictures outright, from every card at once. This is the library's
// bin, and the library is about pictures rather than about one card's view of
// them.
export async function deletePhotosByIds(
  ids: number[],
  pool: PgPool = db(),
): Promise<BulkDeleteResult> {
  if (ids.length === 0) return { deleted: 0, promoted: [] }

  const { promoted, removed, storageKeys } = await withTransaction(pool, async (client) => {
    // Which cards are about to lose their main photo, read before the rows go.
    const orphaned: PhotoOwner[] = []
    for (const kind of ['tool', 'case'] as const) {
      const found = await client.query<{ owner_id: string }>(
        `SELECT "${ownerColumn(kind)}" AS "owner_id" FROM "catalog"."${linkTable(kind)}"
         WHERE "photo_id" = ANY($1::bigint[]) AND "is_primary"`,
        [ids],
      )
      for (const row of found.rows) orphaned.push({ id: Number(row.owner_id), kind })
    }

    const deleted = await client.query<{ storage_key: string }>(
      `DELETE FROM "catalog"."photo" WHERE "id" = ANY($1::bigint[]) RETURNING "storage_key"`,
      [ids],
    )

    // The links went with the pictures, so each of those cards now takes its
    // oldest remaining attachment — the same promotion a single delete does.
    const promotedOwners: PhotoOwner[] = []
    for (const owner of orphaned) {
      const column = ownerColumn(owner.kind)
      const table = linkTable(owner.kind)
      const result = await client.query(
        `UPDATE "catalog"."${table}" SET "is_primary" = true
         WHERE ("${column}", "photo_id") = (
           SELECT "${column}", "photo_id" FROM "catalog"."${table}"
           WHERE "${column}" = $1 ORDER BY "created_at" ASC, "photo_id" ASC LIMIT 1
         )`,
        [owner.id],
      )
      if ((result.rowCount ?? 0) > 0) promotedOwners.push(owner)
    }

    // Files are shared by checksum, so a key is only unlinked once no row
    // anywhere points at it.
    const keys = [...new Set(deleted.rows.map((row) => row.storage_key))]
    const stillUsed = await client.query<{ storage_key: string }>(
      `SELECT DISTINCT "storage_key" FROM "catalog"."photo" WHERE "storage_key" = ANY($1::text[])`,
      [keys],
    )
    const used = new Set(stillUsed.rows.map((row) => row.storage_key))

    return {
      promoted: promotedOwners,
      removed: deleted.rows.length,
      storageKeys: keys.filter((key) => !used.has(key)),
    }
  })

  // Outside the transaction: a failed unlink must not roll back rows that are
  // already gone. An orphaned file is a wasted byte; a row pointing at a
  // deleted file is a broken photo.
  for (const key of storageKeys) await deletePhotoFile(key)

  return { deleted: removed, promoted }
}

// Deletes any of these pictures that nothing uses any more, and answers with
// the files that nothing points at. Shared by the per-card bin and by deleting
// a whole card.
//
// Three things hold a picture, not two: a tool, a case, and a maker whose logo
// it is. `photo_brand` cascades on the photo, so leaving it out here does not
// fail — it quietly takes the logo off a brand that had nothing to do with the
// card being deleted. The media library has always said as much before
// deleting a picture; this is the same knowledge in the rule that decides.
async function dropIfUnused(
  client: { query: PgPool['query'] },
  photoIds: number[],
): Promise<string[]> {
  if (photoIds.length === 0) return []

  const deleted = await client.query<{ storage_key: string }>(
    `
      DELETE FROM "catalog"."photo" AS "p"
      WHERE "p"."id" = ANY($1::bigint[])
        AND NOT EXISTS (SELECT 1 FROM "catalog"."photo_tool" WHERE "photo_id" = "p"."id")
        AND NOT EXISTS (SELECT 1 FROM "catalog"."photo_case" WHERE "photo_id" = "p"."id")
        AND NOT EXISTS (SELECT 1 FROM "catalog"."photo_brand" WHERE "photo_id" = "p"."id")
      RETURNING "storage_key"
    `,
    [photoIds],
  )

  const keys = [...new Set(deleted.rows.map((row) => row.storage_key))]
  if (keys.length === 0) return []

  const stillUsed = await client.query<{ storage_key: string }>(
    `SELECT DISTINCT "storage_key" FROM "catalog"."photo" WHERE "storage_key" = ANY($1::text[])`,
    [keys],
  )
  const used = new Set(stillUsed.rows.map((row) => row.storage_key))

  return keys.filter((key) => !used.has(key))
}

// The pictures this card is the only home of: what deleting it would take with
// it, asked before the fact rather than found out after.
//
// The same three holds as `dropIfUnused` — another card of either kind, or a
// maker whose logo this is — except that the card's own link is not one of
// them, since that is the link about to disappear. A confirmation that says
// "and its photographs" without a number is a confirmation nobody can weigh.
export async function exclusivePhotoIds(owner: PhotoOwner, pool: PgPool = db()): Promise<number[]> {
  const other: PhotoOwnerKind = owner.kind === 'tool' ? 'case' : 'tool'

  const result = await pool.query<{ photo_id: number | string }>(
    `
      SELECT "l"."photo_id"
      FROM "catalog"."${linkTable(owner.kind)}" AS "l"
      WHERE "l"."${ownerColumn(owner.kind)}" = $1
        AND NOT EXISTS (
          SELECT 1 FROM "catalog"."${linkTable(owner.kind)}" AS "same"
          WHERE "same"."photo_id" = "l"."photo_id"
            AND "same"."${ownerColumn(owner.kind)}" <> $1
        )
        AND NOT EXISTS (
          SELECT 1 FROM "catalog"."${linkTable(other)}" AS "cross"
          WHERE "cross"."photo_id" = "l"."photo_id"
        )
        AND NOT EXISTS (
          SELECT 1 FROM "catalog"."photo_brand" AS "logo"
          WHERE "logo"."photo_id" = "l"."photo_id"
        )
    `,
    [owner.id],
  )

  return result.rows.map((row) => Number(row.photo_id))
}

// Called when a whole tool or case goes. Its links cascade away with it; this
// clears the pictures that nothing shows any more, so deleting a card still
// takes its photographs with it rather than filling the library.
export async function dropOrphanedPhotos(photoIds: number[], pool: PgPool = db()): Promise<number> {
  if (photoIds.length === 0) return 0

  const keys = await withTransaction(pool, (client) => dropIfUnused(client, photoIds))
  for (const key of keys) await deletePhotoFile(key)

  return keys.length
}

// Puts every picture one card shows onto another, keeping which one is the
// main photo. Cheap now that a pairing is a row: two cards showing the same
// photograph cost a link each and no second file.
export async function copyPhotoLinks(
  from: PhotoOwner,
  to: PhotoOwner,
  actorId: number,
  pool: PgPool = db(),
): Promise<number> {
  const column = ownerColumn(from.kind)
  const result = await pool.query(
    `
      INSERT INTO "catalog"."${linkTable(to.kind)}" ("${ownerColumn(to.kind)}", "photo_id", "is_primary", "created_by")
      SELECT $2, "photo_id", "is_primary", $3
      FROM "catalog"."${linkTable(from.kind)}"
      WHERE "${column}" = $1
      ON CONFLICT DO NOTHING
    `,
    [from.id, to.id, actorId],
  )

  return result.rowCount ?? 0
}

// Which pictures a card shows, by id. Read before the card is deleted, so the
// orphans can be found after its links have cascaded away.
export async function photoIdsOf(owner: PhotoOwner, pool: PgPool = db()): Promise<number[]> {
  const result = await pool.query<{ photo_id: string }>(
    `SELECT "photo_id" FROM "catalog"."${linkTable(owner.kind)}" WHERE "${ownerColumn(owner.kind)}" = $1`,
    [owner.id],
  )

  return result.rows.map((row) => Number(row.photo_id))
}

function toStored(row: PhotoRow): StoredPhotoRow {
  return { ...toCardPhoto(row), checksum: row.checksum, storageKey: row.storage_key }
}

function toCardPhoto(row: PhotoRow): CardPhoto {
  return { ...toPhoto(row), isPrimary: row.is_primary ?? false }
}

function toPhoto(row: PhotoRow): Photo {
  const id = Number(row.id)

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
    source: (PHOTO_SOURCES as readonly string[]).includes(row.source)
      ? (row.source as PhotoSource)
      : 'upload',
    sourceUrl: row.source_url,
    url: photoUrl(id),
    width: row.width === null ? null : Number(row.width),
  }
}
