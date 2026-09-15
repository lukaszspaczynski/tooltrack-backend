// Where a label goes on a case.
//
// Its own module rather than part of items-store because it is about one kind
// of card only: `catalog.case_label_slot` carries a `kind` fixed to 'case' and
// points at `(id, kind)`, so the database is what refuses a drill a place for
// a sticker — the same trick the organizer uses for tools.

import { db, type PgPool } from '../db'
import type { ErrorCode } from '../error-codes'
import { t } from '../i18n'

// A size and nothing else. What gets printed on it is a different question,
// answered by the label routes under an organizer.
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

// Every card asks for these and only a case ever has any: the join is on the
// item id, and a drill's answer is the empty list rather than a second query
// somebody has to remember to skip.
export async function labelSlotsOf(itemId: number, pool: PgPool = db()): Promise<LabelSlot[]> {
  const result = await pool.query<{ height_mm: number; id: string; width_mm: number }>(
    `
      SELECT "id", "width_mm", "height_mm"
      FROM "catalog"."case_label_slot"
      WHERE "item_id" = $1
      ORDER BY "width_mm" ASC, "height_mm" ASC, "id" ASC
    `,
    [itemId],
  )

  return result.rows.map((row) => ({
    heightMm: Number(row.height_mm),
    id: Number(row.id),
    widthMm: Number(row.width_mm),
  }))
}

export async function addLabelSlot(
  itemId: number,
  widthMm: number,
  heightMm: number,
  actorId: number,
  pool: PgPool = db(),
): Promise<LabelSlot> {
  try {
    const result = await pool.query<{ height_mm: number; id: string; width_mm: number }>(
      `
        INSERT INTO "catalog"."case_label_slot" ("item_id", "width_mm", "height_mm", "created_by")
        VALUES ($1, $2, $3, $4)
        RETURNING "id", "width_mm", "height_mm"
      `,
      [itemId, widthMm, heightMm, actorId],
    )

    const row = result.rows[0]
    return { heightMm: Number(row.height_mm), id: Number(row.id), widthMm: Number(row.width_mm) }
  } catch (error) {
    const code = (error as { code?: string }).code
    // The pair is the key: the same size twice on one case is a mistake, not a
    // second place.
    if (code === '23505') throw new LabelSlotTakenError(widthMm, heightMm)
    throw error
  }
}

export async function removeLabelSlot(
  itemId: number,
  slotId: number,
  pool: PgPool = db(),
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM "catalog"."case_label_slot" WHERE "item_id" = $1 AND "id" = $2`,
    [itemId, slotId],
  )

  return (result.rowCount ?? 0) > 0
}
