// From an organizer and a handful of options to PDF bytes.
//
// This is the only module that knows both halves: what the catalog holds and
// what a template needs. The templates themselves take plain data and draw —
// no database, no files — which is what makes their geometry testable.

import { db, type PgPool } from '../db'
import { readPhotoBytes } from '../photo-storage'
import { drawContentsLabel, maxContentsPhotos } from './contents-label'
import { drawNumberLabel, type NumberLabelBrand } from './number-label'
import { addPrintMarks } from './print-ready'

export const LABEL_TEMPLATES = ['number', 'contents'] as const

export type LabelTemplate = (typeof LABEL_TEMPLATES)[number]

export type NumberOptions = {
  // A print-ready file has a margin, crop marks and a measured bar; a plain one
  // is the artwork alone.
  printReady: boolean
  template: 'number'
  withLogos: boolean
}

export type ContentsOptions = {
  // Where the line under the rule comes from. Absent on labels made before
  // there was a choice, which is what `captionSource` is for.
  namesSource?: CaptionSource
  // Empty means the label works it out. Anything else is what somebody typed
  // instead — "18 V + 12 V, LI-ION" says more about a box of batteries than
  // five product names would, and only a person knows that.
  namesText: string
  photoIds: number[]
  printReady: boolean
  template: 'contents'
  titleText: string
  withNames: boolean
  withTitle: boolean
}

export const CAPTION_SOURCES = ['models', 'text', 'tools'] as const

export type CaptionSource = (typeof CAPTION_SOURCES)[number]

// What the caption is made of. A label drawn before the choice existed says
// nothing about it, and back then a text meant a typed line while its absence
// meant the tool names — which is what those labels still mean when one of
// them is drawn again.
export function captionSource(options: {
  namesSource?: string
  namesText?: string
}): CaptionSource {
  // Checked rather than trusted: these options come back out of jsonb, and a
  // row can hold whatever was written into it. Below, the answer picks a
  // column name.
  if (CAPTION_SOURCES.includes(options.namesSource as CaptionSource)) {
    return options.namesSource as CaptionSource
  }

  return options.namesText ? 'text' : 'tools'
}

export type LabelOptions = ContentsOptions | NumberOptions

// The tool names, their model numbers, or the line somebody typed.
//
// A model is what is written on the machine and what somebody orders a spare
// belt by — "POF 1200 F5" identifies the box more sharply than "Frezarka
// górnowrzecionowa", which is a category. Duplicates are dropped, because two
// identical batteries are one model and printing it twice says nothing twice.
async function caption(
  organizerId: number,
  options: ContentsOptions,
  pool: PgPool,
): Promise<string[]> {
  const source = captionSource(options)
  if (source === 'text') return options.namesText ? [options.namesText] : []

  // The one place a caption source becomes SQL, and it is a lookup in a fixed
  // map — the same rule as SORT_COLUMNS. A value that is not a key of this
  // cannot reach a query, whatever a row happens to hold.
  const column = CAPTION_COLUMNS[source]
  const result = await pool.query<{ value: string }>(
    `
      SELECT "t"."${column}" AS "value"
      FROM "catalog"."organizer_tool" AS "ot"
      JOIN "catalog"."tool" AS "t" ON "t"."id" = "ot"."tool_id"
      WHERE "ot"."organizer_id" = $1 AND btrim("t"."${column}") <> ''
      ORDER BY lower("t"."name")
    `,
    [organizerId],
  )

  return [...new Set(result.rows.map((row) => row.value.trim()))]
}

const CAPTION_COLUMNS: Record<Exclude<CaptionSource, 'text'>, string> = {
  models: 'model',
  tools: 'name',
}

export class LabelDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LabelDataError'
  }
}

export async function generateLabel(
  organizerId: number,
  size: { heightMm: number; widthMm: number },
  options: LabelOptions,
  pool: PgPool = db(),
): Promise<Uint8Array> {
  const artwork =
    options.template === 'number'
      ? await generateNumber(organizerId, size, options, pool)
      : await generateContents(organizerId, size, options, pool)

  // The marks go around the artwork rather than into it, so the templates stay
  // ignorant of how the file will be used.
  return options.printReady ? addPrintMarks(artwork, size) : artwork
}

async function generateNumber(
  organizerId: number,
  size: { heightMm: number; widthMm: number },
  options: NumberOptions,
  pool: PgPool,
): Promise<Uint8Array> {
  const organizer = await pool.query<{ number: string }>(
    `SELECT "number" FROM "catalog"."organizer" WHERE "id" = $1`,
    [organizerId],
  )
  if (!organizer.rows[0]) throw new LabelDataError('Nie ma takiego organizera')

  // The makers of the tools inside, most tools first: the one that owns most
  // of the box gets the larger share of the background.
  const brands = await pool.query<{ color: string; logo_key: null | string; name: string }>(
    `
      SELECT "b"."name", "b"."color",
             (SELECT "p"."storage_key" FROM "catalog"."photo_brand" AS "pb"
              JOIN "catalog"."photo" AS "p" ON "p"."id" = "pb"."photo_id"
              WHERE "pb"."brand_id" = "b"."id") AS "logo_key"
      FROM "catalog"."organizer_tool" AS "ot"
      JOIN "catalog"."tool" AS "t" ON "t"."id" = "ot"."tool_id"
      JOIN "catalog"."brand" AS "b" ON "b"."id" = "t"."brand_id"
      WHERE "ot"."organizer_id" = $1
      GROUP BY "b"."id", "b"."name", "b"."color"
      ORDER BY count(*) DESC, lower("b"."name")
    `,
    [organizerId],
  )

  const withLogos: NumberLabelBrand[] = await Promise.all(
    brands.rows.map(async (row) => ({
      color: row.color,
      logo: options.withLogos && row.logo_key ? await readPhotoBytes(row.logo_key) : null,
      name: row.name,
    })),
  )

  return drawNumberLabel({
    brands: withLogos,
    cutLine: options.printReady,
    heightMm: size.heightMm,
    number: Number(organizer.rows[0].number),
    widthMm: size.widthMm,
    withLogos: options.withLogos,
  })
}

async function generateContents(
  organizerId: number,
  size: { heightMm: number; widthMm: number },
  options: ContentsOptions,
  pool: PgPool,
): Promise<Uint8Array> {
  const organizer = await pool.query<{ name: string }>(
    `SELECT "name" FROM "catalog"."organizer" WHERE "id" = $1`,
    [organizerId],
  )
  if (!organizer.rows[0]) throw new LabelDataError('Nie ma takiego organizera')

  const ids = options.photoIds.slice(0, maxContentsPhotos(size))

  // Only pictures of the tools in this organizer. Asked of the database rather
  // than trusted from the request: the wizard offers the right ones, and this
  // is what stops a hand-written call from printing somebody else's photo.
  const photos = ids.length
    ? await pool.query<{ id: string; storage_key: string }>(
        `
          SELECT DISTINCT "p"."id", "p"."storage_key"
          FROM "catalog"."photo" AS "p"
          JOIN "catalog"."photo_tool" AS "pt" ON "pt"."photo_id" = "p"."id"
          JOIN "catalog"."organizer_tool" AS "ot" ON "ot"."tool_id" = "pt"."tool_id"
          WHERE "ot"."organizer_id" = $1 AND "p"."id" = ANY($2::bigint[])
        `,
        [organizerId, ids],
      )
    : { rows: [] as { id: string; storage_key: string }[] }

  if (photos.rows.length !== ids.length) {
    throw new LabelDataError('Któreś ze zdjęć nie należy do narzędzi z tego organizera')
  }

  // In the order they were ticked, not the order the database found them.
  const byId = new Map(photos.rows.map((row) => [Number(row.id), row.storage_key]))
  const bytes: Uint8Array[] = []
  for (const id of ids) {
    const key = byId.get(id)
    const data = key ? await readPhotoBytes(key) : null
    if (data) bytes.push(data)
  }

  // One typed line arrives as a list of one: the template composes a caption
  // out of whatever it is given, and shortening a list it cannot fit is the
  // same code either way.
  const names = options.withNames ? await caption(organizerId, options, pool) : []

  return drawContentsLabel({
    heightMm: size.heightMm,
    photos: bytes,
    title: options.withTitle ? options.titleText || organizer.rows[0].name : null,
    toolNames: names,
    widthMm: size.widthMm,
  })
}
