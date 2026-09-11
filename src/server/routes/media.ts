// The photo library: every picture on our disk, across all tools.
//
//   GET  /api/photos          tools.read
//   POST /api/photos/delete   tools.write
//
// A separate surface from /api/tools/:id/photos on purpose. That one answers
// "what does this tool look like"; this one answers "what did we import", and
// it exists for the cleanup after a batch that pulled in the wrong pictures.
//
// Deleting is POST rather than DELETE-with-a-body: a body on DELETE is legal
// but not universally carried by proxies, and this is a form submission with a
// list in it.

import type { RouteContext } from '../route-context'
import { parseDeleteIds, parseMediaQuery } from './media-input'
import { deletePhotosByIds, listAllPhotos } from './photos-store'

export async function GET(request: Request): Promise<Response> {
  const query = parseMediaQuery(new URL(request.url).searchParams)
  if (!query.ok) return Response.json({ error: query.error }, { status: 400 })

  const page = await listAllPhotos(query.value)

  return Response.json(page, { headers: { 'cache-control': 'no-store' } })
}

export async function deletePOST(request: Request, _context: RouteContext): Promise<Response> {
  const parsed = parseDeleteIds(await readJson(request))
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  const result = await deletePhotosByIds(parsed.value)

  // `deleted` can be lower than the number asked for: someone else may have
  // removed a photo between the screen loading and the button being pressed.
  // The client shows what actually happened rather than what was requested.
  return Response.json({
    deleted: result.deleted,
    promotedTools: result.promotedTools,
    requested: parsed.value.length,
  })
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}
