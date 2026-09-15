// Everything that touches `catalog.organizer` and `catalog.organizer_item`.
//
// The list carries enough for the screen to draw a tile without a second
// request per row: the case, its main photo, and every item with its own.
// That is one query with two aggregates rather than N+1.

import { db, withTransaction, type PgPool } from '../db'
import type { ErrorCode } from '../error-codes'
import { labelFileUrl, labelPreviewUrl } from './labels-store'
import type { OrganizerFields, OrganizerPatch, OrganizerQuery } from './organizers-input'
import { photoUrl } from './photos-store'
import { t } from '../i18n'

export type OrganizerItem = {
  brand: string
  id: number
  model: string
  name: string
  primaryPhotoUrl: null | string
}

// A generated label: the PDF and the options it was drawn from.
export type OrganizerLabel = {
  byteSize: number
  createdAt: string
  createdBy: null | number
  heightMm: number
  id: number
  options: Record<string, unknown>
  // A picture of the label for the tile, or null when there is none: an older
  // row, or one whose render failed. The list has to cope with both.
  previewUrl: null | string
  template: string
  // Where the bytes are served from. The path on disk is ours to change.
  url: string
  widthMm: number
}

export type Organizer = {
  // Where this arrangement is kept, or null when nobody has said. The items in
  // it carry an address of their own: an item taken out to a site while its box
  // stays in the workshop is two places, and the catalog records both rather
  // than deciding which is the lie.
  addressId: null | number
  case: {
    id: number
    manufacturer: string
    name: string
    primaryPhotoUrl: null | string
  }
  createdAt: string
  createdBy: null | number
  description: string
  id: number
  labels: OrganizerLabel[]
  name: string
  number: number
  items: OrganizerItem[]
  updatedAt: string
  updatedBy: null | number
}

export type OrganizerPage = {
  items: Organizer[]
  limit: number
  offset: number
  total: number
}

export class NumberTakenError extends Error {
  readonly code: ErrorCode

  constructor(number: number) {
    super(t('Numer {number} jest już zajęty przez inny organizer', { number }))
    this.name = 'NumberTakenError'
    this.code = 'ORGANIZER_NUMBER_TAKEN'
  }
}

export class ItemAlreadyInOrganizerError extends Error {
  readonly code: ErrorCode

  constructor() {
    super(t('To narzędzie jest już w innym organizerze'))
    this.name = 'ItemAlreadyInOrganizerError'
    this.code = 'ITEM_ALREADY_IN_ORGANIZER'
  }
}

export class NotAToolError extends Error {
  readonly code: ErrorCode

  constructor() {
    super(t('Do organizera trafiają tylko narzędzia'))
    this.name = 'NotAToolError'
    this.code = 'ITEM_IS_NOT_A_TOOL'
  }
}

export class AddressNotFoundError extends Error {
  readonly code: ErrorCode

  constructor() {
    super(t('Nie ma takiego adresu'))
    this.name = 'AddressNotFoundError'
    this.code = 'ADDRESS_NOT_FOUND'
  }
}

export class CaseNotFoundError extends Error {
  readonly code: ErrorCode

  constructor() {
    super('Nie ma takiej skrzynki')
    this.name = 'CaseNotFoundError'
    this.code = 'CASE_NOT_FOUND'
  }
}

type OrganizerRow = {
  address_id: null | number | string
  case_id: number | string
  case_manufacturer: string
  case_name: string
  case_photo_id: null | number | string
  created_at: Date | string
  created_by: null | number | string
  description: string
  id: number | string
  labels: null | RawLabel[]
  name: string
  number: number | string
  items: null | RawItem[]
  total_count?: number | string
  updated_at: Date | string
  updated_by: null | number | string
}

type RawLabel = {
  byteSize: number | string
  createdAt: string
  createdBy: null | number | string
  heightMm: number | string
  id: number | string
  options: Record<string, unknown>
  pdfPath: string
  previewPath: string
  template: string
  widthMm: number | string
}

type RawItem = {
  brand: string
  id: number | string
  model: string
  name: string
  photoId: null | number | string
}

const SORT_COLUMNS: Record<OrganizerQuery['sort'], string> = {
  name: 'lower("o"."name")',
  number: '"o"."number"',
}

// The tile needs the case, its main photo, and every item with its own. Pulled
// in one statement: a screen of twenty organizers would otherwise be forty-one
// queries.
const ORGANIZER_COLUMNS = `
    "o"."id", "o"."number", "o"."name", "o"."description", "o"."address_id",
    "o"."created_by", "o"."updated_by", "o"."created_at", "o"."updated_at",
    "c"."id" AS "case_id", "c"."name" AS "case_name", "c"."manufacturer" AS "case_manufacturer",
    (SELECT "photo_id" FROM "catalog"."photo_case"
     WHERE "case_id" = "c"."id" AND "is_primary" LIMIT 1) AS "case_photo_id",
    COALESCE(
      (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'id', "t"."id", 'name', "t"."name", 'model', "t"."model",
                   'brand', (SELECT "name" FROM "catalog"."brand" WHERE "id" = "t"."brand_id"),
                   'photoId', (SELECT "photo_id" FROM "catalog"."photo_item"
                               WHERE "item_id" = "t"."id" AND "is_primary" LIMIT 1)
                 ) ORDER BY lower("t"."name")
               )
        FROM "catalog"."organizer_item" AS "ot"
        JOIN "catalog"."item" AS "t" ON "t"."id" = "ot"."item_id"
        WHERE "ot"."organizer_id" = "o"."id"
      ),
      '[]'::jsonb
    ) AS "items",
    COALESCE(
      (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'id', "l"."id", 'template', "l"."template",
                   'widthMm', "l"."width_mm", 'heightMm', "l"."height_mm",
                   'options', "l"."options", 'byteSize', "l"."byte_size",
                   'pdfPath', "l"."pdf_path", 'previewPath', "l"."preview_path",
                   'createdBy', "l"."created_by", 'createdAt', "l"."created_at"
                 ) ORDER BY "l"."created_at" DESC, "l"."id" DESC
               )
        FROM "catalog"."organizer_label" AS "l"
        WHERE "l"."organizer_id" = "o"."id"
      ),
      '[]'::jsonb
    ) AS "labels"
`

// Split from the columns so the list can add its window count between the two.
// Appending it after the FROM is how the whole endpoint answered 500.
const ORGANIZER_FROM = `
  FROM "catalog"."organizer" AS "o"
  JOIN "catalog"."tool_case" AS "c" ON "c"."id" = "o"."case_id"
`

export async function listOrganizers(
  query: OrganizerQuery,
  pool: PgPool = db(),
): Promise<OrganizerPage> {
  const column = SORT_COLUMNS[query.sort]
  const direction = query.direction === 'desc' ? 'DESC' : 'ASC'

  const result = await pool.query<OrganizerRow>(
    `
      SELECT ${ORGANIZER_COLUMNS}, count(*) OVER () AS "total_count"
      ${ORGANIZER_FROM}
      WHERE ($1::text IS NULL OR "o"."name" ILIKE $1 OR "o"."description" ILIKE $1
             OR "c"."name" ILIKE $1)
        AND ($2::bigint IS NULL OR "o"."case_id" = $2)
      ORDER BY ${column} ${direction}, "o"."id" ASC
      LIMIT $3 OFFSET $4
    `,
    [
      query.search === null ? null : `%${query.search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`,
      query.caseId,
      query.limit,
      query.offset,
    ],
  )

  return {
    items: result.rows.map(toOrganizer),
    limit: query.limit,
    offset: query.offset,
    total: Number(result.rows[0]?.total_count ?? 0),
  }
}

export async function getOrganizer(id: number, pool: PgPool = db()): Promise<null | Organizer> {
  const result = await pool.query<OrganizerRow>(
    `SELECT ${ORGANIZER_COLUMNS} ${ORGANIZER_FROM} WHERE "o"."id" = $1`,
    [id],
  )

  const row = result.rows[0]
  return row ? toOrganizer(row) : null
}

export async function createOrganizer(
  fields: OrganizerFields,
  itemIds: number[],
  actorId: number,
  pool: PgPool = db(),
): Promise<Organizer> {
  const id = await withTransaction(pool, async (client) => {
    try {
      const inserted = await client.query<{ id: string }>(
        `
          INSERT INTO "catalog"."organizer" ("number", "name", "description", "case_id",
                                             "address_id", "created_by", "updated_by")
          VALUES (
            -- The next free number when the caller did not pick one. Inside the
            -- transaction, so two people creating at once cannot both read the
            -- same maximum.
            COALESCE($1::integer, (SELECT COALESCE(max("number"), 0) + 1 FROM "catalog"."organizer")),
            $2, $3, $4, $5, $6, $6
          )
          RETURNING "id"
        `,
        [fields.number, fields.name, fields.description, fields.caseId, fields.addressId, actorId],
      )

      const organizerId = Number(inserted.rows[0].id)
      if (itemIds.length > 0) await linkItems(client, organizerId, itemIds, actorId)

      return organizerId
    } catch (error) {
      throw translateWriteError(error, fields.number)
    }
  })

  const created = await getOrganizer(id, pool)
  if (!created) throw new Error('organizer written but cannot be read back')

  return created
}

export async function updateOrganizer(
  id: number,
  patch: OrganizerPatch,
  actorId: number,
  pool: PgPool = db(),
): Promise<null | Organizer> {
  const columns: Record<keyof OrganizerPatch, string> = {
    addressId: 'address_id',
    caseId: 'case_id',
    description: 'description',
    name: 'name',
    number: 'number',
  }

  const assignments: string[] = []
  const params: unknown[] = [id, actorId]

  for (const [field, column] of Object.entries(columns) as [keyof OrganizerPatch, string][]) {
    const value = patch[field]
    if (value === undefined) continue
    params.push(value)
    assignments.push(`"${column}" = $${params.length}`)
  }

  if (assignments.length === 0) return getOrganizer(id, pool)

  try {
    const result = await pool.query<{ id: string }>(
      `
        UPDATE "catalog"."organizer"
        SET ${assignments.join(', ')}, "updated_by" = $2, "updated_at" = now()
        WHERE "id" = $1
        RETURNING "id"
      `,
      params,
    )

    return result.rows[0] ? getOrganizer(id, pool) : null
  } catch (error) {
    // A patch that does not touch the number cannot collide on it, so the
    // fallback here is never the message anyone reads.
    throw translateWriteError(error, patch.number ?? 0)
  }
}

export async function deleteOrganizer(id: number, pool: PgPool = db()): Promise<boolean> {
  const result = await pool.query(`DELETE FROM "catalog"."organizer" WHERE "id" = $1`, [id])
  return (result.rowCount ?? 0) > 0
}

// Puts items into an organizer. An item lies in exactly one place, so the
// unique index refuses one that is already somewhere else — reported as a 409
// rather than silently moving it, because moving an item out of another
// organizer is a decision somebody should make on purpose.
export async function addItems(
  organizerId: number,
  itemIds: number[],
  actorId: number,
  pool: PgPool = db(),
): Promise<null | Organizer> {
  const exists = await pool.query(`SELECT 1 FROM "catalog"."organizer" WHERE "id" = $1`, [
    organizerId,
  ])
  if ((exists.rowCount ?? 0) === 0) return null

  await withTransaction(pool, (client) => linkItems(client, organizerId, itemIds, actorId))

  return getOrganizer(organizerId, pool)
}

export async function removeItem(
  organizerId: number,
  itemId: number,
  pool: PgPool = db(),
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM "catalog"."organizer_item" WHERE "organizer_id" = $1 AND "item_id" = $2`,
    [organizerId, itemId],
  )

  return (result.rowCount ?? 0) > 0
}

// Where each of these items lies, for the catalog grid: the organizer's number
// and the case it is in, with that case's main photo.
//
// One query for a whole page, like the thumbnails: asking per card would be a
// request per row, and the catalog is read on a phone.
export type OrganizerPlacement = {
  caseId: number
  caseName: string
  casePhotoUrl: null | string
  number: number
  organizerId: number
}

export async function placementsFor(
  itemIds: number[],
  pool: PgPool = db(),
): Promise<Map<number, OrganizerPlacement>> {
  if (itemIds.length === 0) return new Map()

  const result = await pool.query<{
    case_id: string
    case_name: string
    case_photo_id: null | string
    number: string
    organizer_id: string
    item_id: string
  }>(
    `
      SELECT "ot"."item_id", "o"."id" AS "organizer_id", "o"."number",
             "c"."id" AS "case_id", "c"."name" AS "case_name",
             (SELECT "photo_id" FROM "catalog"."photo_case"
              WHERE "case_id" = "c"."id" AND "is_primary" LIMIT 1) AS "case_photo_id"
      FROM "catalog"."organizer_item" AS "ot"
      JOIN "catalog"."organizer" AS "o" ON "o"."id" = "ot"."organizer_id"
      JOIN "catalog"."tool_case" AS "c" ON "c"."id" = "o"."case_id"
      WHERE "ot"."item_id" = ANY($1::bigint[])
    `,
    [itemIds],
  )

  return new Map(
    result.rows.map((row) => [
      Number(row.item_id),
      {
        caseId: Number(row.case_id),
        caseName: row.case_name,
        casePhotoUrl: row.case_photo_id === null ? null : photoUrl(Number(row.case_photo_id)),
        number: Number(row.number),
        organizerId: Number(row.organizer_id),
      },
    ]),
  )
}

export async function insertLabel(
  input: {
    byteSize: number
    heightMm: number
    options: Record<string, unknown>
    organizerId: number
    pdfPath: string
    previewPath: string
    slotId: null | number
    template: string
    widthMm: number
  },
  actorId: number,
  pool: PgPool = db(),
): Promise<number> {
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO "catalog"."organizer_label"
        ("organizer_id", "template", "width_mm", "height_mm", "slot_id", "options",
         "pdf_path", "preview_path", "byte_size", "created_by")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING "id"
    `,
    [
      input.organizerId,
      input.template,
      input.widthMm,
      input.heightMm,
      input.slotId,
      JSON.stringify(input.options),
      input.pdfPath,
      input.previewPath,
      input.byteSize,
      actorId,
    ],
  )

  return Number(result.rows[0].id)
}

// One query for both files the label has. The caller picks the column; an
// empty one is a label with no such file, which the route answers as a 404.
export async function getLabelFile(
  organizerId: number,
  labelId: number,
  pool: PgPool = db(),
): Promise<null | { path: string; previewPath: string }> {
  const result = await pool.query<{ pdf_path: string; preview_path: string }>(
    `SELECT "pdf_path", "preview_path" FROM "catalog"."organizer_label"
     WHERE "organizer_id" = $1 AND "id" = $2`,
    [organizerId, labelId],
  )

  const row = result.rows[0]
  return row ? { path: row.pdf_path, previewPath: row.preview_path } : null
}

// Points a label at its new file. Answers with the old one to unlink, or null
// when another label is byte-identical and still points at it — the same rule
// the delete path follows, because a redraw that changes nothing produces the
// very same PDF and must not delete it out from under itself.
export async function replaceLabelFile(
  labelId: number,
  file: { byteSize: number; pdfPath: string; previewPath: string },
  pool: PgPool = db(),
): Promise<{ orphanedPath: null | string }> {
  return withTransaction(pool, async (client) => {
    // Read the old path before overwriting it, rather than asking the UPDATE to
    // hand it back: what RETURNING sees of a row it has just written is a
    // question with a subtle answer, and this one has none.
    const before = await client.query<{ pdf_path: string }>(
      `SELECT "pdf_path" FROM "catalog"."organizer_label" WHERE "id" = $1 FOR UPDATE`,
      [labelId],
    )

    await client.query(
      `
        UPDATE "catalog"."organizer_label"
        SET "pdf_path" = $2, "preview_path" = $3, "byte_size" = $4
        WHERE "id" = $1
      `,
      [labelId, file.pdfPath, file.previewPath, file.byteSize],
    )

    const previous = before.rows[0]?.pdf_path
    if (!previous || previous === file.pdfPath) return { orphanedPath: null }

    const stillUsed = await client.query(
      `SELECT 1 FROM "catalog"."organizer_label" WHERE "pdf_path" = $1 LIMIT 1`,
      [previous],
    )

    return { orphanedPath: (stillUsed.rowCount ?? 0) === 0 ? previous : null }
  })
}

// Answers with the file to unlink, or null when another label still points at
// it — identical labels share one PDF, the same rule the photos use.
export async function deleteLabel(
  organizerId: number,
  labelId: number,
  pool: PgPool = db(),
): Promise<{ orphanedPath: null | string } | null> {
  return withTransaction(pool, async (client) => {
    const deleted = await client.query<{ pdf_path: string }>(
      `DELETE FROM "catalog"."organizer_label" WHERE "organizer_id" = $1 AND "id" = $2
       RETURNING "pdf_path"`,
      [organizerId, labelId],
    )

    const row = deleted.rows[0]
    if (!row) return null
    if (!row.pdf_path) return { orphanedPath: null }

    const stillUsed = await client.query(
      `SELECT 1 FROM "catalog"."organizer_label" WHERE "pdf_path" = $1 LIMIT 1`,
      [row.pdf_path],
    )

    return { orphanedPath: (stillUsed.rowCount ?? 0) === 0 ? row.pdf_path : null }
  })
}

// Which label sizes this organizer's case offers. The wizard's first step, and
// the check that a size asked for is one of them.
export async function labelSlotsFor(
  organizerId: number,
  pool: PgPool = db(),
): Promise<{ heightMm: number; id: number; widthMm: number }[]> {
  const result = await pool.query<{ height_mm: number; id: string; width_mm: number }>(
    `
      SELECT "s"."id", "s"."width_mm", "s"."height_mm"
      FROM "catalog"."organizer" AS "o"
      JOIN "catalog"."case_label_slot" AS "s" ON "s"."case_id" = "o"."case_id"
      WHERE "o"."id" = $1
      ORDER BY "s"."width_mm", "s"."height_mm"
    `,
    [organizerId],
  )

  return result.rows.map((row) => ({
    heightMm: Number(row.height_mm),
    id: Number(row.id),
    widthMm: Number(row.width_mm),
  }))
}

// How many organizers a case would take with it. The screen asks before it
// deletes, because the arrangements are not obviously part of the box.
export async function countOrganizersOfCase(caseId: number, pool: PgPool = db()): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS "count" FROM "catalog"."organizer" WHERE "case_id" = $1`,
    [caseId],
  )

  return Number(result.rows[0]?.count ?? 0)
}

async function linkItems(
  client: { query: PgPool['query'] },
  organizerId: number,
  itemIds: number[],
  actorId: number,
): Promise<void> {
  try {
    await client.query(
      `
        INSERT INTO "catalog"."organizer_item" ("organizer_id", "item_id", "created_by")
        SELECT $1, "id", $3 FROM "catalog"."item" WHERE "id" = ANY($2::bigint[])
        ON CONFLICT ("organizer_id", "item_id") DO NOTHING
      `,
      [organizerId, itemIds, actorId],
    )
  } catch (error) {
    const failure = error as { code?: string; constraint?: string }

    // 23505 on organizer_item_once_idx: the item is in another organizer. The
    // pair conflict is handled above and is not an error.
    if (failure.code === '23505') throw new ItemAlreadyInOrganizerError()

    // 23503 on the composite key that says a drawer holds tools. The catalog
    // is one card for a drill and for a washing machine, and only one of them
    // goes in a Qbrick box.
    if (failure.code === '23503' && failure.constraint === 'organizer_item_is_a_tool_fkey') {
      throw new NotAToolError()
    }

    throw error
  }
}

function translateWriteError(error: unknown, number: null | number): unknown {
  const failure = error as { code?: string; constraint?: string }
  if (failure.code === '23505') return new NumberTakenError(number ?? 0)

  // 23503 is a foreign key that matched nothing, and an organizer has two of
  // them now. Which one is in the constraint name — without reading it, adding
  // the address would have made every bad address id report a missing case.
  if (failure.code === '23503') {
    if (failure.constraint === 'organizer_address_id_fkey') return new AddressNotFoundError()
    // The composite key that says an organizer holds tools. A washing machine
    // is on the same kind of card and is not going into a Qbrick box.
    if (failure.constraint === 'organizer_item_is_a_tool_fkey') return new NotAToolError()
    return new CaseNotFoundError()
  }

  return error
}

function toOrganizer(row: OrganizerRow): Organizer {
  return {
    case: {
      id: Number(row.case_id),
      manufacturer: row.case_manufacturer,
      name: row.case_name,
      primaryPhotoUrl: row.case_photo_id === null ? null : photoUrl(Number(row.case_photo_id)),
    },
    addressId: row.address_id === null ? null : Number(row.address_id),
    createdAt: toIsoString(row.created_at),
    createdBy: row.created_by === null ? null : Number(row.created_by),
    description: row.description,
    id: Number(row.id),
    labels: (row.labels ?? []).map((label) => ({
      byteSize: Number(label.byteSize),
      createdAt: toIsoString(label.createdAt),
      createdBy: label.createdBy === null ? null : Number(label.createdBy),
      heightMm: Number(label.heightMm),
      id: Number(label.id),
      options: label.options ?? {},
      previewUrl: labelPreviewUrl(Number(row.id), Number(label.id), label.previewPath),
      template: label.template,
      url: labelFileUrl(Number(row.id), Number(label.id), label.pdfPath),
      widthMm: Number(label.widthMm),
    })),
    name: row.name,
    number: Number(row.number),
    items: (row.items ?? []).map((item) => ({
      brand: item.brand,
      id: Number(item.id),
      model: item.model,
      name: item.name,
      primaryPhotoUrl: item.photoId === null ? null : photoUrl(Number(item.photoId)),
    })),
    updatedAt: toIsoString(row.updated_at),
    updatedBy: row.updated_by === null ? null : Number(row.updated_by),
  }
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
