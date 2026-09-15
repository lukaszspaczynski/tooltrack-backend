// Every label in the model, seen from outside the organizer that made it.
//
// `organizers-store.ts` answers "what has this arrangement produced"; this one
// answers "what have we printed", which is the question somebody asks after a
// box changed and a shelf of stickers went stale. Same split as the photo
// library next to the per-card gallery.

import { db, type PgPool } from '../db'
import type { LabelListQuery } from './labels-input'

export type LabelListItem = {
  byteSize: number
  // The box the label is stuck on. A sticker is found by the box far more
  // often than by the arrangement, so the tile says both.
  case: { id: number; manufacturer: string; name: string }
  createdAt: string
  createdBy: null | number
  heightMm: number
  id: number
  options: Record<string, unknown>
  organizer: { id: number; name: string; number: number }
  previewUrl: null | string
  template: string
  url: string
  widthMm: number
}

export type LabelPage = {
  items: LabelListItem[]
  limit: number
  offset: number
  total: number
}

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

type LabelRow = {
  byte_size: number | string
  case_id: number | string
  case_manufacturer: null | string
  case_name: string
  created_at: Date | string
  created_by: null | number | string
  height_mm: number | string
  id: number | string
  options: null | Record<string, unknown>
  organizer_id: number | string
  organizer_name: string
  organizer_number: number | string
  pdf_path: string
  preview_path: string
  template: string
  total_count?: number | string
  width_mm: number | string
}

const LABEL_COLUMNS = `
    "l"."id", "l"."template", "l"."width_mm", "l"."height_mm", "l"."options",
    "l"."byte_size", "l"."pdf_path", "l"."preview_path",
    "l"."created_by", "l"."created_at",
    "o"."id" AS "organizer_id", "o"."name" AS "organizer_name",
    "o"."number" AS "organizer_number",
    "c"."id" AS "case_id", "c"."name" AS "case_name",
    (SELECT "name" FROM "catalog"."brand" WHERE "id" = "c"."brand_id") AS "case_manufacturer"
`

// Split from the columns for the same reason the organizer list splits them:
// the window count has to sit between the two, and appending it after the FROM
// is how that endpoint once answered 500 for every request.
const LABEL_FROM = `
  FROM "catalog"."organizer_label" AS "l"
  JOIN "catalog"."organizer" AS "o" ON "o"."id" = "l"."organizer_id"
  JOIN "catalog"."item" AS "c" ON "c"."id" = "o"."case_id"
`

export async function listAllLabels(
  query: LabelListQuery,
  pool: PgPool = db(),
): Promise<LabelPage> {
  const direction = query.direction === 'asc' ? 'ASC' : 'DESC'

  const result = await pool.query<LabelRow>(
    `
      SELECT ${LABEL_COLUMNS}, count(*) OVER () AS "total_count"
      ${LABEL_FROM}
      WHERE ($1::text IS NULL OR "o"."name" ILIKE $1 OR "o"."description" ILIKE $1
             OR "c"."name" ILIKE $1)
        AND ($2::text IS NULL OR "l"."template" = $2)
        AND ($3::bigint IS NULL OR "l"."organizer_id" = $3)
      ORDER BY "l"."created_at" ${direction}, "l"."id" ${direction}
      LIMIT $4 OFFSET $5
    `,
    [
      query.search === null ? null : `%${query.search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`,
      query.template,
      query.organizerId,
      query.limit,
      query.offset,
    ],
  )

  return {
    items: result.rows.map(toLabelListItem),
    limit: query.limit,
    offset: query.offset,
    total: Number(result.rows[0]?.total_count ?? 0),
  }
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

// Everything a sheet needs to draw the labels asked for: the same rows a
// redraw reads, plus the template, because a sheet draws the artwork again
// rather than embedding the print-ready file the label points at.
//
// Ordered by the organizer and its own size, which is the order they end up in
// on the paper when nothing else decides — labels of one box together.
export async function labelsToDraw(
  labelIds: number[],
  pool: PgPool = db(),
): Promise<(LabelToRedraw & { template: string })[]> {
  const result = await pool.query<{
    height_mm: number | string
    id: string
    options: null | Record<string, unknown>
    organizer_id: string
    template: string
    width_mm: number | string
  }>(
    `
      SELECT "l"."id", "l"."organizer_id", "l"."template",
             "l"."width_mm", "l"."height_mm", "l"."options"
      FROM "catalog"."organizer_label" AS "l"
      JOIN "catalog"."organizer" AS "o" ON "o"."id" = "l"."organizer_id"
      WHERE "l"."id" = ANY($1::bigint[])
      ORDER BY "o"."number", "l"."width_mm" DESC, "l"."height_mm" DESC, "l"."id"
    `,
    [labelIds],
  )

  return result.rows.map((row) => ({
    heightMm: Number(row.height_mm),
    id: Number(row.id),
    options: row.options ?? {},
    organizerId: Number(row.organizer_id),
    template: row.template,
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

function toLabelListItem(row: LabelRow): LabelListItem {
  const organizerId = Number(row.organizer_id)
  const id = Number(row.id)

  return {
    byteSize: Number(row.byte_size),
    case: {
      id: Number(row.case_id),
      manufacturer: row.case_manufacturer ?? '',
      name: row.case_name,
    },
    createdAt: toIsoString(row.created_at),
    createdBy: row.created_by === null ? null : Number(row.created_by),
    heightMm: Number(row.height_mm),
    id,
    options: row.options ?? {},
    organizer: {
      id: organizerId,
      name: row.organizer_name,
      number: Number(row.organizer_number),
    },
    previewUrl: labelPreviewUrl(organizerId, id, row.preview_path),
    template: row.template,
    url: labelFileUrl(organizerId, id, row.pdf_path),
    widthMm: Number(row.width_mm),
  }
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
