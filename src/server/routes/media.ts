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

import { ImageConversionError, toStoredPng } from '../image-convert'
import { readPhotoBytes, savePhotoBytes } from '../photo-storage'
import type { RouteContext } from '../route-context'
import { parseDeleteIds, parseMediaQuery } from './media-input'
import {
  deletePhotosByIds,
  getPhotoById,
  insertPhoto,
  listAllPhotos,
  PhotoAlreadyExistsError,
} from './photos-store'

export async function GET(request: Request): Promise<Response> {
  const query = parseMediaQuery(new URL(request.url).searchParams)
  if (!query.ok) return Response.json({ error: query.error }, { status: 400 })

  const page = await listAllPhotos(query.value)

  return Response.json(page, { headers: { 'cache-control': 'no-store' } })
}

// POST /api/photos — an upload that belongs to no tool.
//
// Pictures arrive before anyone decides what they are: a batch off a phone at
// the end of a day, something found while looking for something else. Forcing
// a tool at that moment is how photos end up on the wrong card; they wait in
// the library instead, and the filter on that screen is how you find them
// again.
//
// The same raw-body upload as the per-tool one, and the same conversion to PNG.
export async function uploadPOST(request: Request, context: RouteContext): Promise<Response> {
  const actorId = context.user?.id
  if (!actorId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength === 0) return Response.json({ error: 'Pusty plik' }, { status: 400 })

  let converted: Awaited<ReturnType<typeof toStoredPng>>
  try {
    converted = await toStoredPng(bytes)
  } catch (error) {
    if (error instanceof ImageConversionError) {
      return Response.json({ error: error.message }, { status: 415 })
    }
    throw error
  }

  try {
    const stored = await savePhotoBytes(converted.bytes, converted.metadata.contentType)
    const photo = await insertPhoto(
      { metadata: converted.metadata, source: 'upload', stored, toolId: null },
      actorId,
    )

    return Response.json({ photo }, { status: 201 })
  } catch (error) {
    if (error instanceof PhotoAlreadyExistsError) {
      // The partial unique index on unattached checksums: the same picture is
      // already waiting in the library.
      return Response.json({ error: 'To zdjęcie już jest w bibliotece' }, { status: 409 })
    }
    throw error
  }
}

// GET /api/photos/:id/file — the bytes, by the photo's own id.
//
// The per-tool path still works and still serves the same file; this one is
// what an unattached photo can be reached through at all.
export async function fileGET(_request: Request, context: RouteContext): Promise<Response> {
  const id = Number(context.params.id)
  if (!Number.isSafeInteger(id) || id <= 0) return notFound()

  const photo = await getPhotoById(id)
  if (!photo) return notFound()

  const bytes = await readPhotoBytes(photo.storageKey)
  if (!bytes) return notFound()

  return new Response(bytes, {
    headers: {
      'cache-control': 'private, max-age=31536000, immutable',
      'content-length': String(bytes.byteLength),
      'content-type': photo.contentType,
      etag: `"${photo.checksum}"`,
    },
  })
}

function notFound(): Response {
  return Response.json({ error: 'Nie ma takiego zdjęcia' }, { status: 404 })
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
