// Everything that touches `catalog.attribute`: the spec sheet of an item, and
// now of a case as well.
//
// It was `tool_attribute`, keyed by `item_id`, and every statement below lived
// in items-store.ts. A case turned out to want exactly the same thing — a list
// of names and values that nobody can agree a column list for — so the table
// says which kind of thing each row belongs to and the SQL is written once.
//
// The pair is `(reference, referenceId)` and it is not a foreign key: two
// tables cannot both be the target of one column. What keeps an orphan out is
// that the stores delete the rows when the thing goes, which is why
// `deleteAttributesOf` exists and why a delete path that forgets to call it is
// a bug rather than a database error.

import { db, withTransaction, type PgPool } from '../db'
import type { ErrorCode } from '../error-codes'
import { t } from '../i18n'

// Which kind of thing a row is about. The same two words the column checks.
// One kind of thing carries a spec sheet now: a card. It was two while a box
// was a table of its own, and the column stayed rather than being dropped —
// the day something that is not a card wants parameters, this is where it
// says so.
export const ATTRIBUTE_REFERENCES = ['item'] as const

export type AttributeReference = (typeof ATTRIBUTE_REFERENCES)[number]

// One parameter of one thing. The value carries its unit — "230 V" rather than
// 230 — because half of these have no unit anybody agrees on.
export type Attribute = {
  id: number
  name: string
  value: string
}

export type AttributeNameCount = {
  count: number
  name: string
}

export class AttributeNameTakenError extends Error {
  readonly code: ErrorCode

  constructor(name: string) {
    super(t('Ten parametr jest już na tej karcie: {name}', { name }))
    this.name = 'AttributeNameTakenError'
    this.code = 'ATTRIBUTE_NAME_TAKEN'
  }
}

type AttributeRow = {
  id: number | string
  name: string
  value: string
}

// Oldest first, which is the order they were typed in — a spec sheet is copied
// from the top, and sorting by name would shuffle it into something nobody
// wrote.
export async function listAttributes(
  reference: AttributeReference,
  referenceId: number,
  pool: PgPool = db(),
): Promise<Attribute[]> {
  const result = await pool.query<AttributeRow>(
    `
      SELECT "id", "name", "value"
      FROM "catalog"."attribute"
      WHERE "reference" = $1 AND "reference_id" = $2
      ORDER BY "id" ASC
    `,
    [reference, referenceId],
  )

  return result.rows.map(toAttribute)
}

export async function addAttribute(
  reference: AttributeReference,
  referenceId: number,
  attribute: { name: string; value: string },
  actorId: number,
  pool: PgPool = db(),
): Promise<Attribute> {
  try {
    const result = await pool.query<AttributeRow>(
      `
        INSERT INTO "catalog"."attribute" ("reference", "reference_id", "name", "value", "created_by")
        VALUES ($1, $2, $3, $4, $5)
        RETURNING "id", "name", "value"
      `,
      [reference, referenceId, attribute.name, attribute.value, actorId],
    )

    return toAttribute(result.rows[0])
  } catch (error) {
    throw translateAttributeError(error, attribute.name)
  }
}

// Null when the parameter is not this thing's, which is a 404 rather than a
// silent no-op: the id in the path came from somewhere, and answering "done"
// to a row that was never touched is how a screen shows a value nobody saved.
export async function updateAttribute(
  reference: AttributeReference,
  referenceId: number,
  attributeId: number,
  patch: { name?: string; value?: string },
  pool: PgPool = db(),
): Promise<null | Attribute> {
  const assignments: string[] = []
  const params: unknown[] = [reference, referenceId, attributeId]

  for (const field of ['name', 'value'] as const) {
    const value = patch[field]
    if (value === undefined) continue
    params.push(value)
    assignments.push(`"${field}" = $${params.length}`)
  }

  if (assignments.length === 0) {
    return findAttribute(reference, referenceId, attributeId, pool)
  }

  try {
    const result = await pool.query<AttributeRow>(
      `
        UPDATE "catalog"."attribute"
        SET ${assignments.join(', ')}, "updated_at" = now()
        WHERE "reference" = $1 AND "reference_id" = $2 AND "id" = $3
        RETURNING "id", "name", "value"
      `,
      params,
    )

    const row = result.rows[0]
    return row ? toAttribute(row) : null
  } catch (error) {
    throw translateAttributeError(error, patch.name ?? '')
  }
}

export async function deleteAttribute(
  reference: AttributeReference,
  referenceId: number,
  attributeId: number,
  pool: PgPool = db(),
): Promise<boolean> {
  const result = await pool.query(
    `
      DELETE FROM "catalog"."attribute"
      WHERE "reference" = $1 AND "reference_id" = $2 AND "id" = $3
    `,
    [reference, referenceId, attributeId],
  )

  return (result.rowCount ?? 0) > 0
}

// Every row of one thing, for a delete path. There is no cascade to do this:
// the pair is not a foreign key, because one column cannot point at two tables.
export async function deleteAttributesOf(
  reference: AttributeReference,
  referenceId: number,
  pool: PgPool = db(),
): Promise<void> {
  await pool.query(
    `DELETE FROM "catalog"."attribute" WHERE "reference" = $1 AND "reference_id" = $2`,
    [reference, referenceId],
  )
}

// What the form offers while somebody types a parameter name, most used first.
//
// Asked per kind. A case and a drill have nothing in common on a spec sheet,
// and suggesting "pojemność zbiornika" to somebody labelling a box would be
// noise where the point of the list is a vocabulary people converge on.
export async function listAttributeNames(
  reference: AttributeReference,
  pool: PgPool = db(),
): Promise<AttributeNameCount[]> {
  const result = await pool.query<{ count: string; name: string }>(
    `
      SELECT min("name") AS "name", count(*)::text AS "count"
      FROM "catalog"."attribute"
      WHERE "reference" = $1
      GROUP BY lower(btrim("name"))
      ORDER BY count(*) DESC, lower(min("name")) ASC
    `,
    [reference],
  )

  return result.rows.map((row) => ({ count: Number(row.count), name: row.name }))
}

// The whole spec sheet at once: what an update from a product page writes.
//
// Cleared and written again rather than merged, because a page is the source of
// truth for what a thing is: a parameter the maker has dropped should leave the
// card too, and matching old rows against new ones by name would keep exactly
// the ones that are wrong. One transaction, so nothing is left with half a
// spec sheet.
export async function replaceAttributes(
  reference: AttributeReference,
  referenceId: number,
  attributes: { name: string; value: string }[],
  actorId: number,
  pool: PgPool = db(),
): Promise<Attribute[]> {
  return withTransaction(pool, async (client) => {
    await client.query(
      `DELETE FROM "catalog"."attribute" WHERE "reference" = $1 AND "reference_id" = $2`,
      [reference, referenceId],
    )

    for (const attribute of attributes) {
      await client.query(
        `
          INSERT INTO "catalog"."attribute"
            ("reference", "reference_id", "name", "value", "created_by")
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT DO NOTHING
        `,
        [reference, referenceId, attribute.name, attribute.value, actorId],
      )
    }

    const result = await client.query<AttributeRow>(
      `
        SELECT "id", "name", "value"
        FROM "catalog"."attribute"
        WHERE "reference" = $1 AND "reference_id" = $2
        ORDER BY "id" ASC
      `,
      [reference, referenceId],
    )

    return result.rows.map(toAttribute)
  })
}

async function findAttribute(
  reference: AttributeReference,
  referenceId: number,
  attributeId: number,
  pool: PgPool,
): Promise<null | Attribute> {
  const result = await pool.query<AttributeRow>(
    `
      SELECT "id", "name", "value"
      FROM "catalog"."attribute"
      WHERE "reference" = $1 AND "reference_id" = $2 AND "id" = $3
    `,
    [reference, referenceId, attributeId],
  )

  const row = result.rows[0]
  return row ? toAttribute(row) : null
}

// 23505 on catalog_attribute_name_idx: this thing already lists that parameter.
// A 409 the screen can act on — it knows which row to point at — rather than a
// 500.
function translateAttributeError(error: unknown, name: string): unknown {
  if ((error as { code?: string }).code === '23505') {
    return new AttributeNameTakenError(name)
  }

  return error
}

function toAttribute(row: AttributeRow): Attribute {
  return { id: Number(row.id), name: row.name, value: row.value }
}
