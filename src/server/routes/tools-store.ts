// Everything that touches `catalog.tool`. The route module above it does no
// SQL, and every statement here is parameterised: the only user input that
// reaches the query text is a column name chosen from a fixed map.

import { db, withTransaction, type PgPool } from '../db'
import type { ErrorCode } from '../error-codes'
import { brandIdForName } from './brands-store'
import { t } from '../i18n'
import { listAttributes, type Attribute } from './attributes-store'
import type { ToolPlacement } from './organizers-store'
import {
  DEFAULT_CONDITION,
  isToolCondition,
  type ToolCondition,
  type ToolFields,
  type ToolPatch,
  type ToolQuery,
} from './tools-input'

export type Tool = {
  brand: string
  category: string
  condition: ToolCondition
  createdAt: string
  createdBy: null | number
  id: number
  model: string
  name: string
  notes: string
  serialNumber: string
  updatedAt: string
  updatedBy: null | number
}

// A tool with what is only worth reading one at a time. The list answers with
// `Tool`: a grid of cards shows a name, a maker and a condition, and sending
// every card's spec sheet to draw that would be paying for what nobody reads.
export type ToolDetail = Tool & {
  attributes: Attribute[]
}

export type ToolPage = {
  items: Tool[]
  limit: number
  offset: number
  total: number
}

// What `GET /api/tools` actually answers with, which is not `ToolPage`.
//
// The grid needs two things a card does not carry: the thumbnail to draw and
// where the tool lies. Both are fetched for the whole page in one query each
// rather than per row, and the route hangs them on every item — so the list
// item is a wider thing than the card, and the type says so. It is named here
// rather than left as a literal in the handler because the OpenAPI schemas are
// generated from these types: a shape the API returns and no type describes is
// a shape the contract would get wrong.
export type ToolListItem = Tool & {
  organizer: null | ToolPlacement
  primaryPhotoUrl: null | string
}

export type ToolListPage = Omit<ToolPage, 'items'> & {
  items: ToolListItem[]
}

export type CategoryCount = {
  category: string
  count: number
}

export class SerialNumberTakenError extends Error {
  readonly code: ErrorCode

  constructor(serialNumber: string) {
    super(`Serial number ${serialNumber} is already on another tool`)
    this.name = 'SerialNumberTakenError'
    this.code = 'SERIAL_NUMBER_TAKEN'
  }
}

type ToolRow = {
  brand: string
  category: string
  condition: string
  created_at: Date | string
  created_by: null | number | string
  id: number | string
  model: string
  name: string
  notes: string
  serial_number: string
  total_count?: number | string
  updated_at: Date | string
  updated_by: null | number | string
}

const TOOL_COLUMNS = `
  "id", "name", "category", "brand", "model", "serial_number", "condition", "notes",
  "created_by", "updated_by", "created_at", "updated_at"
`

// The only place a sort key becomes SQL. A value that is not in this map
// cannot reach the query, whatever arrives in the query string.
const SORT_COLUMNS: Record<ToolQuery['sort'], string> = {
  createdAt: '"created_at"',
  name: 'lower("name")',
  updatedAt: '"updated_at"',
}

export async function listTools(query: ToolQuery, pool: PgPool = db()): Promise<ToolPage> {
  const column = SORT_COLUMNS[query.sort]
  const direction = query.direction === 'asc' ? 'ASC' : 'DESC'

  // count(*) OVER () rather than a second COUNT query: the filter is written
  // once, so the total can never describe a different set than the rows.
  const result = await pool.query<ToolRow>(
    `
      SELECT ${TOOL_COLUMNS}, count(*) OVER () AS "total_count"
      FROM "catalog"."tool"
      WHERE ($1::text IS NULL OR (
              "name" ILIKE $1 OR "brand" ILIKE $1 OR "model" ILIKE $1
              OR "serial_number" ILIKE $1 OR "category" ILIKE $1 OR "notes" ILIKE $1))
        AND ($2::text IS NULL OR lower("category") = lower($2))
        AND ($3::text IS NULL OR "condition" = $3)
        -- Whether this tool is in an organizer. The wizard asks for the ones
        -- that are not, because a tool lies in exactly one place.
        AND ($6::boolean IS NULL OR EXISTS (
              SELECT 1 FROM "catalog"."organizer_tool" WHERE "tool_id" = "catalog"."tool"."id"
            ) = $6)
      ORDER BY ${column} ${direction}, "id" DESC
      LIMIT $4 OFFSET $5
    `,
    [
      query.search === null ? null : likePattern(query.search),
      query.category,
      query.condition,
      query.limit,
      query.offset,
      query.inOrganizer,
    ],
  )

  return {
    items: result.rows.map(toTool),
    limit: query.limit,
    offset: query.offset,
    // No rows means no matches, not an empty page of an unknown total.
    total: Number(result.rows[0]?.total_count ?? 0),
  }
}

export async function getTool(id: number, pool: PgPool = db()): Promise<null | Tool> {
  const result = await pool.query<ToolRow>(
    `SELECT ${TOOL_COLUMNS} FROM "catalog"."tool" WHERE "id" = $1`,
    [id],
  )

  const row = result.rows[0]
  return row ? toTool(row) : null
}

// Oldest first, which is the order they were typed in — a spec sheet is copied
// from the top, and sorting by name would shuffle it into something nobody
// wrote. Two statements rather than a join: a join would repeat the whole tool
// row once per parameter, and the two are assembled here anyway.
export async function getToolDetail(id: number, pool: PgPool = db()): Promise<null | ToolDetail> {
  const tool = await getTool(id, pool)
  if (!tool) return null

  return { ...tool, attributes: await listAttributes('tool', id, pool) }
}

export async function createTool(
  fields: ToolFields,
  actorId: number,
  pool: PgPool = db(),
): Promise<Tool> {
  try {
    const result = await pool.query<ToolRow>(
      `
        INSERT INTO "catalog"."tool"
          ("name", "category", "brand", "model", "serial_number", "condition", "notes",
           "created_by", "updated_by", "brand_id")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)
        RETURNING ${TOOL_COLUMNS}
      `,
      [
        fields.name,
        fields.category,
        fields.brand,
        fields.model,
        fields.serialNumber,
        fields.condition,
        fields.notes,
        actorId,
        // The maker is typed as text on the card. When it names a brand we
        // know, the row points at it too; when it does not, it points at
        // nothing rather than at a brand invented from a typo.
        await brandIdForName(fields.brand, pool),
      ],
    )

    return toTool(result.rows[0])
  } catch (error) {
    throw translateWriteError(error, fields.serialNumber)
  }
}

export async function updateTool(
  id: number,
  patch: ToolPatch,
  actorId: number,
  pool: PgPool = db(),
): Promise<null | Tool> {
  const columns: Record<keyof ToolPatch, string> = {
    brand: 'brand',
    category: 'category',
    condition: 'condition',
    model: 'model',
    name: 'name',
    notes: 'notes',
    serialNumber: 'serial_number',
  }

  const assignments: string[] = []
  const params: unknown[] = [id, actorId]

  for (const [field, column] of Object.entries(columns) as [keyof ToolPatch, string][]) {
    const value = patch[field]
    if (value === undefined) continue
    params.push(value)
    assignments.push(`"${column}" = $${params.length}`)
  }

  // A renamed maker repoints the row as well, by the same rule as on create.
  if (patch.brand !== undefined) {
    params.push(await brandIdForName(patch.brand, pool))
    assignments.push(`"brand_id" = $${params.length}`)
  }

  // parseToolPatch already refuses an empty patch, so this only guards a
  // caller inside the server calling it directly.
  if (assignments.length === 0) return getTool(id, pool)

  try {
    const result = await pool.query<ToolRow>(
      `
        UPDATE "catalog"."tool"
        SET ${assignments.join(', ')}, "updated_by" = $2, "updated_at" = now()
        WHERE "id" = $1
        RETURNING ${TOOL_COLUMNS}
      `,
      params,
    )

    const row = result.rows[0]
    return row ? toTool(row) : null
  } catch (error) {
    throw translateWriteError(error, patch.serialNumber ?? '')
  }
}

// Another one of these. A crew with three identical grinders wants three
// cards, and typing the same six fields three times is how the third one ends
// up saying something slightly different from the first two.
//
// INSERT ... SELECT rather than read-then-write: one statement, so the copy
// cannot drift from the original between the two, and the columns are named
// once. The serial number is the one field deliberately not copied — it
// identifies a single physical machine, and the unique index would refuse the
// second card anyway.
export async function duplicateTool(
  id: number,
  actorId: number,
  pool: PgPool = db(),
): Promise<null | ToolDetail> {
  const result = await pool.query<ToolRow>(
    `
      INSERT INTO "catalog"."tool"
        ("name", "category", "brand", "model", "serial_number", "condition", "notes",
         "created_by", "updated_by")
      SELECT "name", "category", "brand", "model", '', "condition", "notes", $2, $2
      FROM "catalog"."tool"
      WHERE "id" = $1
      RETURNING ${TOOL_COLUMNS}
    `,
    [id, actorId],
  )

  const row = result.rows[0]
  if (!row) return null

  // The spec sheet goes with it. The parameters describe the model rather than
  // this particular machine — a second identical grinder is still 230 V — and
  // the reason to duplicate a card is to avoid typing all of that again. The
  // serial number is the one thing deliberately left behind.
  const copy = toTool(row)
  await pool.query(
    `
      INSERT INTO "catalog"."attribute" ("reference", "reference_id", "name", "value", "created_by")
      SELECT 'tool', $2, "name", "value", $3
      FROM "catalog"."attribute"
      WHERE "reference" = 'tool' AND "reference_id" = $1
      ORDER BY "id" ASC
    `,
    [id, copy.id, actorId],
  )

  return { ...copy, attributes: await listAttributes('tool', copy.id, pool) }
}

export async function deleteTool(id: number, pool: PgPool = db()): Promise<boolean> {
  const result = await pool.query(`DELETE FROM "catalog"."tool" WHERE "id" = $1`, [id])
  return (result.rowCount ?? 0) > 0
}

// What the category filter offers. Read from the tools themselves rather than
// from a category table, because the tools are where categories come from.
export async function listCategories(pool: PgPool = db()): Promise<CategoryCount[]> {
  const result = await pool.query<{ category: string; count: string }>(
    `
      SELECT "category", count(*)::text AS "count"
      FROM "catalog"."tool"
      WHERE "category" <> ''
      GROUP BY "category"
      ORDER BY lower("category") ASC
    `,
  )

  return result.rows.map((row) => ({ category: row.category, count: Number(row.count) }))
}

function translateWriteError(error: unknown, serialNumber: string): unknown {
  // 23505 on catalog_tool_serial_number_idx: the same physical machine already
  // has a card. That is a 409 the client can act on, not a 500.
  if ((error as { code?: string }).code === '23505') {
    return new SerialNumberTakenError(serialNumber)
  }
  return error
}

// `%` and `_` are wildcards in ILIKE, and a search for "GBH 2-26_" means the
// underscore. The backslash is escaped first, or escaping the other two would
// then be undone by the pattern's own backslashes.
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (match) => `\\${match}`)}%`
}

function toTool(row: ToolRow): Tool {
  return {
    brand: row.brand,
    category: row.category,
    condition: isToolCondition(row.condition) ? row.condition : DEFAULT_CONDITION,
    createdAt: toIsoString(row.created_at),
    createdBy: row.created_by === null ? null : Number(row.created_by),
    id: Number(row.id),
    model: row.model,
    name: row.name,
    notes: row.notes,
    serialNumber: row.serial_number,
    updatedAt: toIsoString(row.updated_at),
    updatedBy: row.updated_by === null ? null : Number(row.updated_by),
  }
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
