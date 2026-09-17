// Everything that touches `catalog.brand` and `catalog.photo_brand`.
//
// The list carries the logo and how many items point at the brand, both as
// aggregates in the one statement: a screen of makers would otherwise ask per
// row, twice.

import { db, type PgPool } from '../db'
import type { ErrorCode } from '../error-codes'
import type { BrandFields, BrandPatch, BrandQuery } from './brands-input'
import { photoUrl } from './photos-store'
import { t } from '../i18n'

export type Brand = {
  // '#rrggbb', or '' when nobody has said.
  color: string
  createdAt: string
  createdBy: null | number
  id: number
  logoPhotoId: null | number
  logoUrl: null | string
  name: string
  notes: string
  // How many items name this maker. Read-only, and the reason the list is
  // worth looking at.
  itemCount: number
  updatedAt: string
  updatedBy: null | number
}

export type BrandPage = {
  items: Brand[]
  limit: number
  offset: number
  total: number
}

export class BrandNameTakenError extends Error {
  readonly code: ErrorCode

  constructor(name: string) {
    super(t('Marka „{name}” już istnieje', { name }))
    this.name = 'BrandNameTakenError'
    this.code = 'BRAND_NAME_TAKEN'
  }
}

export class PhotoNotFoundError extends Error {
  readonly code: ErrorCode

  constructor() {
    super(t('Nie ma takiego zdjęcia'))
    this.name = 'PhotoNotFoundError'
    this.code = 'PHOTO_NOT_FOUND'
  }
}

export class LogoTakenError extends Error {
  readonly code: ErrorCode

  constructor() {
    super(t('To zdjęcie jest już logo innej marki'))
    this.name = 'LogoTakenError'
    this.code = 'LOGO_TAKEN'
  }
}

type BrandRow = {
  color: string
  created_at: Date | string
  created_by: null | number | string
  id: number | string
  logo_photo_id: null | number | string
  name: string
  notes: string
  item_count: number | string
  total_count?: number | string
  updated_at: Date | string
  updated_by: null | number | string
}

const BRAND_COLUMNS = `
  "b"."id", "b"."name", "b"."notes", "b"."color", "b"."created_by", "b"."updated_by",
  "b"."created_at", "b"."updated_at",
  (SELECT "photo_id" FROM "catalog"."photo_brand" WHERE "brand_id" = "b"."id") AS "logo_photo_id",
  (SELECT count(*) FROM "catalog"."item" WHERE "brand_id" = "b"."id") AS "item_count"
`

const SORT_COLUMNS: Record<BrandQuery['sort'], string> = {
  name: 'lower("b"."name")',
  items: '"item_count"',
}

export async function listBrands(query: BrandQuery, pool: PgPool = db()): Promise<BrandPage> {
  const column = SORT_COLUMNS[query.sort]
  const direction = query.direction === 'desc' ? 'DESC' : 'ASC'

  const result = await pool.query<BrandRow>(
    `
      SELECT ${BRAND_COLUMNS}, count(*) OVER () AS "total_count"
      FROM "catalog"."brand" AS "b"
      WHERE ($1::text IS NULL OR "b"."name" ILIKE $1 OR "b"."notes" ILIKE $1)
      ORDER BY ${column} ${direction}, "b"."id" ASC
      LIMIT $2 OFFSET $3
    `,
    [
      query.search === null ? null : `%${query.search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`,
      query.limit,
      query.offset,
    ],
  )

  return {
    items: result.rows.map(toBrand),
    limit: query.limit,
    offset: query.offset,
    total: Number(result.rows[0]?.total_count ?? 0),
  }
}

export async function getBrand(id: number, pool: PgPool = db()): Promise<null | Brand> {
  const result = await pool.query<BrandRow>(
    `SELECT ${BRAND_COLUMNS} FROM "catalog"."brand" AS "b" WHERE "b"."id" = $1`,
    [id],
  )

  const row = result.rows[0]
  return row ? toBrand(row) : null
}

export async function createBrand(
  fields: BrandFields,
  actorId: number,
  pool: PgPool = db(),
): Promise<Brand> {
  try {
    const result = await pool.query<{ id: string }>(
      `
        INSERT INTO "catalog"."brand" ("name", "notes", "created_by", "updated_by")
        VALUES ($1, $2, $3, $3)
        RETURNING "id"
      `,
      [fields.name, fields.notes, actorId],
    )

    const created = await getBrand(Number(result.rows[0].id), pool)
    if (!created) throw new Error('brand written but cannot be read back')

    return created
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new BrandNameTakenError(fields.name)
    throw error
  }
}

export async function updateBrand(
  id: number,
  patch: BrandPatch,
  actorId: number,
  pool: PgPool = db(),
): Promise<null | Brand> {
  const assignments: string[] = []
  const params: unknown[] = [id, actorId]

  for (const [field, column] of [
    ['color', 'color'],
    ['name', 'name'],
    ['notes', 'notes'],
  ] as const) {
    const value = patch[field]
    if (value === undefined) continue
    params.push(value)
    assignments.push(`"${column}" = $${params.length}`)
  }

  if (assignments.length === 0) return getBrand(id, pool)

  try {
    const result = await pool.query(
      `
        UPDATE "catalog"."brand"
        SET ${assignments.join(', ')}, "updated_by" = $2, "updated_at" = now()
        WHERE "id" = $1
      `,
      params,
    )
    if ((result.rowCount ?? 0) === 0) return null

    // Nothing else to write. A rename used to rewrite the maker's name on
    // every item that pointed here, because a card carried it as text beside
    // the pointer and the two had to be kept in step; the text is gone, which
    // is what collapsing the maker to `brand_id` was for. It was also a
    // transaction for that reason, and with one statement left it is one
    // statement.
    return getBrand(id, pool)
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new BrandNameTakenError(patch.name ?? '')
    }
    throw error
  }
}

// The items stay, and keep the maker's name as text: deleting the row that
// grouped them is not a statement about who made them.
export async function deleteBrand(id: number, pool: PgPool = db()): Promise<boolean> {
  const result = await pool.query(`DELETE FROM "catalog"."brand" WHERE "id" = $1`, [id])
  return (result.rowCount ?? 0) > 0
}

export async function setLogo(
  brandId: number,
  photoId: number,
  actorId: number,
  pool: PgPool = db(),
): Promise<null | Brand> {
  const exists = await pool.query(`SELECT 1 FROM "catalog"."brand" WHERE "id" = $1`, [brandId])
  if ((exists.rowCount ?? 0) === 0) return null

  try {
    await pool.query(
      `
        INSERT INTO "catalog"."photo_brand" ("brand_id", "photo_id", "created_by")
        VALUES ($1, $2, $3)
        ON CONFLICT ("brand_id") DO UPDATE SET "photo_id" = EXCLUDED."photo_id"
      `,
      [brandId, photoId, actorId],
    )
  } catch (error) {
    const code = (error as { code?: string }).code
    // 23503: no such picture. 23505: it is already another brand's logo, which
    // the one-to-one rule refuses rather than moving.
    if (code === '23503') throw new PhotoNotFoundError()
    if (code === '23505') throw new LogoTakenError()
    throw error
  }

  return getBrand(brandId, pool)
}

export async function clearLogo(brandId: number, pool: PgPool = db()): Promise<null | Brand> {
  const result = await pool.query(`DELETE FROM "catalog"."photo_brand" WHERE "brand_id" = $1`, [
    brandId,
  ])
  if ((result.rowCount ?? 0) === 0) return getBrand(brandId, pool)

  return getBrand(brandId, pool)
}

// Which brand a typed name belongs to, if any. The item form still writes the
// maker as text; this is what keeps the column and the row pointing at the
// same company without inventing a brand from a typo.
// The maker a page named, as a row — creating it when the catalog has never
// seen it before.
//
// An import reads "Festool" off a product page. Matching it and pointing at
// nothing when it is unknown was safe while a card also carried the name as
// text; with the text gone, that would mean reading a maker and then losing it.
// So an import may add to the list of makers, which is what an import is for.
//
// Only imports use this. A person editing a card picks from the list, because
// a typo there would otherwise become a maker.
export async function brandIdForImportedName(
  name: string,
  actorId: number,
  pool: PgPool = db(),
): Promise<null | number> {
  const trimmed = name.trim()
  if (!trimmed) return null

  const existing = await brandIdForName(trimmed, pool)
  if (existing !== null) return existing

  // ON CONFLICT rather than a second look: two imports of the same maker can
  // run at once, and the unique index is what decides.
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO "catalog"."brand" ("name", "created_by")
      VALUES ($1, $2)
      ON CONFLICT (lower("name")) DO UPDATE SET "name" = "catalog"."brand"."name"
      RETURNING "id"
    `,
    [trimmed, actorId],
  )

  return result.rows[0] ? Number(result.rows[0].id) : brandIdForName(trimmed, pool)
}

export async function brandIdForName(name: string, pool: PgPool = db()): Promise<null | number> {
  const trimmed = name.trim()
  if (!trimmed) return null

  const result = await pool.query<{ id: string }>(
    `SELECT "id" FROM "catalog"."brand" WHERE lower("name") = lower($1)`,
    [trimmed],
  )

  return result.rows[0] ? Number(result.rows[0].id) : null
}

function toBrand(row: BrandRow): Brand {
  return {
    color: row.color,
    createdAt: toIsoString(row.created_at),
    createdBy: row.created_by === null ? null : Number(row.created_by),
    id: Number(row.id),
    logoPhotoId: row.logo_photo_id === null ? null : Number(row.logo_photo_id),
    logoUrl: row.logo_photo_id === null ? null : photoUrl(Number(row.logo_photo_id)),
    name: row.name,
    notes: row.notes,
    itemCount: Number(row.item_count),
    updatedAt: toIsoString(row.updated_at),
    updatedBy: row.updated_by === null ? null : Number(row.updated_by),
  }
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
