// The label SQL that is not about one organizer.
//
// `organizers-store.ts` reads the labels of an arrangement as part of it. These
// two questions are asked from outside that: which rows to draw again, and
// where a label's files are served from. Both are shared, and a second copy of
// either is a second answer waiting to disagree.

import { db, type PgPool } from '../db'

// What a redraw needs, for the labels asked for and no others. The organizer
// comes back on every row because the generator draws from one — a selection
// made on the cross-organizer screen spans several.
export type LabelToRedraw = {
  heightMm: number
  id: number
  options: Record<string, unknown>
  organizerId: number
  widthMm: number
}

// The rows to draw again. `organizerId` narrows it to one arrangement, for the
// route that lives under one; null takes them wherever they are, which is what
// the cross-organizer screen selects.
//
// The size comes off the row rather than the slot on purpose: the slot can
// have been taken off the case since, and a label that exists is 30 x 40 mm
// whatever happened to the list of places it could go.
export async function labelsToRedraw(
  labelIds: number[],
  organizerId: null | number,
  pool: PgPool = db(),
): Promise<LabelToRedraw[]> {
  const result = await pool.query<{
    height_mm: number | string
    id: string
    options: null | Record<string, unknown>
    organizer_id: string
    width_mm: number | string
  }>(
    `
      SELECT "id", "organizer_id", "width_mm", "height_mm", "options"
      FROM "catalog"."organizer_label"
      WHERE "id" = ANY($1::bigint[])
        AND ($2::bigint IS NULL OR "organizer_id" = $2)
      ORDER BY "organizer_id", "id"
    `,
    [labelIds, organizerId],
  )

  return result.rows.map((row) => ({
    heightMm: Number(row.height_mm),
    id: Number(row.id),
    options: row.options ?? {},
    organizerId: Number(row.organizer_id),
    widthMm: Number(row.width_mm),
  }))
}

// Both files a label is served from. Kept here rather than in each mapper so
// the two screens cannot disagree about the address of the same PDF.
export function labelFileUrl(organizerId: number, labelId: number, pdfPath: string): string {
  return `/api/organizers/${organizerId}/labels/${labelId}/file${fileVersion(pdfPath)}`
}

export function labelPreviewUrl(
  organizerId: number,
  labelId: number,
  previewPath: string,
): null | string {
  if (!previewPath) return null

  return `/api/organizers/${organizerId}/labels/${labelId}/preview${fileVersion(previewPath)}`
}

// A label keeps its id when it is drawn again, so the URL of its file does not
// change on its own — and both files are served immutable. The checksum the
// file is named after goes on the end as a version, which is what makes a
// redrawn label reach the browser instead of the copy it cached for a year.
function fileVersion(path: string): string {
  const checksum = path.split('/').pop()?.split('.')[0] ?? ''
  return checksum ? `?v=${checksum.slice(0, 12)}` : ''
}
