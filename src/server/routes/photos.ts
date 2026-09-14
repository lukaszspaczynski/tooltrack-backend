// Photos of a tool or of a case: list, add, promote, remove, serve, and the
// on-demand search that suggests where a picture could come from.
//
//   GET    /api/{tools,cases}/:id/photos               catalog.read
//   POST   /api/{tools,cases}/:id/photos               catalog.write  (raw bytes or JSON links)
//   POST   /api/{tools,cases}/:id/photos/attach        catalog.write
//   GET    /api/{tools,cases}/:id/photos/:photoId/file catalog.read
//   PATCH  /api/{tools,cases}/:id/photos/:photoId      catalog.write  ({ isPrimary: true })
//   DELETE /api/{tools,cases}/:id/photos/:photoId      catalog.write
//   GET    /api/{tools,cases}/:id/photo-suggestions    catalog.write
//
// One module for both because a case carries pictures on exactly the same
// terms as a tool. Which of the two is in the path arrives as an owner (see
// photo-owner.ts) and is the only difference that reaches the SQL.
//
// An upload arrives as the raw file in the request body with its own
// content-type, not as multipart/form-data. One file per request needs no
// envelope, and `fetch(url, { body: file })` in the browser is less code than
// building a FormData — while parsing multipart by hand in a server with no
// framework is the kind of code that is wrong for a year before anyone
// notices.

import { ImageConversionError, toStoredPng } from '../image-convert'
import { fetchRemoteFile, fetchRemoteImage, ImageFetchError, maxPhotoBytes } from '../image-fetch'
import {
  importerFor,
  IMPORT_SOURCES,
  REFERENCE_ATTRIBUTE,
  type ImportedProduct,
} from '../importers'
import { PhotoNotSuitableError } from '../cutout-local'
import { cutoutSubject, PhotoEditUnavailableError } from '../photo-edit'
import { getCase } from './cases-store'
import { readCutoutConfig } from './cutout-settings-store'
import { parseAttachIds } from './media-input'
import { parseCutoutCommitInput, parseCutoutRunInput } from './settings-input'
import {
  defaultCaseQuery,
  defaultQuery,
  PhotoSearchUnavailableError,
  searchPhotos,
} from '../photo-search'
import { credentialsForSearch, resolveEnginesFor } from './search-settings-store'
import { readImageMetadata } from '../image-metadata'
import {
  readPhotoBytes,
  readPreviewBytes,
  savePhotoBytes,
  savePreviewBytes,
} from '../photo-storage'
import type { RouteContext } from '../route-context'
import {
  OWNER_LABELS,
  ownerPath,
  parseOwnerId,
  parsePhotoOwner,
  type PhotoOwner,
} from './photo-owner'
import {
  attachPhotosTo,
  exclusivePhotoIds,
  getCardPhoto,
  insertPhoto,
  linkPhoto,
  listPhotos,
  PhotoAlreadyExistsError,
  setPrimaryPhoto,
  unlinkPhoto,
  type CardPhoto,
} from './photos-store'
import { getTool, listAttributes } from './tools-store'
import { t } from '../i18n'

// Write the picture, then put it on this card. Two steps because they are two
// facts — the same photograph can already be on our disk from another card,
// and then only the second one is new.
async function addToCard(
  owner: PhotoOwner,
  input: Parameters<typeof insertPhoto>[0],
  actorId: number,
): Promise<CardPhoto> {
  const photo = await insertPhoto(input, actorId)
  return linkPhoto(owner, photo.id, actorId)
}

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

// A link as the importers hand it over: an address that is certainly there,
// and where it came from — a paste, a search result, or a shop's gallery.
export type NormalisedLink = { attribution?: string; fromSearch: boolean; url: string }

// What the routes need to know about whichever card this is: that it exists,
// and — for the suggestions — what to type into a search engine on its behalf.
type OwnerCard = {
  searchQuery: string
}

export async function listGET(request: Request, context: RouteContext): Promise<Response> {
  const owner = parsePhotoOwner(context.params)
  if (!owner) return ownerNotFound(context)

  // `?exclusive=1` — only the pictures this card is the only home of. What a
  // delete confirmation needs: "and its photographs" is not something somebody
  // can weigh without a number, and the number is not the length of the
  // gallery when another card shows half of it.
  const photos = await listPhotos(owner)
  let shown = photos

  if (new URL(request.url).searchParams.get('exclusive') === '1') {
    const ids = new Set(await exclusivePhotoIds(owner))
    shown = photos.filter((photo) => ids.has(photo.id))
  }

  return Response.json({ photos: shown }, { headers: { 'cache-control': 'no-store' } })
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const owner = parsePhotoOwner(context.params)
  if (!owner) return ownerNotFound(context)

  // The card is checked before anything is stored: a photo of a card that does
  // not exist is a file nobody will ever delete.
  if (!(await loadOwner(owner))) return ownerNotFound(context)

  const actorId = context.user?.id
  if (!actorId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const contentType = request.headers.get('content-type') ?? ''

  return contentType.startsWith('image/')
    ? uploadBytes(request, owner, actorId)
    : importLinks(request, owner, actorId)
}

async function uploadBytes(
  request: Request,
  owner: PhotoOwner,
  actorId: number,
): Promise<Response> {
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength === 0) return Response.json({ error: 'Pusty plik' }, { status: 400 })

  let converted: Awaited<ReturnType<typeof toStoredPng>>
  try {
    // The declared content-type is a claim; the bytes decide, and whatever
    // they turn out to be is stored as PNG.
    converted = await toStoredPng(bytes)
  } catch (error) {
    if (error instanceof ImageConversionError) {
      return Response.json({ error: error.message }, { status: 415 })
    }
    throw error
  }

  try {
    const stored = await savePhotoBytes(converted.bytes, converted.metadata.contentType)
    const photo = await addToCard(
      owner,
      { metadata: converted.metadata, source: 'upload', stored },
      actorId,
    )

    return Response.json({ photo }, { status: 201 })
  } catch (error) {
    if (error instanceof PhotoAlreadyExistsError) {
      return Response.json({ error: error.message }, { status: 409 })
    }
    throw error
  }
}

// Fetching pictures from addresses and putting them on a card. Exported
// because the tool importer walks a shop's gallery the same way: a picture
// arriving from a URL should be stored, converted and refused on exactly the
// same terms whichever screen asked for it.
export async function importPhotoLinks(
  owner: PhotoOwner,
  items: NormalisedLink[],
  actorId: number,
): Promise<{ failed: { error: string; url: string }[]; photos: CardPhoto[] }> {
  const photos: CardPhoto[] = []
  const failed: { error: string; url: string }[] = []

  for (const item of items) {
    try {
      const fetched = await fetchRemoteImage(item.url, maxPhotoBytes())
      // Search engines serve a great deal of WebP; it is converted here, once,
      // rather than being a format every later step has to handle.
      const converted = await toStoredPng(fetched.bytes)
      const stored = await savePhotoBytes(converted.bytes, converted.metadata.contentType)

      photos.push(
        await addToCard(
          owner,
          {
            attribution: item.attribution,
            // A link someone pasted and a link someone ticked in the search
            // results are different provenance, and the card says which.
            source: item.fromSearch ? 'search' : 'url',
            sourceUrl: item.url,
            stored,
            metadata: converted.metadata,
          },
          actorId,
        ),
      )
    } catch (error) {
      // One bad link out of ten must not lose the other nine. Each failure is
      // reported next to the address that caused it.
      if (
        error instanceof ImageFetchError ||
        error instanceof ImageConversionError ||
        error instanceof PhotoAlreadyExistsError ||
        error instanceof TypeError
      ) {
        failed.push({ error: (error as Error).message, url: item.url })
        continue
      }
      throw error
    }
  }

  return { failed, photos }
}

// One pasted address, or a batch picked from the suggestions. Both go through
// the same path, because "save the three I ticked" is the same operation as
// "save this one" repeated.
async function importLinks(
  request: Request,
  owner: PhotoOwner,
  actorId: number,
): Promise<Response> {
  const body = (await readJson(request)) as null | ({ items?: LinkInput[] } & LinkInput)
  const items = normaliseLinks(body)

  if (items.length === 0) {
    return Response.json(
      { error: t('Podaj adres zdjęcia (url) albo listę (items)') },
      { status: 400 },
    )
  }
  if (items.length > MAX_IMPORT_ITEMS) {
    return Response.json(
      { error: t('Maksymalnie {max} zdjęć naraz', { max: MAX_IMPORT_ITEMS }) },
      { status: 400 },
    )
  }

  const { failed, photos } = await importPhotoLinks(owner, items, actorId)

  if (photos.length === 0) {
    return Response.json(
      { error: failed[0]?.error ?? t('Nie udało się pobrać zdjęć'), failed },
      { status: 422 },
    )
  }

  return Response.json({ failed, photos }, { status: 201 })
}

// POST .../photos/:photoId/cutout/preview — run the cutout and show it,
// without writing a photo.
//
// The result goes into the preview cache, which expires on its own, so a
// cutout nobody accepts costs nothing for long. Accepting it (commit, below)
// copies those bytes into the photo store and writes the row — which means a
// save costs no second call to a paid service to produce a picture the person
// has already looked at.
export async function cutoutPreviewPOST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const target = parsePhotoTarget(context)
  if (!target) return photoNotFound()

  const parsed = parseCutoutRunInput(await readJson(request))
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  const original = await getCardPhoto(target.owner, target.photoId)
  if (!original) return photoNotFound()

  const bytes = await readPhotoBytes(original.storageKey)
  if (!bytes) return photoNotFound()

  try {
    const cutout = await cutoutSubject(
      bytes,
      original.contentType,
      await readCutoutConfig(),
      parsed.value,
    )
    const png = await toStoredPng(cutout.bytes)
    // Into the preview cache, not the photo store: a cutout nobody accepts
    // expires on its own instead of becoming a file the catalog has to explain.
    const stored = await savePreviewBytes(png.bytes)

    return Response.json({
      preview: {
        byteSize: stored.byteSize,
        checksum: stored.checksum,
        contentType: png.metadata.contentType,
        height: png.metadata.height,
        url: `${ownerPath(target.owner)}/photos/${target.photoId}/cutout/preview/${stored.checksum}`,
        width: png.metadata.width,
      },
      provider: cutout.provider,
    })
  } catch (error) {
    return cutoutError(error)
  }
}

// The bytes of a preview. Addressed by checksum, so nothing here can serve a
// file that was not produced by a cutout somebody just ran.
export async function cutoutPreviewGET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const checksum = context.params.checksum ?? ''

  const preview = await readPreviewBytes(checksum)
  if (!preview) return photoNotFound()

  return new Response(preview.bytes, {
    headers: {
      // What is left of this preview's life, not a fresh TTL on every request:
      // a browser holding a picture the server has already swept is how a save
      // fails after a preview that still looked fine.
      'cache-control': `private, max-age=${Math.floor(preview.remainingMs / 1000)}`,
      'content-length': String(preview.bytes.byteLength),
      'content-type': 'image/png',
      etag: `"${checksum}"`,
    },
  })
}

// POST .../cutout/commit — keep a preview. The bytes are already on disk; this
// is the row that turns them into a photo of this card.
export async function cutoutCommitPOST(request: Request, context: RouteContext): Promise<Response> {
  const target = parsePhotoTarget(context)
  if (!target) return photoNotFound()

  const actorId = context.user?.id
  if (!actorId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = parseCutoutCommitInput(await readJson(request))
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  const original = await getCardPhoto(target.owner, target.photoId)
  if (!original) return photoNotFound()

  const preview = await readPreviewBytes(parsed.value.checksum)
  // Expired, or from a tab left open since yesterday. Asked for again rather
  // than half-saved.
  if (!preview) {
    return Response.json({ error: t('Podgląd wygasł — wygeneruj go ponownie') }, { status: 409 })
  }

  const metadata = readImageMetadata(preview.bytes)
  if (!metadata) return Response.json({ error: t('Podgląd jest uszkodzony') }, { status: 409 })

  try {
    // Keeping it means copying it out of the cache into the photo store, where
    // nothing sweeps it. Both are addressed by content, so the checksum — and
    // the client's idea of what it accepted — does not change.
    const stored = await savePhotoBytes(preview.bytes, metadata.contentType)

    const photo = await addToCard(
      target.owner,
      {
        attribution: original.attribution,
        derivedFrom: original.id,
        metadata,
        source: 'edit',
        sourceUrl: original.sourceUrl,
        stored,
      },
      actorId,
    )

    return Response.json({ photo }, { status: 201 })
  } catch (error) {
    if (error instanceof PhotoAlreadyExistsError) {
      return Response.json({ error: t('Takie wycięcie już jest na tej karcie') }, { status: 409 })
    }
    throw error
  }
}

// POST .../photos/:photoId/cutout — the one-click edit.
//
// It adds a photo rather than replacing one. The original stays, so a cutout
// that mangled the tool is one delete away from undone, and the two are linked
// by derivedFrom. The new photo does not become the main one on its own:
// whether the cutout is better than the photograph is a judgement, and the
// person looking at both makes it.
export async function cutoutPOST(_request: Request, context: RouteContext): Promise<Response> {
  const target = parsePhotoTarget(context)
  if (!target) return photoNotFound()

  const actorId = context.user?.id
  if (!actorId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const original = await getCardPhoto(target.owner, target.photoId)
  if (!original) return photoNotFound()

  const bytes = await readPhotoBytes(original.storageKey)
  if (!bytes) return photoNotFound()

  try {
    // Which method runs is settings, owned by an admin — see
    // routes/cutout-settings-store.ts.
    const cutout = await cutoutSubject(bytes, original.contentType, await readCutoutConfig())
    // A service may hand back something other than PNG; the same door applies.
    const png = await toStoredPng(cutout.bytes)
    const stored = await savePhotoBytes(png.bytes, png.metadata.contentType)

    const photo = await addToCard(
      target.owner,
      {
        attribution: original.attribution,
        derivedFrom: original.id,
        metadata: png.metadata,
        source: 'edit',
        sourceUrl: original.sourceUrl,
        stored,
      },
      actorId,
    )

    return Response.json({ photo, provider: cutout.provider }, { status: 201 })
  } catch (error) {
    return cutoutError(error)
  }
}

// POST .../photos/attach — put photos that already exist on this card.
//
// The other half of being able to upload a picture before deciding what it is:
// without this the library's unassigned shelf has no way out.
export async function attachPOST(request: Request, context: RouteContext): Promise<Response> {
  const owner = parsePhotoOwner(context.params)
  if (!owner) return ownerNotFound(context)

  const actorId = context.user?.id
  if (!actorId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await loadOwner(owner))) return ownerNotFound(context)

  const parsed = parseAttachIds(await readJson(request))
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  const result = await attachPhotosTo(owner, parsed.value, actorId)

  // Nothing attached is a refusal worth a status of its own; some of them
  // failing is normal and reported per photo.
  if (result.attached.length === 0) {
    return Response.json(
      {
        error: result.failed[0]?.reason ?? t('Nie udało się przypisać zdjęć'),
        failed: result.failed,
      },
      { status: 409 },
    )
  }

  return Response.json({ failed: result.failed, photos: result.attached }, { status: 201 })
}

export async function fileGET(_request: Request, context: RouteContext): Promise<Response> {
  const target = parsePhotoTarget(context)
  if (!target) return photoNotFound()

  const photo = await getCardPhoto(target.owner, target.photoId)
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
  const target = parsePhotoTarget(context)
  if (!target) return photoNotFound()

  const body = (await readJson(request)) as null | { isPrimary?: unknown }
  // Promoting is the only edit a photo has. Everything else about it — its
  // size, its type, where it came from — is a fact about the file.
  if (body?.isPrimary !== true) {
    return Response.json({ error: 'Jedyna zmiana to { "isPrimary": true }' }, { status: 400 })
  }

  const photo = await setPrimaryPhoto(target.owner, target.photoId)
  if (!photo) return photoNotFound()

  return Response.json({ photo })
}

export async function detailDELETE(_request: Request, context: RouteContext): Promise<Response> {
  const target = parsePhotoTarget(context)
  if (!target) return photoNotFound()

  // Off this card, and off the disk if no other card shows it.
  const deleted = await unlinkPhoto(target.owner, target.photoId)
  if (!deleted) return photoNotFound()

  return Response.json({ ok: true })
}

// The suggestions themselves: links and thumbnails, nothing downloaded. The
// client shows them, the person ticks the ones that are actually this machine
// or this box, and POST /photos with those addresses is what puts bytes on our
// disk.
// The pictures the product page this card was imported from publishes.
//
// Not a search: the address is written on the card, so this is the one source
// that cannot return somebody else's machine. Offered beside the engines
// because it is the same errand — pick the pictures worth keeping — and
// answered in the same shape, so the screen needs no second way to show them.
async function suggestFromPage(toolId: number): Promise<Response> {
  const reference = (await listAttributes(toolId)).find(
    (attribute) => attribute.name === REFERENCE_ATTRIBUTE,
  )?.value

  if (!reference) {
    return Response.json(
      { error: t('Ta karta nie ma adresu karty produktu'), providers: [] },
      { status: 422 },
    )
  }

  const importer = importerFor(reference)
  if (!importer) {
    return Response.json(
      {
        error: t('Nie umiem czytać tej strony. Obsługiwane źródła: {sources}', {
          sources: IMPORT_SOURCES.map((source) => source.label).join(', '),
        }),
        providers: [],
      },
      { status: 422 },
    )
  }

  let product: null | ImportedProduct
  try {
    const page = await fetchRemoteFile(reference, {
      accept: 'text/html,application/xhtml+xml',
      limit: 4_000_000,
    })
    product = importer.parse(new TextDecoder('utf-8').decode(page.bytes), reference)
  } catch {
    return Response.json(
      { error: t('Nie udało się pobrać strony produktu'), providers: [] },
      { status: 422 },
    )
  }

  if (!product) {
    return Response.json(
      { error: t('Pod tym adresem nie ma karty produktu'), providers: [] },
      { status: 422 },
    )
  }

  return Response.json(
    {
      // The whole answer's shape, not most of it: a screen reading `failed` on
      // a payload that happens to lack it is a blank page, which is how this
      // was found.
      failed: [],
      providers: ['page'],
      query: reference,
      suggestions: product.photoUrls.map((url) => ({
        attribution: new URL(reference).hostname.replace(/^www\./, ''),
        // The page states neither, and a number read off a file name is a
        // number somebody would trust.
        height: null,
        provider: 'page' as const,
        sourceUrl: reference,
        // The picture is its own thumbnail: a maker's photograph is one file,
        // not a set of sizes this can pick from.
        thumbnailUrl: url,
        title: product.name,
        url,
        width: null,
      })),
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}

export async function suggestionsGET(request: Request, context: RouteContext): Promise<Response> {
  const owner = parsePhotoOwner(context.params)
  if (!owner) return ownerNotFound(context)

  const actorId = context.user?.id
  if (!actorId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const card = await loadOwner(owner)
  if (!card) return ownerNotFound(context)

  const url = new URL(request.url)

  // `?source=page` — the product page rather than the engines. Only a tool has
  // one: a case is not imported from anywhere.
  if (url.searchParams.get('source') === 'page') {
    if (owner.kind !== 'tool') {
      return Response.json(
        { error: t('Ta karta nie ma adresu karty produktu'), providers: [] },
        { status: 422 },
      )
    }

    return suggestFromPage(owner.id)
  }

  const asked = url.searchParams.get('q')?.trim()
  const query = asked || card.searchQuery

  try {
    // Which engines this account searches with is settings, not code: global
    // configuration an admin owns, narrowed by the switches each person keeps
    // for themselves.
    // How many each of them may contribute is settings too, and it comes back
    // with them rather than being a constant here.
    const enabled = await resolveEnginesFor(actorId)
    const credentials = await credentialsForSearch(enabled.map((entry) => entry.provider))
    const engines = enabled.map((entry) => ({
      credentials: credentials.get(entry.provider) ?? { key: '', secret: '' },
      limit: entry.limit,
      provider: entry.provider,
    }))

    const result = await searchPhotos(query, engines)

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

// Does this card exist, and what would we type into a search engine for it? A
// tool is identified by its brand and model; a case by who makes it and what
// it is called.
async function loadOwner(owner: PhotoOwner): Promise<null | OwnerCard> {
  if (owner.kind === 'tool') {
    const tool = await getTool(owner.id)
    return tool ? { searchQuery: defaultQuery(tool) } : null
  }

  const found = await getCase(owner.id)
  return found ? { searchQuery: defaultCaseQuery(found) } : null
}

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

function parsePhotoTarget(context: RouteContext): null | { owner: PhotoOwner; photoId: number } {
  const owner = parsePhotoOwner(context.params)
  const photoId = parseOwnerId(context.params.photoId)
  if (!owner || photoId === null) return null
  return { owner, photoId }
}

// Three different failures with three different answers: this photo cannot be
// cut out (422), the service is unavailable (503), the result is already on
// the card (409). Only the middle one is the server's problem.
function cutoutError(error: unknown): Response {
  if (error instanceof PhotoNotSuitableError) {
    return Response.json({ error: error.message }, { status: 422 })
  }
  if (error instanceof PhotoEditUnavailableError) {
    return Response.json({ error: error.message }, { status: 503 })
  }
  if (error instanceof PhotoAlreadyExistsError) {
    return Response.json({ error: t('Takie wycięcie już jest na tej karcie') }, { status: 409 })
  }
  throw error
}

// "Nie ma takiego narzędzia" or "Nie ma takiej skrzynki", decided by the path
// the caller used, so a 404 never names the wrong kind of thing.
function ownerNotFound(context: RouteContext): Response {
  const owner = parsePhotoOwner(context.params)
  const label = owner ? OWNER_LABELS[owner.kind] : OWNER_LABELS.tool

  return Response.json({ error: t(label) }, { status: 404 })
}

function photoNotFound(): Response {
  return Response.json({ error: t('Nie ma takiego zdjęcia') }, { status: 404 })
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}
