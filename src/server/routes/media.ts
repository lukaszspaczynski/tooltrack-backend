// The photo library: every picture on our disk, whatever it is a picture of.
//
//   GET  /api/photos          catalog.read
//   POST /api/photos/delete   catalog.write
//
// A separate surface from the per-card photo routes on purpose. Those answer
// "what does this tool or this case look like"; this one answers "what did we
// import", and it exists for the cleanup after a batch that pulled in the
// wrong pictures.
//
// Deleting is POST rather than DELETE-with-a-body: a body on DELETE is legal
// but not universally carried by proxies, and this is a form submission with a
// list in it.

import { ImageConversionError, toStoredPng } from '../image-convert'
import { fetchRemoteImage, ImageFetchError, maxPhotoBytes } from '../image-fetch'
import { readPhotoBytes, savePhotoBytes } from '../photo-storage'
import type { RouteContext } from '../route-context'
import { parseDeleteIds, parseMediaQuery } from './media-input'
import {
  deletePhotosByIds,
  findPhotoByChecksum,
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
// The same raw-body upload as the per-card one, and the same conversion to
// PNG — or, when the body is JSON, the same fetch from an address. A logo or a
// manual is as likely to be a link somebody has as a file on their phone, and
// the library is where both wait.
export async function uploadPOST(request: Request, context: RouteContext): Promise<Response> {
  const actorId = context.user?.id
  if (!actorId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.startsWith('image/')) return importFromUrl(request, actorId)

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

  const stored = await savePhotoBytes(converted.bytes, converted.metadata.contentType)

  // No card, so no link: the picture goes on the shelf and waits. If those
  // bytes are already on our disk this answers with the picture that is there,
  // rather than refusing — it is the same photograph, and a 409 would only
  // make the client ask what to do about a fact nobody can change.
  const photo = await insertPhoto(
    { metadata: converted.metadata, source: 'upload', stored },
    actorId,
  )

  return Response.json({ photo }, { status: 201 })
}

// POST /api/photos with { url } — the same picture, fetched here rather than
// sent. Every guard the per-card import uses applies: the address is checked
// before anything is opened, the bytes decide what the file really is, and
// whatever it turns out to be is stored as PNG.
async function importFromUrl(request: Request, actorId: number): Promise<Response> {
  const body = (await readJson(request)) as null | { attribution?: unknown; url?: unknown }
  const url = typeof body?.url === 'string' ? body.url.trim() : ''
  if (!url) return Response.json({ error: 'Podaj adres zdjęcia (url)' }, { status: 400 })

  try {
    const fetched = await fetchRemoteImage(url, maxPhotoBytes())
    const converted = await toStoredPng(fetched.bytes)
    const stored = await savePhotoBytes(converted.bytes, converted.metadata.contentType)

    // Asked before writing, because the checksum is unique and the answer is
    // otherwise indistinguishable: a screen that says "added" about a picture
    // that was already here sends somebody looking for a row that is not new.
    const existing = await findPhotoByChecksum(stored.checksum)

    const photo = await insertPhoto(
      {
        attribution: typeof body?.attribution === 'string' ? body.attribution : undefined,
        metadata: converted.metadata,
        source: 'url',
        sourceUrl: url,
        stored,
      },
      actorId,
    )

    // The flag as well as the status: the client reads bodies, not codes, and
    // "already here" is the difference between a screen that grew a row and
    // one that did not.
    return Response.json({ created: existing === null, photo }, { status: existing ? 200 : 201 })
  } catch (error) {
    // A bad address, a page that is not an image, or something too large: all
    // of them are about what was asked for, not about this server.
    if (error instanceof ImageFetchError || error instanceof ImageConversionError) {
      return Response.json({ error: error.message }, { status: 422 })
    }
    if (error instanceof TypeError) {
      return Response.json({ error: 'Nie udało się pobrać zdjęcia' }, { status: 422 })
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
    // Which cards now show a different main photo, and what kind of card each
    // one is: deleting the main picture of a case changes the shelf as much as
    // deleting a tool's changes the catalog.
    promoted: result.promoted,
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
