// Everything that touches `catalog.item`. The route module above it does no
// SQL, and every statement here is parameterised: the only user input that
// reaches the query text is a column name chosen from a fixed map.

import { db, withTransaction, type PgPool } from '../db'
import type { ErrorCode } from '../error-codes'
import { brandIdForName } from './brands-store'
import { t } from '../i18n'
import { listAttributes, type Attribute } from './attributes-store'
import type { OrganizerPlacement } from './organizers-store'
import {
  DEFAULT_CONDITION,
  DEFAULT_KIND,
  isItemCondition,
  isItemKind,
  type ItemCondition,
  type ItemFields,
  type ItemKind,
  type ItemPatch,
  type ItemQuery,
} from './items-input'

// The maker as the row it is, rather than as a string beside a pointer at it.
//
// A card used to carry both: `brand_id` for the count on the makers' screen and
// for a rename to reach, and `brand` as text for the search and for the screens
// to show. Keeping two spellings of one fact in step took three mechanisms —
// matching a typed name back to a row on every write, rewriting the string on
// every card when a brand was renamed, and a backfill in the DDL quietly
// repairing whatever those two missed.
//
// One pointer and a join. The screens get the name without a second request,
// which is what the string was really for, and the colour comes with it — a
// field the makers already had and no card ever showed.
export type ItemBrand = {
  color: string
  id: number
  name: string
}

export type Item = {
  brand: null | ItemBrand
  category: string
  // Which sort of thing this card is about. A screen shows one sort at a time;
  // the organizer refuses everything but a tool.
  kind: ItemKind
  condition: ItemCondition
  createdAt: string
  createdBy: null | number
  id: number
  model: string
  // Where this item is kept, or null when nobody has said. A column rather
  // than a link table: an item is in one place.
  addressId: null | number
  name: string
  notes: string
  // Where an import read this card from, empty when nobody imported it. It was
  // a parameter called Referencja until it became a field: every card has at
  // most one, which is a column rather than a row on a spec sheet.
  referenceUrl: string
  serialNumber: string
  updatedAt: string
  updatedBy: null | number
}

// An item with what is only worth reading one at a time. The list answers with
// `Item`: a grid of cards shows a name, a maker and a condition, and sending
// every card's spec sheet to draw that would be paying for what nobody reads.
export type ItemDetail = Item & {
  attributes: Attribute[]
}

export type ItemPage = {
  items: Item[]
  limit: number
  offset: number
  total: number
}

// What `GET /api/items` actually answers with, which is not `ItemPage`.
//
// The grid needs two things a card does not carry: the thumbnail to draw and
// where the item lies. Both are fetched for the whole page in one query each
// rather than per row, and the route hangs them on every item — so the list
// item is a wider thing than the card, and the type says so. It is named here
// rather than left as a literal in the handler because the OpenAPI schemas are
// generated from these types: a shape the API returns and no type describes is
// a shape the contract would get wrong.
export type ItemSummary = Item & {
  organizer: null | OrganizerPlacement
  primaryPhotoUrl: null | string
}

export type ItemListPage = Omit<ItemPage, 'items'> & {
  items: ItemSummary[]
}

export type CategoryCount = {
  category: string
  count: number
}

export class SerialNumberTakenError extends Error {
  readonly code: ErrorCode

  constructor(serialNumber: string) {
    super(`Serial number ${serialNumber} is already on another item`)
    this.name = 'SerialNumberTakenError'
    this.code = 'SERIAL_NUMBER_TAKEN'
  }
}

type ItemRow = {
  brand_color: null | string
  kind: string
  brand_id: null | number | string
  brand_name: null | string
  category: string
  condition: string
  created_at: Date | string
  created_by: null | number | string
  id: number | string
  model: string
  address_id: null | number | string
  name: string
  notes: string
  reference_url: string
  serial_number: string
  total_count?: number | string
  updated_at: Date | string
  updated_by: null | number | string
}

const ITEM_COLUMNS = `
  "i"."id", "i"."name", "i"."category", "i"."model", "i"."serial_number",
  "i"."condition", "i"."kind", "i"."notes", "i"."reference_url", "i"."address_id",
  "i"."created_by", "i"."updated_by", "i"."created_at", "i"."updated_at",
  "b"."id" AS "brand_id", "b"."name" AS "brand_name", "b"."color" AS "brand_color"
`

// LEFT, because a card without a maker is normal — most hand tools have none,
// and an INNER join would quietly drop them from the catalog.
const ITEM_FROM = `
  FROM "catalog"."item" AS "i"
  LEFT JOIN "catalog"."brand" AS "b" ON "b"."id" = "i"."brand_id"
`

// The only place a sort key becomes SQL. A value that is not in this map
// cannot reach the query, whatever arrives in the query string.
const SORT_COLUMNS: Record<ItemQuery['sort'], string> = {
  createdAt: '"i"."created_at"',
  name: 'lower("i"."name")',
  updatedAt: '"i"."updated_at"',
}

export async function listItems(query: ItemQuery, pool: PgPool = db()): Promise<ItemPage> {
  const column = SORT_COLUMNS[query.sort]
  const direction = query.direction === 'asc' ? 'ASC' : 'DESC'

  // count(*) OVER () rather than a second COUNT query: the filter is written
  // once, so the total can never describe a different set than the rows.
  const result = await pool.query<ItemRow>(
    `
      SELECT ${ITEM_COLUMNS}, count(*) OVER () AS "total_count"
      ${ITEM_FROM}
      WHERE ($1::text IS NULL OR (
              "i"."name" ILIKE $1 OR "b"."name" ILIKE $1 OR "i"."model" ILIKE $1
              OR "i"."serial_number" ILIKE $1 OR "i"."category" ILIKE $1
              OR "i"."notes" ILIKE $1))
        AND ($2::text IS NULL OR lower("i"."category") = lower($2))
        AND ($3::text IS NULL OR "i"."condition" = $3)
        -- Whether this item is in an organizer. The wizard asks for the ones
        -- that are not, because an item lies in exactly one place.
        AND ($6::boolean IS NULL OR EXISTS (
              SELECT 1 FROM "catalog"."organizer_item" WHERE "item_id" = "i"."id"
            ) = $6)
        -- What is at this place. addressId=none is the other half of the
        -- question and a different one: the items nobody has said a place for,
        -- which is what a tidy-up starts from.
        AND ($7::bigint IS NULL OR "i"."address_id" = $7)
        AND ($8::boolean IS NULL OR ("i"."address_id" IS NULL) = $8)
        -- A drill and a washing machine are the same card; a screen showing one
        -- sort at a time asks for it.
        AND ($9::text IS NULL OR "i"."kind" = $9)
      ORDER BY ${column} ${direction}, "i"."id" DESC
      LIMIT $4 OFFSET $5
    `,
    [
      query.search === null ? null : likePattern(query.search),
      query.category,
      query.condition,
      query.limit,
      query.offset,
      query.inOrganizer,
      typeof query.addressId === 'number' ? query.addressId : null,
      query.addressId === 'none' ? true : null,
      query.kind,
    ],
  )

  return {
    items: result.rows.map(toItem),
    limit: query.limit,
    offset: query.offset,
    // No rows means no matches, not an empty page of an unknown total.
    total: Number(result.rows[0]?.total_count ?? 0),
  }
}

export async function getItem(id: number, pool: PgPool = db()): Promise<null | Item> {
  const result = await pool.query<ItemRow>(
    `SELECT ${ITEM_COLUMNS} ${ITEM_FROM} WHERE "i"."id" = $1`,
    [id],
  )

  const row = result.rows[0]
  return row ? toItem(row) : null
}

// Oldest first, which is the order they were typed in — a spec sheet is copied
// from the top, and sorting by name would shuffle it into something nobody
// wrote. Two statements rather than a join: a join would repeat the whole item
// row once per parameter, and the two are assembled here anyway.
export async function getItemDetail(id: number, pool: PgPool = db()): Promise<null | ItemDetail> {
  const item = await getItem(id, pool)
  if (!item) return null

  return { ...item, attributes: await listAttributes('item', id, pool) }
}

export async function createItem(
  fields: ItemFields,
  actorId: number,
  pool: PgPool = db(),
): Promise<Item> {
  try {
    // RETURNING cannot reach the maker: it answers with the row that was
    // written and the name lives in another table. So the insert answers with
    // an id and the card is read back through the same join every other read
    // uses — one definition of what a card looks like, rather than two that
    // agree until somebody edits one.
    const result = await pool.query<{ id: string }>(
      `
        INSERT INTO "catalog"."item"
          ("name", "category", "model", "serial_number", "condition", "kind", "notes",
           "reference_url", "address_id", "created_by", "updated_by", "brand_id")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11)
        RETURNING "id"
      `,
      [
        fields.name,
        fields.category,
        fields.model,
        fields.serialNumber,
        fields.condition,
        fields.kind,
        fields.notes,
        fields.referenceUrl,
        fields.addressId,
        actorId,
        fields.brandId,
      ],
    )

    const created = await getItem(Number(result.rows[0].id), pool)
    if (!created) throw new Error('item written but cannot be read back')

    return created
  } catch (error) {
    throw translateWriteError(error, fields.serialNumber)
  }
}

export async function updateItem(
  id: number,
  patch: ItemPatch,
  actorId: number,
  pool: PgPool = db(),
): Promise<null | Item> {
  const columns: Record<keyof ItemPatch, string> = {
    addressId: 'address_id',
    brandId: 'brand_id',
    category: 'category',
    condition: 'condition',
    kind: 'kind',
    model: 'model',
    name: 'name',
    notes: 'notes',
    referenceUrl: 'reference_url',
    serialNumber: 'serial_number',
  }

  const assignments: string[] = []
  const params: unknown[] = [id, actorId]

  for (const [field, column] of Object.entries(columns) as [keyof ItemPatch, string][]) {
    const value = patch[field]
    if (value === undefined) continue
    params.push(value)
    assignments.push(`"${column}" = $${params.length}`)
  }

  // parseItemPatch already refuses an empty patch, so this only guards a
  // caller inside the server calling it directly.
  if (assignments.length === 0) return getItem(id, pool)

  try {
    const result = await pool.query<{ id: string }>(
      `
        UPDATE "catalog"."item"
        SET ${assignments.join(', ')}, "updated_by" = $2, "updated_at" = now()
        WHERE "id" = $1
        RETURNING "id"
      `,
      params,
    )

    return result.rows[0] ? getItem(id, pool) : null
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
export async function duplicateItem(
  id: number,
  actorId: number,
  pool: PgPool = db(),
): Promise<null | ItemDetail> {
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO "catalog"."item"
        ("name", "category", "brand_id", "model", "serial_number", "condition", "kind",
         "notes", "reference_url", "address_id", "created_by", "updated_by")
      SELECT "name", "category", "brand_id", "model", '', "condition", "kind",
             "notes", "reference_url", "address_id", $2, $2
      FROM "catalog"."item"
      WHERE "id" = $1
      RETURNING "id"
    `,
    [id, actorId],
  )

  const row = result.rows[0]
  if (!row) return null

  // The spec sheet goes with it. The parameters describe the model rather than
  // this particular machine — a second identical grinder is still 230 V — and
  // the reason to duplicate a card is to avoid typing all of that again. The
  // serial number is the one thing deliberately left behind.
  const copy = await getItem(Number(row.id), pool)
  if (!copy) throw new Error('copy written but cannot be read back')

  await pool.query(
    `
      INSERT INTO "catalog"."attribute" ("reference", "reference_id", "name", "value", "created_by")
      SELECT 'item', $2, "name", "value", $3
      FROM "catalog"."attribute"
      WHERE "reference" = 'item' AND "reference_id" = $1
      ORDER BY "id" ASC
    `,
    [id, copy.id, actorId],
  )

  return { ...copy, attributes: await listAttributes('item', copy.id, pool) }
}

export async function deleteItem(id: number, pool: PgPool = db()): Promise<boolean> {
  const result = await pool.query(`DELETE FROM "catalog"."item" WHERE "id" = $1`, [id])
  return (result.rowCount ?? 0) > 0
}

// What the category filter offers. Read from the items themselves rather than
// from a category table, because the items are where categories come from.
export async function listCategories(pool: PgPool = db()): Promise<CategoryCount[]> {
  const result = await pool.query<{ category: string; count: string }>(
    `
      SELECT "category", count(*)::text AS "count"
      FROM "catalog"."item"
      WHERE "category" <> ''
      GROUP BY "category"
      ORDER BY lower("category") ASC
    `,
  )

  return result.rows.map((row) => ({ category: row.category, count: Number(row.count) }))
}

export class InOrganizerError extends Error {
  readonly code: ErrorCode

  constructor() {
    super(t('Ta pozycja leży w organizerze. Najpierw ją wyjmij.'))
    this.name = 'InOrganizerError'
    this.code = 'ITEM_IN_ORGANIZER'
  }
}

export class BrandNotFoundError extends Error {
  readonly code: ErrorCode

  constructor() {
    super(t('Nie ma takiego producenta'))
    this.name = 'BrandNotFoundError'
    this.code = 'BRAND_NOT_FOUND'
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

function translateWriteError(error: unknown, serialNumber: string): unknown {
  const failure = error as { code?: string; constraint?: string }

  // A card points at a place and at a maker, so a foreign key that matched
  // nothing is a 404 about whichever one it was rather than an unexplained
  // 500. Which one is only knowable from the constraint name.
  if (failure.code === '23503') {
    if (failure.constraint === 'item_address_id_fkey') return new AddressNotFoundError()
    if (failure.constraint === 'item_brand_id_fkey') return new BrandNotFoundError()

    // The other direction of the organizer's rule, and the half a check in a
    // handler would have missed: this card is in a drawer, so it cannot stop
    // being a tool until somebody takes it out.
    if (failure.constraint === 'organizer_item_is_a_tool_fkey') return new InOrganizerError()
  }
  // 23505 on catalog_item_serial_number_idx: the same physical machine already
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

function toItem(row: ItemRow): Item {
  return {
    kind: isItemKind(row.kind) ? row.kind : DEFAULT_KIND,
    brand:
      row.brand_id === null
        ? null
        : {
            color: row.brand_color ?? '',
            id: Number(row.brand_id),
            name: row.brand_name ?? '',
          },
    category: row.category,
    condition: isItemCondition(row.condition) ? row.condition : DEFAULT_CONDITION,
    createdAt: toIsoString(row.created_at),
    createdBy: row.created_by === null ? null : Number(row.created_by),
    id: Number(row.id),
    model: row.model,
    name: row.name,
    addressId: row.address_id === null ? null : Number(row.address_id),
    notes: row.notes,
    referenceUrl: row.reference_url,
    serialNumber: row.serial_number,
    updatedAt: toIsoString(row.updated_at),
    updatedBy: row.updated_by === null ? null : Number(row.updated_by),
  }
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
