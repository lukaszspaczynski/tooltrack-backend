// Every label there is, whichever organizer made it.
//
//   GET  /api/labels          catalog.read
//
// A separate surface from the routes under an organizer, for the same reason
// the photo library sits next to the per-card gallery: those answer "what has
// this arrangement produced", this one answers "what have we printed". It is
// the screen for the afternoon after a box changed, when a shelf of stickers
// has to be drawn again and nobody wants to open twelve organizers to do it.

import { parseLabelListQuery } from './labels-input'
import { listAllLabels } from './labels-store'

export async function GET(request: Request): Promise<Response> {
  const query = parseLabelListQuery(new URL(request.url).searchParams)
  if (!query.ok) return Response.json({ error: query.error }, { status: 400 })

  return Response.json(await listAllLabels(query.value), {
    headers: { 'cache-control': 'no-store' },
  })
}
