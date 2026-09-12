// Everything that touches `catalog.organizer` and `catalog.organizer_tool`.
//
// The list carries enough for the screen to draw a tile without a second
// request per row: the case, its main photo, and every tool with its own.
// That is one query with two aggregates rather than N+1.

import { db, withTransaction, type PgPool } from '../db'
import type { OrganizerFields, OrganizerPatch, OrganizerQuery } from './organizers-input'
import { photoUrl } from './photos-store'

export type OrganizerTool = {
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
  template: string
  // Where the bytes are served from. The path on disk is ours to change.
  url: string
  widthMm: number
}

export type Organizer = {
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
  tools: OrganizerTool[]
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
  constructor(number: number) {
    super(`Numer ${number} jest już zajęty przez inny organizer`)
    this.name = 'NumberTakenError'
  }
}

export class ToolAlreadyInOrganizerError extends Error {
  constructor() {
    super('To narzędzie jest już w innym organizerze')
    this.name = 'ToolAlreadyInOrganizerError'
  }
}

export class CaseNotFoundError extends Error {
  constructor() {
    super('Nie ma takiej skrzynki')
    this.name = 'CaseNotFoundError'
  }
}

type OrganizerRow = {
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
  tools: null | RawTool[]
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
  template: string
  widthMm: number | string
}

type RawTool = {
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

// The tile needs the case, its main photo, and every tool with its own. Pulled
// in one statement: a screen of twenty organizers would otherwise be forty-one
// queries.
const ORGANIZER_COLUMNS = `
    "o"."id", "o"."number", "o"."name", "o"."description",
    "o"."created_by", "o"."updated_by", "o"."created_at", "o"."updated_at",
    "c"."id" AS "case_id", "c"."name" AS "case_name", "c"."manufacturer" AS "case_manufacturer",
    (SELECT "photo_id" FROM "catalog"."photo_case"
     WHERE "case_id" = "c"."id" AND "is_primary" LIMIT 1) AS "case_photo_id",
    COALESCE(
      (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'id', "t"."id", 'name', "t"."name", 'brand', "t"."brand", 'model', "t"."model",
                   'photoId', (SELECT "photo_id" FROM "catalog"."photo_tool"
                               WHERE "tool_id" = "t"."id" AND "is_primary" LIMIT 1)
                 ) ORDER BY lower("t"."name")
               )
        FROM "catalog"."organizer_tool" AS "ot"
        JOIN "catalog"."tool" AS "t" ON "t"."id" = "ot"."tool_id"
        WHERE "ot"."organizer_id" = "o"."id"
      ),
      '[]'::jsonb
    ) AS "tools",
    COALESCE(
      (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'id', "l"."id", 'template', "l"."template",
                   'widthMm', "l"."width_mm", 'heightMm', "l"."height_mm",
                   'options', "l"."options", 'byteSize', "l"."byte_size",
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
  toolIds: number[],
  actorId: number,
  pool: PgPool = db(),
): Promise<Organizer> {
  const id = await withTransaction(pool, async (client) => {
    try {
      const inserted = await client.query<{ id: string }>(
        `
          INSERT INTO "catalog"."organizer" ("number", "name", "description", "case_id",
                                             "created_by", "updated_by")
          VALUES (
            -- The next free number when the caller did not pick one. Inside the
            -- transaction, so two people creating at once cannot both read the
            -- same maximum.
            COALESCE($1::integer, (SELECT COALESCE(max("number"), 0) + 1 FROM "catalog"."organizer")),
            $2, $3, $4, $5, $5
          )
          RETURNING "id"
        `,
        [fields.number, fields.name, fields.description, fields.caseId, actorId],
      )

      const organizerId = Number(inserted.rows[0].id)
      if (toolIds.length > 0) await linkTools(client, organizerId, toolIds, actorId)

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

// Puts tools into an organizer. A tool lies in exactly one place, so the
// unique index refuses one that is already somewhere else — reported as a 409
// rather than silently moving it, because moving a tool out of another
// organizer is a decision somebody should make on purpose.
export async function addTools(
  organizerId: number,
  toolIds: number[],
  actorId: number,
  pool: PgPool = db(),
): Promise<null | Organizer> {
  const exists = await pool.query(`SELECT 1 FROM "catalog"."organizer" WHERE "id" = $1`, [
    organizerId,
  ])
  if ((exists.rowCount ?? 0) === 0) return null

  await withTransaction(pool, (client) => linkTools(client, organizerId, toolIds, actorId))

  return getOrganizer(organizerId, pool)
}

export async function removeTool(
  organizerId: number,
  toolId: number,
  pool: PgPool = db(),
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM "catalog"."organizer_tool" WHERE "organizer_id" = $1 AND "tool_id" = $2`,
    [organizerId, toolId],
  )

  return (result.rowCount ?? 0) > 0
}

// Where each of these tools lies, for the catalog grid: the organizer's number
// and the case it is in, with that case's main photo.
//
// One query for a whole page, like the thumbnails: asking per card would be a
// request per row, and the catalog is read on a phone.
export type ToolPlacement = {
  caseId: number
  caseName: string
  casePhotoUrl: null | string
  number: number
  organizerId: number
}

export async function placementsFor(
  toolIds: number[],
  pool: PgPool = db(),
): Promise<Map<number, ToolPlacement>> {
  if (toolIds.length === 0) return new Map()

  const result = await pool.query<{
    case_id: string
    case_name: string
    case_photo_id: null | string
    number: string
    organizer_id: string
    tool_id: string
  }>(
    `
      SELECT "ot"."tool_id", "o"."id" AS "organizer_id", "o"."number",
             "c"."id" AS "case_id", "c"."name" AS "case_name",
             (SELECT "photo_id" FROM "catalog"."photo_case"
              WHERE "case_id" = "c"."id" AND "is_primary" LIMIT 1) AS "case_photo_id"
      FROM "catalog"."organizer_tool" AS "ot"
      JOIN "catalog"."organizer" AS "o" ON "o"."id" = "ot"."organizer_id"
      JOIN "catalog"."tool_case" AS "c" ON "c"."id" = "o"."case_id"
      WHERE "ot"."tool_id" = ANY($1::bigint[])
    `,
    [toolIds],
  )

  return new Map(
    result.rows.map((row) => [
      Number(row.tool_id),
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
         "pdf_path", "byte_size", "created_by")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
      input.byteSize,
      actorId,
    ],
  )

  return Number(result.rows[0].id)
}

export async function getLabelFile(
  organizerId: number,
  labelId: number,
  pool: PgPool = db(),
): Promise<null | { path: string }> {
  const result = await pool.query<{ pdf_path: string }>(
    `SELECT "pdf_path" FROM "catalog"."organizer_label" WHERE "organizer_id" = $1 AND "id" = $2`,
    [organizerId, labelId],
  )

  const row = result.rows[0]
  return row && row.pdf_path ? { path: row.pdf_path } : null
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

async function linkTools(
  client: { query: PgPool['query'] },
  organizerId: number,
  toolIds: number[],
  actorId: number,
): Promise<void> {
  try {
    await client.query(
      `
        INSERT INTO "catalog"."organizer_tool" ("organizer_id", "tool_id", "created_by")
        SELECT $1, "id", $3 FROM "catalog"."tool" WHERE "id" = ANY($2::bigint[])
        ON CONFLICT ("organizer_id", "tool_id") DO NOTHING
      `,
      [organizerId, toolIds, actorId],
    )
  } catch (error) {
    // 23505 on organizer_tool_once_idx: the tool is in another organizer. The
    // pair conflict is handled above and is not an error.
    if ((error as { code?: string }).code === '23505') throw new ToolAlreadyInOrganizerError()
    throw error
  }
}

function translateWriteError(error: unknown, number: null | number): unknown {
  const code = (error as { code?: string }).code
  if (code === '23505') return new NumberTakenError(number ?? 0)
  // 23503: the case id does not exist. A 404 answer, not a 500.
  if (code === '23503') return new CaseNotFoundError()
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
      template: label.template,
      url: `/api/organizers/${Number(row.id)}/labels/${Number(label.id)}/file`,
      widthMm: Number(label.widthMm),
    })),
    name: row.name,
    number: Number(row.number),
    tools: (row.tools ?? []).map((tool) => ({
      brand: tool.brand,
      id: Number(tool.id),
      model: tool.model,
      name: tool.name,
      primaryPhotoUrl: tool.photoId === null ? null : photoUrl(Number(tool.photoId)),
    })),
    updatedAt: toIsoString(row.updated_at),
    updatedBy: row.updated_by === null ? null : Number(row.updated_by),
  }
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
