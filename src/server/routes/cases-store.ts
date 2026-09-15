// Everything that touches `catalog.tool_case`. The route module above it does
// no SQL, and every statement here is parameterised: the only user input that
// reaches the query text is a column name chosen from a fixed map.

import { db, type PgPool } from '../db'
import type { ErrorCode } from '../error-codes'
import { listAttributes, type Attribute } from './attributes-store'
import type { ItemBrand } from './items-store'
import type { CaseFields, CasePatch, CaseQuery } from './cases-input'
import { t } from '../i18n'

// Where a label goes on this case: a size and nothing else. What gets printed
// on it is a different question.
export type LabelSlot = {
  heightMm: number
  id: number
  widthMm: number
}

export class LabelSlotTakenError extends Error {
  readonly code: ErrorCode

  constructor(widthMm: number, heightMm: number) {
    super(
      t('Ta skrzynka ma już miejsce {width} x {height} mm', {
        height: heightMm,
        width: widthMm,
      }),
    )
    this.name = 'LabelSlotTakenError'
    this.code = 'LABEL_SLOT_TAKEN'
  }
}

export type ToolCase = {
  // Not beside the columns any more — instead of them. A box was eleven columns
  // of measurements because a box is mostly measurements, until the next kind
  // of box states something else and a twelfth column is a migration rather
  // than a row. The sheet already took a name and a value with its unit.
  attributes: Attribute[]
  brand: null | ItemBrand
  createdAt: string
  createdBy: null | number
  id: number
  labelSlots: LabelSlot[]
  name: string
  notes: string
  // Where an import read this box from, empty when nobody imported it. The
  // same field an item card has, and it was the same parameter before that.
  referenceUrl: string
  system: string
  updatedAt: string
  updatedBy: null | number
}

// What `GET /api/cases` actually answers with, which is not `CasePage`.
//
// The grid needs a thumbnail, fetched for the whole page in one query rather
// than per row, and the route hangs it on every item — so the list item is a
// wider thing than the case. Named here rather than left as a literal in the
// handler for the same reason `ItemSummary` is: the OpenAPI schemas are
// generated from these types, and a shape the API returns and no type
// describes is a shape the contract would get wrong.
export type CaseListItem = ToolCase & {
  primaryPhotoUrl: null | string
}

export type CaseListPage = Omit<CasePage, 'items'> & {
  items: CaseListItem[]
}

export type CasePage = {
  items: ToolCase[]
  limit: number
  offset: number
  total: number
}

export type SystemCount = {
  count: number
  system: string
}

type RawSlot = { heightMm: number | string; id: number | string; widthMm: number | string }

type CaseRow = {
  brand_color: null | string
  brand_id: null | number | string
  brand_name: null | string
  created_at: Date | string
  created_by: null | number | string
  id: number | string
  label_slots?: null | RawSlot[]
  name: string
  notes: string
  reference_url: string
  system: string
  total_count?: number | string
  updated_at: Date | string
  updated_by: null | number | string
}

const CASE_COLUMNS = `
  "c"."id", "c"."name", "c"."system", "c"."notes", "c"."reference_url",
  "c"."created_by", "c"."updated_by", "c"."created_at", "c"."updated_at",
  "b"."id" AS "brand_id", "b"."name" AS "brand_name", "b"."color" AS "brand_color"
`

// LEFT, because a box whose maker nobody has recorded is still a box.
const CASE_FROM = `
  FROM "catalog"."tool_case" AS "c"
  LEFT JOIN "catalog"."brand" AS "b" ON "b"."id" = "c"."brand_id"
`

// Every field that can be written, and the column it lands in. Create and
// patch both read this, so a new property cannot reach one and be forgotten by
// the other.
const WRITABLE_COLUMNS: Record<keyof CaseFields, string> = {
  brandId: 'brand_id',
  name: 'name',
  notes: 'notes',
  referenceUrl: 'reference_url',
  system: 'system',
}

// The only place a sort key becomes SQL. A value that is not in this map
// cannot reach the query, whatever arrives in the query string.
// Capacity is gone from here, and deliberately. It is a parameter now, which
// means free text with its unit in it — "11 L" — and sorting a shelf by that
// would mean a regular expression and a cast in the ORDER BY, for a question
// about six boxes. A shelf is read alphabetically.
const SORT_COLUMNS: Record<CaseQuery['sort'], string> = {
  createdAt: '"c"."created_at"',
  name: 'lower("c"."name")',
  updatedAt: '"c"."updated_at"',
}

export async function listCases(query: CaseQuery, pool: PgPool = db()): Promise<CasePage> {
  const column = SORT_COLUMNS[query.sort]
  const direction = query.direction === 'asc' ? 'ASC' : 'DESC'

  // count(*) OVER () rather than a second COUNT query: the filter is written
  // once, so the total can never describe a different set than the rows.
  const result = await pool.query<CaseRow>(
    `
      SELECT ${CASE_COLUMNS}, count(*) OVER () AS "total_count"
      ${CASE_FROM}
      WHERE ($1::text IS NULL OR (
              "c"."name" ILIKE $1 OR "b"."name" ILIKE $1 OR "c"."system" ILIKE $1
              OR "c"."notes" ILIKE $1
              -- The barcode and the catalogue number are parameters now, and
              -- they are exactly what somebody types into a search box when
              -- they have the box in their hands. So the sheet is searched too.
              OR EXISTS (
                   SELECT 1 FROM "catalog"."attribute" AS "s"
                   WHERE "s"."reference" = 'tool_case' AND "s"."reference_id" = "c"."id"
                     AND "s"."value" ILIKE $1
                 )))
        AND ($2::text IS NULL OR lower("b"."name") = lower($2))
        AND ($3::text IS NULL OR lower("c"."system") = lower($3))
      ORDER BY ${column} ${direction}, "c"."id" DESC
      LIMIT $4 OFFSET $5
    `,
    [
      query.search === null ? null : likePattern(query.search),
      query.manufacturer,
      query.system,
      query.limit,
      query.offset,
    ],
  )

  return {
    items: result.rows.map(toCase),
    limit: query.limit,
    offset: query.offset,
    total: Number(result.rows[0]?.total_count ?? 0),
  }
}

export async function getCase(id: number, pool: PgPool = db()): Promise<null | ToolCase> {
  const result = await pool.query<CaseRow>(
    `
      SELECT ${CASE_COLUMNS},
        COALESCE(
          (
            SELECT jsonb_agg(
                     jsonb_build_object('id', "s"."id", 'widthMm', "s"."width_mm",
                                        'heightMm', "s"."height_mm")
                     ORDER BY "s"."width_mm", "s"."height_mm"
                   )
            FROM "catalog"."case_label_slot" AS "s"
            WHERE "s"."case_id" = "c"."id"
          ),
          '[]'::jsonb
        ) AS "label_slots"
      ${CASE_FROM}
      WHERE "c"."id" = $1
    `,
    [id],
  )

  const row = result.rows[0]
  if (!row) return null

  // The detail read is the one that carries everything, the way getItemDetail
  // does: a list shows a name and a maker, and sending every box's spec sheet
  // to draw that would be paying for what nobody reads.
  return { ...toCase(row), attributes: await listAttributes('tool_case', Number(row.id), pool) }
}

export async function createCase(
  fields: CaseFields,
  actorId: number,
  pool: PgPool = db(),
): Promise<ToolCase> {
  const entries = Object.entries(WRITABLE_COLUMNS) as [keyof CaseFields, string][]
  const params: unknown[] = [actorId]
  const columns: string[] = []
  const placeholders: string[] = []

  for (const [field, column] of entries) {
    params.push(fields[field])
    columns.push(`"${column}"`)
    placeholders.push(`$${params.length}`)
  }

  // RETURNING cannot reach the maker: it answers with the row that was written
  // and the name lives in another table. So the insert answers with an id and
  // the box is read back through the same join every other read uses.
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO "catalog"."tool_case" (${columns.join(', ')}, "created_by", "updated_by")
      VALUES (${placeholders.join(', ')}, $1, $1)
      RETURNING "id"
    `,
    params,
  )

  const created = await getCase(Number(result.rows[0].id), pool)
  if (!created) throw new Error('case written but cannot be read back')

  return created
}

export async function updateCase(
  id: number,
  patch: CasePatch,
  actorId: number,
  pool: PgPool = db(),
): Promise<null | ToolCase> {
  const assignments: string[] = []
  const params: unknown[] = [id, actorId]

  for (const [field, column] of Object.entries(WRITABLE_COLUMNS) as [keyof CaseFields, string][]) {
    const value = patch[field]
    // `undefined` means the client did not mention the field; null means it
    // asked for the measurement to be forgotten.
    if (value === undefined) continue
    params.push(value)
    assignments.push(`"${column}" = $${params.length}`)
  }

  // parseCasePatch already refuses an empty patch, so this only guards a
  // caller inside the server calling it directly.
  if (assignments.length === 0) return getCase(id, pool)

  const result = await pool.query<{ id: string }>(
    `
      UPDATE "catalog"."tool_case"
      SET ${assignments.join(', ')}, "updated_by" = $2, "updated_at" = now()
      WHERE "id" = $1
      RETURNING "id"
    `,
    params,
  )

  // Read back for the maker, as on create.
  return result.rows[0] ? getCase(id, pool) : null
}

export async function deleteCase(id: number, pool: PgPool = db()): Promise<boolean> {
  const result = await pool.query(`DELETE FROM "catalog"."tool_case" WHERE "id" = $1`, [id])
  return (result.rowCount ?? 0) > 0
}

export async function addLabelSlot(
  caseId: number,
  widthMm: number,
  heightMm: number,
  actorId: number,
  pool: PgPool = db(),
): Promise<LabelSlot> {
  try {
    const result = await pool.query<{ height_mm: number; id: string; width_mm: number }>(
      `
        INSERT INTO "catalog"."case_label_slot" ("case_id", "width_mm", "height_mm", "created_by")
        VALUES ($1, $2, $3, $4)
        RETURNING "id", "width_mm", "height_mm"
      `,
      [caseId, widthMm, heightMm, actorId],
    )

    const row = result.rows[0]
    return { heightMm: Number(row.height_mm), id: Number(row.id), widthMm: Number(row.width_mm) }
  } catch (error) {
    const code = (error as { code?: string }).code
    // The pair is the key: the same size twice on one case is a mistake, not a
    // second place.
    if (code === '23505') throw new LabelSlotTakenError(widthMm, heightMm)
    if (code === '23503') return Promise.reject(error)
    throw error
  }
}

export async function removeLabelSlot(
  caseId: number,
  slotId: number,
  pool: PgPool = db(),
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM "catalog"."case_label_slot" WHERE "case_id" = $1 AND "id" = $2`,
    [caseId, slotId],
  )

  return (result.rowCount ?? 0) > 0
}

// What the system filter offers, read from the cases themselves — the same
// reasoning as item categories: the shelf is where the systems come from.
export async function listSystems(pool: PgPool = db()): Promise<SystemCount[]> {
  const result = await pool.query<{ count: string; system: string }>(
    `
      SELECT "system", count(*)::text AS "count"
      FROM "catalog"."tool_case"
      WHERE "system" <> ''
      GROUP BY "system"
      ORDER BY lower("system") ASC
    `,
  )

  return result.rows.map((row) => ({ count: Number(row.count), system: row.system }))
}

// `%` and `_` are wildcards in ILIKE, and a search for "Toolbox_2" means the
// underscore. The backslash is escaped first, or escaping the other two would
// then be undone by the pattern's own backslashes.
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (match) => `\\${match}`)}%`
}

function toCase(row: CaseRow): ToolCase {
  return {
    // Filled in by whoever read the case; a row on its own carries no spec
    // sheet, the same way an item row does not.
    attributes: [],
    brand:
      row.brand_id === null
        ? null
        : { color: row.brand_color ?? '', id: Number(row.brand_id), name: row.brand_name ?? '' },
    createdAt: toIsoString(row.created_at),
    createdBy: row.created_by === null ? null : Number(row.created_by),
    id: Number(row.id),
    labelSlots: (row.label_slots ?? []).map((slot) => ({
      heightMm: Number(slot.heightMm),
      id: Number(slot.id),
      widthMm: Number(slot.widthMm),
    })),
    name: row.name,
    notes: row.notes,
    referenceUrl: row.reference_url,
    system: row.system,
    updatedAt: toIsoString(row.updated_at),
    updatedBy: row.updated_by === null ? null : Number(row.updated_by),
  }
}

function toNumber(value: null | number | string): null | number {
  return value === null ? null : Number(value)
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
