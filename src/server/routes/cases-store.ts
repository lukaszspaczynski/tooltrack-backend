// Everything that touches `catalog.tool_case`. The route module above it does
// no SQL, and every statement here is parameterised: the only user input that
// reaches the query text is a column name chosen from a fixed map.

import { db, type PgPool } from '../db'
import type { ErrorCode } from '../error-codes'
import { listAttributes, type Attribute } from './attributes-store'
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
  // Beside the columns, not instead of them. The measurements a box is
  // catalogued by have a shape every case shares — a length is a length — and
  // the sheet is for what they do not cover: a system, a lid type, whatever the
  // next kind of box turns out to state.
  attributes: Attribute[]
  capacityL: null | number
  createdAt: string
  createdBy: null | number
  diagonalMm: null | number
  ean: string
  id: number
  innerHeightMm: null | number
  innerLengthMm: null | number
  innerWidthMm: null | number
  loadKg: null | number
  manufacturer: string
  name: string
  notes: string
  // Where an import read this box from, empty when nobody imported it. The
  // same field an item card has, and it was the same parameter before that.
  referenceUrl: string
  outerHeightMm: null | number
  outerLengthMm: null | number
  outerWidthMm: null | number
  labelSlots: LabelSlot[]
  sku: string
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
  capacity_l: null | number | string
  created_at: Date | string
  created_by: null | number | string
  diagonal_mm: null | number | string
  ean: string
  id: number | string
  inner_height_mm: null | number | string
  inner_length_mm: null | number | string
  inner_width_mm: null | number | string
  label_slots?: null | RawSlot[]
  load_kg: null | number | string
  manufacturer: string
  name: string
  notes: string
  outer_height_mm: null | number | string
  outer_length_mm: null | number | string
  outer_width_mm: null | number | string
  reference_url: string
  sku: string
  system: string
  total_count?: number | string
  updated_at: Date | string
  updated_by: null | number | string
}

const CASE_COLUMNS = `
  "id", "name", "manufacturer", "system",
  "outer_length_mm", "outer_width_mm", "outer_height_mm",
  "inner_length_mm", "inner_width_mm", "inner_height_mm",
  "diagonal_mm", "capacity_l", "load_kg", "ean", "sku", "notes", "reference_url",
  "created_by", "updated_by", "created_at", "updated_at"
`

// Every field that can be written, and the column it lands in. Create and
// patch both read this, so a new property cannot reach one and be forgotten by
// the other.
const WRITABLE_COLUMNS: Record<keyof CaseFields, string> = {
  capacityL: 'capacity_l',
  diagonalMm: 'diagonal_mm',
  ean: 'ean',
  innerHeightMm: 'inner_height_mm',
  innerLengthMm: 'inner_length_mm',
  innerWidthMm: 'inner_width_mm',
  loadKg: 'load_kg',
  manufacturer: 'manufacturer',
  name: 'name',
  notes: 'notes',
  referenceUrl: 'reference_url',
  outerHeightMm: 'outer_height_mm',
  outerLengthMm: 'outer_length_mm',
  outerWidthMm: 'outer_width_mm',
  sku: 'sku',
  system: 'system',
}

// The only place a sort key becomes SQL. A value that is not in this map
// cannot reach the query, whatever arrives in the query string.
const SORT_COLUMNS: Record<CaseQuery['sort'], string> = {
  capacityL: '"capacity_l"',
  createdAt: '"created_at"',
  name: 'lower("name")',
  updatedAt: '"updated_at"',
}

export async function listCases(query: CaseQuery, pool: PgPool = db()): Promise<CasePage> {
  const column = SORT_COLUMNS[query.sort]
  const direction = query.direction === 'asc' ? 'ASC' : 'DESC'

  // count(*) OVER () rather than a second COUNT query: the filter is written
  // once, so the total can never describe a different set than the rows.
  const result = await pool.query<CaseRow>(
    `
      SELECT ${CASE_COLUMNS}, count(*) OVER () AS "total_count"
      FROM "catalog"."tool_case"
      WHERE ($1::text IS NULL OR (
              "name" ILIKE $1 OR "manufacturer" ILIKE $1 OR "system" ILIKE $1
              OR "ean" ILIKE $1 OR "sku" ILIKE $1 OR "notes" ILIKE $1))
        AND ($2::text IS NULL OR lower("manufacturer") = lower($2))
        AND ($3::text IS NULL OR lower("system") = lower($3))
      -- NULLS LAST so that sorting by capacity puts the cases nobody has
      -- measured at the end rather than at the top of the shelf.
      ORDER BY ${column} ${direction} NULLS LAST, "id" DESC
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
            WHERE "s"."case_id" = "catalog"."tool_case"."id"
          ),
          '[]'::jsonb
        ) AS "label_slots"
      FROM "catalog"."tool_case"
      WHERE "id" = $1
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

  const result = await pool.query<CaseRow>(
    `
      INSERT INTO "catalog"."tool_case" (${columns.join(', ')}, "created_by", "updated_by")
      VALUES (${placeholders.join(', ')}, $1, $1)
      RETURNING ${CASE_COLUMNS}
    `,
    params,
  )

  return toCase(result.rows[0])
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

  const result = await pool.query<CaseRow>(
    `
      UPDATE "catalog"."tool_case"
      SET ${assignments.join(', ')}, "updated_by" = $2, "updated_at" = now()
      WHERE "id" = $1
      RETURNING ${CASE_COLUMNS}
    `,
    params,
  )

  const row = result.rows[0]
  return row ? toCase(row) : null
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
    // numeric(8,2) comes back from pg as a string, because a float would round
    // 4.5 litres into something almost but not quite 4.5.
    capacityL: toNumber(row.capacity_l),
    createdAt: toIsoString(row.created_at),
    createdBy: row.created_by === null ? null : Number(row.created_by),
    diagonalMm: toNumber(row.diagonal_mm),
    ean: row.ean,
    id: Number(row.id),
    innerHeightMm: toNumber(row.inner_height_mm),
    innerLengthMm: toNumber(row.inner_length_mm),
    innerWidthMm: toNumber(row.inner_width_mm),
    labelSlots: (row.label_slots ?? []).map((slot) => ({
      heightMm: Number(slot.heightMm),
      id: Number(slot.id),
      widthMm: Number(slot.widthMm),
    })),
    loadKg: toNumber(row.load_kg),
    manufacturer: row.manufacturer,
    name: row.name,
    notes: row.notes,
    referenceUrl: row.reference_url,
    outerHeightMm: toNumber(row.outer_height_mm),
    outerLengthMm: toNumber(row.outer_length_mm),
    outerWidthMm: toNumber(row.outer_width_mm),
    sku: row.sku,
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
