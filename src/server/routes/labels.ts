// Every label there is, whichever organizer made it.
//
//   GET  /api/labels          catalog.read
//   GET  /api/labels/sheet    catalog.read
//   POST /api/labels/refresh  catalog.write
//
// A separate surface from the routes under an organizer, for the same reason
// the photo library sits next to the per-card gallery: those answer "what has
// this arrangement produced", this one answers "what have we printed". It is
// the screen for the afternoon after a box changed, when a shelf of stickers
// has to be drawn again and nobody wants to open twelve organizers to do it.
//
// Refreshing is POST rather than DELETE-with-a-body, like the batch delete in
// media.ts: it is a form submission with a list in it.

import { generateLabel, LabelDataError, type LabelOptions } from '../labels/generate'
import { buildLabelSheet, type SheetLabel } from '../labels/sheet'
import { parseLabelListQuery, parseSheetIds } from './labels-input'
import { labelsToDraw, labelsToRedraw, listAllLabels } from './labels-store'
import { redrawLabels } from './label-redraw'
import { parseLabelIds } from './organizers-input'

export async function GET(request: Request): Promise<Response> {
  const query = parseLabelListQuery(new URL(request.url).searchParams)
  if (!query.ok) return Response.json({ error: query.error }, { status: 400 })

  return Response.json(await listAllLabels(query.value), {
    headers: { 'cache-control': 'no-store' },
  })
}

// GET /api/labels/sheet?ids=1,2,3 — the chosen labels ganged onto A4.
//
// A GET because the screen opens it in a tab: the answer is a file to look at
// and print, not a row to keep. Nothing is stored — the sheet is a view of
// labels that already exist, and keeping it would mean a second thing to
// redraw whenever one of them changed.
//
// The artwork is drawn again with `printReady: false` rather than taken from
// the label's own file: that file has a margin and crop marks around it, and
// thirty margins is most of a sheet of paper. Drawing it again also means a
// sheet can never show something the label no longer says.
export async function sheetGET(request: Request): Promise<Response> {
  const ids = parseSheetIds(new URL(request.url).searchParams)
  if (!ids.ok) return Response.json({ error: ids.error }, { status: 400 })

  const labels = await labelsToDraw(ids.value)
  if (labels.length === 0) {
    return Response.json({ error: 'Nie ma takich etykiet' }, { status: 404 })
  }

  const drawn: SheetLabel[] = []
  const failed: string[] = []

  for (const label of labels) {
    try {
      drawn.push({
        artwork: await generateLabel(
          label.organizerId,
          { heightMm: label.heightMm, widthMm: label.widthMm },
          { ...label.options, printReady: false } as unknown as LabelOptions,
        ),
        heightMm: label.heightMm,
        widthMm: label.widthMm,
      })
    } catch (error) {
      // One label whose photos have gone missing must not cost the other
      // twenty-nine their sheet, the same rule the redraw follows.
      if (!(error instanceof LabelDataError)) throw error
      failed.push(`${label.widthMm} × ${label.heightMm} mm: ${error.message}`)
    }
  }

  if (drawn.length === 0) {
    return Response.json({ error: failed.join('; ') }, { status: 422 })
  }

  // What could not be drawn goes onto the sheet itself. The answer to this
  // route is a file in a new tab and nothing reads a header or a status line,
  // so a sheet of a hundred and ninety-four would otherwise be indistinguish-
  // able from the two hundred that were asked for.
  const sheet = await buildLabelSheet(
    drawn,
    'ToolTrack · arkusz zbiorczy',
    failed.length > 0 ? [`nie udało się narysować: ${failed.length}`] : [],
  )

  return new Response(sheet.bytes, {
    headers: {
      // Never cached: the same ids draw a different sheet as soon as one of
      // the labels is redrawn.
      'cache-control': 'no-store',
      'content-disposition': 'inline; filename="etykiety-arkusz.pdf"',
      'content-length': String(sheet.bytes.byteLength),
      'content-type': 'application/pdf',
    },
  })
}

// POST /api/labels/refresh — draw the chosen labels again, wherever they live.
//
// The selection spans organizers, so the answer cannot be one of them the way
// the per-organizer refresh's is: the screen re-reads the list instead. What it
// does say is how many were drawn and which were not, because a label whose
// photos have been deleted since is the one thing somebody has to act on.
export async function refreshPOST(request: Request): Promise<Response> {
  const parsed = parseLabelIds(await readJson(request))
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  const labels = await labelsToRedraw(parsed.value, null)
  if (labels.length === 0) {
    return Response.json({ error: 'Nie ma takich etykiet' }, { status: 404 })
  }

  const { failed, refreshed } = await redrawLabels(labels)

  return Response.json({ failed, refreshed })
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}
