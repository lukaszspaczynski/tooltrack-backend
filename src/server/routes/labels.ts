// Every label there is, whichever organizer made it.
//
//   GET  /api/labels          catalog.read
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

import { parseLabelListQuery } from './labels-input'
import { labelsToRedraw, listAllLabels } from './labels-store'
import { redrawLabels } from './label-redraw'
import { parseLabelIds } from './organizers-input'

export async function GET(request: Request): Promise<Response> {
  const query = parseLabelListQuery(new URL(request.url).searchParams)
  if (!query.ok) return Response.json({ error: query.error }, { status: 400 })

  return Response.json(await listAllLabels(query.value), {
    headers: { 'cache-control': 'no-store' },
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
