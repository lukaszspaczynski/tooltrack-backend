// Everything that touches `catalog.address`: the places tools and arrangements
// are kept.
//
// Every row carries how many tools and how many arrangements point at it. Not
// a convenience — it is what makes the list readable ("most of the kit is in
// the workshop") and what a delete confirmation has to say before anybody
// agrees to it, since removing a place quietly empties the field on everything
// that was there.

import { db, type PgPool } from '../db'
import type { ErrorCode } from '../error-codes'
import { t } from '../i18n'
import type { AddressFields, AddressPatch, AddressQuery } from './addresses-input'

export type Address = {
  building: string
  city: string
  // '#rrggbb', or '' when nobody has picked one. What the screens draw a dot
  // with, so a place is recognised without reading its name.
  color: string
  createdAt: string
  createdBy: null | number
  id: number
  name: string
  notes: string
  // How many tools and arrangements say they are here. Read on the list as
  // well as on one address, because "which of these is empty" is the question
  // that decides what can be tidied away.
  organizerCount: number
  postalCode: string
  street: string
  toolCount: number
  unit: string
  updatedAt: string
  updatedBy: null | number
}

export type AddressPage = {
  items: Address[]
  limit: number
  offset: number
  total: number
}

export class AddressNameTakenError extends Error {
  readonly code: ErrorCode

  constructor(name: string) {
    super(t('Adres o tej nazwie już istnieje: {name}', { name }))
    this.name = 'AddressNameTakenError'
    this.code = 'ADDRESS_NAME_TAKEN'
  }
}

type AddressRow = {
  building: string
  city: string
  color: string
  created_at: Date | string
  created_by: null | number | string
  id: number | string
  name: string
  notes: string
  organizer_count: number | string
  postal_code: string
  street: string
  tool_count: number | string
  total_count?: number | string
  unit: string
  updated_at: Date | string
  updated_by: null | number | string
}

// Every field that can be written, and the column it lands in. Create and patch
// both read this, so a property cannot reach one and be forgotten by the other.
const WRITABLE_COLUMNS: Record<keyof AddressFields, string> = {
  building: 'building',
  city: 'city',
  color: 'color',
  name: 'name',
  notes: 'notes',
  postalCode: 'postal_code',
  street: 'street',
  unit: 'unit',
}

const ADDRESS_COLUMNS = `
  "a"."id", "a"."name", "a"."street", "a"."building", "a"."unit",
  "a"."postal_code", "a"."city", "a"."notes", "a"."color",
  "a"."created_by", "a"."updated_by", "a"."created_at", "a"."updated_at"
`

// The counts as subqueries rather than as joins. Two joins against one row
// multiply each other — three tools and two arrangements would read as six of
// each — and the fix for that is either DISTINCT on every column or this.
const COUNTS = `
  (SELECT count(*) FROM "catalog"."tool" AS "t" WHERE "t"."address_id" = "a"."id")
    AS "tool_count",
  (SELECT count(*) FROM "catalog"."organizer" AS "o" WHERE "o"."address_id" = "a"."id")
    AS "organizer_count"
`

// The only place a sort key becomes SQL.
const SORT_COLUMNS: Record<AddressQuery['sort'], string> = {
  city: 'lower("a"."city")',
  name: 'lower("a"."name")',
  tools: '"tool_count"',
}

export async function listAddresses(
  query: AddressQuery,
  pool: PgPool = db(),
): Promise<AddressPage> {
  const order = SORT_COLUMNS[query.sort] ?? SORT_COLUMNS.name
  const direction = query.direction === 'desc' ? 'DESC' : 'ASC'

  const result = await pool.query<AddressRow>(
    `
      SELECT ${ADDRESS_COLUMNS}, ${COUNTS}, count(*) OVER () AS "total_count"
      FROM "catalog"."address" AS "a"
      WHERE ($1::text IS NULL
             OR "a"."name" ILIKE $1 OR "a"."city" ILIKE $1 OR "a"."street" ILIKE $1
             OR "a"."postal_code" ILIKE $1 OR "a"."notes" ILIKE $1)
      ORDER BY ${order} ${direction} NULLS LAST, "a"."id" ASC
      LIMIT $2 OFFSET $3
    `,
    [query.search === null ? null : likePattern(query.search), query.limit, query.offset],
  )

  return {
    items: result.rows.map(toAddress),
    limit: query.limit,
    offset: query.offset,
    total: Number(result.rows[0]?.total_count ?? 0),
  }
}

export async function getAddress(id: number, pool: PgPool = db()): Promise<null | Address> {
  const result = await pool.query<AddressRow>(
    `
      SELECT ${ADDRESS_COLUMNS}, ${COUNTS}
      FROM "catalog"."address" AS "a"
      WHERE "a"."id" = $1
    `,
    [id],
  )

  const row = result.rows[0]
  return row ? toAddress(row) : null
}

export async function createAddress(
  fields: AddressFields,
  actorId: number,
  pool: PgPool = db(),
): Promise<Address> {
  const entries = Object.entries(WRITABLE_COLUMNS) as [keyof AddressFields, string][]
  const columns = entries.map(([, column]) => `"${column}"`)
  const placeholders = entries.map((_, index) => `$${index + 2}`)

  try {
    // RETURNING rather than a data-modifying CTE read back by a SELECT in the
    // same statement. That looks like it should work and does not: the SELECT
    // runs against the snapshot from before the statement, so the row the CTE
    // has just written is not in it and the query answers nothing.
    //
    // The counts are literals because they cannot be anything else. A place
    // created a moment ago has nothing pointing at it yet.
    const result = await pool.query<AddressRow>(
      `
        INSERT INTO "catalog"."address" (${columns.join(', ')}, "created_by", "updated_by")
        VALUES (${placeholders.join(', ')}, $1, $1)
        RETURNING ${ADDRESS_COLUMNS.replaceAll('"a".', '')},
                  0 AS "tool_count", 0 AS "organizer_count"
      `,
      [actorId, ...entries.map(([field]) => fields[field])],
    )

    return toAddress(result.rows[0])
  } catch (error) {
    throw translateWriteError(error, fields.name)
  }
}

export async function updateAddress(
  id: number,
  patch: AddressPatch,
  actorId: number,
  pool: PgPool = db(),
): Promise<null | Address> {
  const assignments: string[] = []
  const params: unknown[] = [id, actorId]

  for (const [field, column] of Object.entries(WRITABLE_COLUMNS) as [
    keyof AddressFields,
    string,
  ][]) {
    const value = patch[field]
    if (value === undefined) continue
    params.push(value)
    assignments.push(`"${column}" = $${params.length}`)
  }

  if (assignments.length === 0) return getAddress(id, pool)

  try {
    const result = await pool.query<{ id: string }>(
      `
        UPDATE "catalog"."address"
        SET ${assignments.join(', ')}, "updated_by" = $2, "updated_at" = now()
        WHERE "id" = $1
        RETURNING "id"
      `,
      params,
    )

    // Read back rather than RETURNING the row: the counts are subqueries and
    // an UPDATE cannot produce them without repeating both here.
    return result.rows[0] ? getAddress(id, pool) : null
  } catch (error) {
    throw translateWriteError(error, patch.name ?? '')
  }
}

// The tools and arrangements stay; their `address_id` is set to null by the
// foreign key. That is the whole reason this is allowed to be a plain delete:
// closing a site is a normal thing to do, and it must not take the kit that
// was on it out of the catalog.
export async function deleteAddress(id: number, pool: PgPool = db()): Promise<boolean> {
  const result = await pool.query(`DELETE FROM "catalog"."address" WHERE "id" = $1`, [id])

  return (result.rowCount ?? 0) > 0
}

// Whether an id names a place, for the two routes that point at one. Cheaper
// than reading the address, which would carry two counted subqueries with it.
export async function addressExists(id: number, pool: PgPool = db()): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM "catalog"."address" WHERE "id" = $1`, [id])

  return (result.rowCount ?? 0) > 0
}

// 23505 on catalog_address_name_idx: a place by that name is already on the
// list. A 409 the screen can point at a field with, rather than a 500.
function translateWriteError(error: unknown, name: string): unknown {
  if ((error as { code?: string }).code === '23505') return new AddressNameTakenError(name)

  return error
}

// `%` and `_` are wildcards in ILIKE, and a search for "12_A" means the
// underscore. The backslash is escaped first, or escaping the other two would
// then be undone by the pattern's own backslashes.
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (match) => `\\${match}`)}%`
}

function toAddress(row: AddressRow): Address {
  return {
    building: row.building,
    city: row.city,
    color: row.color,
    createdAt: toIsoString(row.created_at),
    createdBy: row.created_by === null ? null : Number(row.created_by),
    id: Number(row.id),
    name: row.name,
    notes: row.notes,
    organizerCount: Number(row.organizer_count),
    postalCode: row.postal_code,
    street: row.street,
    toolCount: Number(row.tool_count),
    unit: row.unit,
    updatedAt: toIsoString(row.updated_at),
    updatedBy: row.updated_by === null ? null : Number(row.updated_by),
  }
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
