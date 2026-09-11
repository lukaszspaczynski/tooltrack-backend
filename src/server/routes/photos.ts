// Photos of a tool: list, add, promote, remove, serve, and the on-demand
// search that suggests where a picture could come from.
//
//   GET    /api/tools/:id/photos               tools.read
//   POST   /api/tools/:id/photos               tools.write  (raw bytes or JSON links)
//   GET    /api/tools/:id/photos/:photoId/file tools.read
//   PATCH  /api/tools/:id/photos/:photoId      tools.write  ({ isPrimary: true })
//   DELETE /api/tools/:id/photos/:photoId      tools.write
//   GET    /api/tools/:id/photo-suggestions    tools.write
//
// An upload arrives as the raw file in the request body with its own
// content-type, not as multipart/form-data. One file per request needs no
// envelope, and `fetch(url, { body: file })` in the browser is less code than
// building a FormData — while parsing multipart by hand in a server with no
// framework is the kind of code that is wrong for a year before anyone
// notices.

import { fetchRemoteImage, ImageFetchError, maxPhotoBytes } from '../image-fetch'
import { PhotoNotSuitableError } from '../cutout-local'
import { cutoutSubject, PhotoEditUnavailableError } from '../photo-edit'
import { readImageMetadata } from '../image-metadata'
import {
  defaultQuery,
  MAX_SUGGESTIONS_PER_ENGINE,
  PhotoSearchUnavailableError,
  searchPhotos,
} from '../photo-search'
import { credentialsForSearch, resolveProvidersFor } from './search-settings-store'
import { readPhotoBytes, savePhotoBytes } from '../photo-storage'
import type { RouteContext } from '../route-context'
import {
  deletePhoto,
  getPhoto,
  insertPhoto,
  listPhotos,
  PhotoAlreadyExistsError,
  setPrimaryPhoto,
  type ToolPhoto,
} from './photos-store'
import { getTool } from './tools-store'

// How many links one request may import. Larger than a single engine's ten,
// because with several engines enabled the suggestion grid holds more than one
// engine's worth and someone may reasonably tick a screenful. Each one is
// fetched server-side, so this is also the ceiling on how long the request can
// take.
const MAX_IMPORT_ITEMS = 30

type LinkInput = {
  attribution?: string
  url?: string
}

export async function listGET(_request: Request, context: RouteContext): Promise<Response> {
  const toolId = parseId(context.params.id)
  if (toolId === null) return toolNotFound()

  return Response.json(
    { photos: await listPhotos(toolId) },
    { headers: { 'cache-control': 'no-store' } },
  )
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const toolId = parseId(context.params.id)
  if (toolId === null) return toolNotFound()

  // The tool is checked before anything is stored: a photo of a card that does
  // not exist is a file nobody will ever delete.
  const tool = await getTool(toolId)
  if (!tool) return toolNotFound()

  const actorId = context.user?.id
  if (!actorId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const contentType = request.headers.get('content-type') ?? ''

  return contentType.startsWith('image/')
    ? uploadBytes(request, toolId, actorId)
    : importLinks(request, toolId, actorId)
}

async function uploadBytes(request: Request, toolId: number, actorId: number): Promise<Response> {
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength === 0) return Response.json({ error: 'Pusty plik' }, { status: 400 })

  // The declared content-type is a claim; the bytes decide.
  const metadata = readImageMetadata(bytes)
  if (!metadata) {
    return Response.json(
      { error: 'Ten plik nie jest obrazem JPEG, PNG, GIF ani WebP' },
      { status: 415 },
    )
  }

  try {
    const stored = await savePhotoBytes(bytes, metadata.contentType)
    const photo = await insertPhoto({ metadata, source: 'upload', stored, toolId }, actorId)

    return Response.json({ photo }, { status: 201 })
  } catch (error) {
    if (error instanceof PhotoAlreadyExistsError) {
      return Response.json({ error: error.message }, { status: 409 })
    }
    throw error
  }
}

// One pasted address, or a batch picked from the suggestions. Both go through
// the same path, because "save the three I ticked" is the same operation as
// "save this one" repeated.
async function importLinks(request: Request, toolId: number, actorId: number): Promise<Response> {
  const body = (await readJson(request)) as null | ({ items?: LinkInput[] } & LinkInput)
  const items = normaliseLinks(body)

  if (items.length === 0) {
    return Response.json({ error: 'Podaj adres zdjęcia (url) albo listę (items)' }, { status: 400 })
  }
  if (items.length > MAX_IMPORT_ITEMS) {
    return Response.json({ error: `Maksymalnie ${MAX_IMPORT_ITEMS} zdjęć naraz` }, { status: 400 })
  }

  const photos: ToolPhoto[] = []
  const failed: { error: string; url: string }[] = []

  for (const item of items) {
    try {
      const fetched = await fetchRemoteImage(item.url, maxPhotoBytes())
      const stored = await savePhotoBytes(fetched.bytes, fetched.metadata.contentType)

      photos.push(
        await insertPhoto(
          {
            attribution: item.attribution,
            metadata: fetched.metadata,
            // A link someone pasted and a link someone ticked in the search
            // results are different provenance, and the card says which.
            source: item.fromSearch ? 'search' : 'url',
            sourceUrl: item.url,
            stored,
            toolId,
          },
          actorId,
        ),
      )
    } catch (error) {
      // One bad link out of ten must not lose the other nine. Each failure is
      // reported next to the address that caused it.
      if (
        error instanceof ImageFetchError ||
        error instanceof PhotoAlreadyExistsError ||
        error instanceof TypeError
      ) {
        failed.push({ error: (error as Error).message, url: item.url })
        continue
      }
      throw error
    }
  }

  if (photos.length === 0) {
    return Response.json(
      { error: failed[0]?.error ?? 'Nie udało się pobrać zdjęć', failed },
      { status: 422 },
    )
  }

  return Response.json({ failed, photos }, { status: 201 })
}

// POST /api/tools/:id/photos/:photoId/cutout — the AI edit.
//
// It adds a photo rather than replacing one. The original stays, so a cutout
// that mangled the tool is one delete away from undone, and the two are linked
// by derivedFrom. The new photo does not become the main one on its own:
// whether the cutout is better than the photograph is a judgement, and the
// person looking at both makes it.
export async function cutoutPOST(_request: Request, context: RouteContext): Promise<Response> {
  const toolId = parseId(context.params.id)
  const photoId = parseId(context.params.photoId)
  if (toolId === null || photoId === null) return photoNotFound()

  const actorId = context.user?.id
  if (!actorId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const original = await getPhoto(toolId, photoId)
  if (!original) return photoNotFound()

  const bytes = await readPhotoBytes(original.storageKey)
  if (!bytes) return photoNotFound()

  try {
    const cutout = await cutoutSubject(bytes, original.contentType)
    const stored = await savePhotoBytes(cutout.bytes, cutout.metadata.contentType)

    const photo = await insertPhoto(
      {
        attribution: original.attribution,
        derivedFrom: original.id,
        metadata: cutout.metadata,
        source: 'edit',
        sourceUrl: original.sourceUrl,
        stored,
        toolId,
      },
      actorId,
    )

    return Response.json({ photo, provider: cutout.provider }, { status: 201 })
  } catch (error) {
    // Two different failures needing two different answers: the service is
    // unavailable (503 — try later, or configure one), or this photograph
    // cannot be cut out (422 — try another photo). Only the first is ours.
    if (error instanceof PhotoNotSuitableError) {
      return Response.json({ error: error.message }, { status: 422 })
    }
    if (error instanceof PhotoEditUnavailableError) {
      return Response.json({ error: error.message }, { status: 503 })
    }
    if (error instanceof PhotoAlreadyExistsError) {
      // The cutout came back byte-identical to something already on the card,
      // which in practice means it was cut out once before.
      return Response.json({ error: 'Takie wycięcie już jest na tej karcie' }, { status: 409 })
    }
    throw error
  }
}

export async function fileGET(_request: Request, context: RouteContext): Promise<Response> {
  const toolId = parseId(context.params.id)
  const photoId = parseId(context.params.photoId)
  if (toolId === null || photoId === null) return photoNotFound()

  const photo = await getPhoto(toolId, photoId)
  if (!photo) return photoNotFound()

  const bytes = await readPhotoBytes(photo.storageKey)
  // A row whose file is missing is a broken photo, not a broken server.
  if (!bytes) return photoNotFound()

  return new Response(bytes, {
    headers: {
      'content-length': String(bytes.byteLength),
      'content-type': photo.contentType,
      // The bytes are content-addressed and the URL carries a row id, so this
      // response can never change. It still stays private: the catalog is
      // behind a login and a shared cache must not hold it.
      'cache-control': 'private, max-age=31536000, immutable',
      etag: `"${photo.checksum}"`,
    },
  })
}

export async function detailPATCH(request: Request, context: RouteContext): Promise<Response> {
  const toolId = parseId(context.params.id)
  const photoId = parseId(context.params.photoId)
  if (toolId === null || photoId === null) return photoNotFound()

  const body = (await readJson(request)) as null | { isPrimary?: unknown }
  // Promoting is the only edit a photo has. Everything else about it — its
  // size, its type, where it came from — is a fact about the file.
  if (body?.isPrimary !== true) {
    return Response.json({ error: 'Jedyna zmiana to { "isPrimary": true }' }, { status: 400 })
  }

  const photo = await setPrimaryPhoto(toolId, photoId)
  if (!photo) return photoNotFound()

  return Response.json({ photo })
}

export async function detailDELETE(_request: Request, context: RouteContext): Promise<Response> {
  const toolId = parseId(context.params.id)
  const photoId = parseId(context.params.photoId)
  if (toolId === null || photoId === null) return photoNotFound()

  const deleted = await deletePhoto(toolId, photoId)
  if (!deleted) return photoNotFound()

  return Response.json({ ok: true })
}

// The suggestions themselves: links and thumbnails, nothing downloaded. The
// client shows them, the person ticks the ones that are actually this machine,
// and POST /photos with those addresses is what puts bytes on our disk.
export async function suggestionsGET(request: Request, context: RouteContext): Promise<Response> {
  const toolId = parseId(context.params.id)
  if (toolId === null) return toolNotFound()

  const tool = await getTool(toolId)
  if (!tool) return toolNotFound()

  const actorId = context.user?.id
  if (!actorId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const asked = new URL(request.url).searchParams.get('q')?.trim()
  const query = asked || defaultQuery(tool)

  try {
    // Which engines this account searches with is settings, not code: global
    // configuration an admin owns, narrowed by the switches each person keeps
    // for themselves.
    const providers = await resolveProvidersFor(actorId)
    const credentials = await credentialsForSearch(providers)
    const engines = providers.map((provider) => ({
      credentials: credentials.get(provider) ?? { key: '', secret: '' },
      provider,
    }))

    const result = await searchPhotos(query, engines, MAX_SUGGESTIONS_PER_ENGINE)

    return Response.json(result, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    if (error instanceof PhotoSearchUnavailableError) {
      // 503, not 500: the catalog is fine, this one integration is not, and
      // the client should say so rather than look broken.
      return Response.json({ error: error.message, providers: [] }, { status: 503 })
    }
    throw error
  }
}

type NormalisedLink = { attribution?: string; fromSearch: boolean; url: string }

function normaliseLinks(body: null | ({ items?: LinkInput[] } & LinkInput)): NormalisedLink[] {
  if (!body) return []

  if (Array.isArray(body.items)) {
    return body.items
      .filter((item) => typeof item?.url === 'string' && item.url.trim())
      .map((item) => ({
        attribution: typeof item.attribution === 'string' ? item.attribution : undefined,
        fromSearch: true,
        url: item.url!.trim(),
      }))
  }

  if (typeof body.url === 'string' && body.url.trim()) {
    return [
      {
        attribution: typeof body.attribution === 'string' ? body.attribution : undefined,
        fromSearch: false,
        url: body.url.trim(),
      },
    ]
  }

  return []
}

function parseId(value: string | undefined): null | number {
  if (!value || !/^\d+$/.test(value)) return null

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function toolNotFound(): Response {
  return Response.json({ error: 'Tool not found' }, { status: 404 })
}

function photoNotFound(): Response {
  return Response.json({ error: 'Nie ma takiego zdjęcia' }, { status: 404 })
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}
