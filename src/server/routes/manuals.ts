// The manuals of a tool: the PDF from the box, a parts diagram, a safety sheet.
//
//   GET    /api/tools/:id/manuals            catalog.read
//   POST   /api/tools/:id/manuals            catalog.write
//   POST   /api/tools/:id/manuals/from-page  catalog.write
//   PATCH  /api/tools/:id/manuals/:manualId  catalog.write
//   DELETE /api/tools/:id/manuals/:manualId  catalog.write
//   GET    /api/manuals/:id/file             catalog.read
//
// Three ways in, because that is how a manual actually reaches somebody: the
// file is on the laptop that came with the tool, or it is one link away on the
// maker's website, or it is on the product page the card was imported from and
// nobody should have to go and find it.
//
// Whichever way it arrives, the bytes are checked to be a PDF here rather than
// trusted from a header or a file extension.

import { fetchRemoteFile, ImageFetchError } from '../image-fetch'
import { errorResponse, type ErrorCode } from '../error-codes'
import { fitToCard, importerFor, MANUAL_SOURCES } from '../importers'
import { t } from '../i18n'
import {
  isPdf,
  MAX_MANUAL_BYTES,
  readManualBytes,
  saveManualBytes,
  titleFromFileName,
} from '../manual-storage'
import type { RouteContext } from '../route-context'
import {
  attachManualsTo,
  deleteManualsByIds,
  getManualById,
  insertManual,
  linkManual,
  listAllManuals,
  listManuals,
  ManualAlreadyOnCardError,
  retitleManual,
  renameManual,
  unlinkManual,
  type Manual,
  type ManualSource,
} from './manuals-store'
import { parseManualIds, parseManualQuery, parseManualTitle, parseManualUrl } from './manuals-input'
import { getTool } from './tools-store'

// A page offering thirty documents is a page listing somebody's whole
// catalogue; a tool has a manual, maybe a diagram, maybe a safety sheet.
const MAX_IMPORT_MANUALS = 8

export async function listGET(_request: Request, context: RouteContext): Promise<Response> {
  const toolId = parseId(context.params.id)
  if (toolId === null) return notFound()

  return Response.json(
    { manuals: await listManuals(toolId) },
    { headers: { 'cache-control': 'no-store' } },
  )
}

// Two request shapes on one route, like the photos: the bytes of a file, or an
// address to fetch them from.
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const toolId = parseId(context.params.id)
  if (toolId === null) return notFound()
  if (!(await getTool(toolId))) return notFound()

  const actorId = context.user?.id ?? 0
  const contentType = request.headers.get('content-type') ?? ''

  if (contentType.includes('application/pdf') || contentType.includes('octet-stream')) {
    const title = new URL(request.url).searchParams.get('name') ?? ''

    const bytes = new Uint8Array(await request.arrayBuffer())

    return answering(() =>
      saveManualBytesFor(
        toolId,
        bytes,
        { source: 'upload', title: titleFromFileName(title) },
        actorId,
      ),
    )
  }

  const parsed = parseManualUrl(await readJson(request))
  if (!parsed.ok) return errorResponse(400, 'INVALID_BODY', parsed.error)

  return answering(() =>
    saveManualFromUrl(toolId, parsed.value.url, parsed.value.title, 'url', actorId),
  )
}

// POST /api/tools/:id/manuals/from-page — the documents a product page offers.
//
// The address is read by the same scripts that import a whole card, so a shop
// this server cannot read is refused here in the same words. A page that has
// no documents is not an error: most shops publish none, and saying so is the
// answer.
export async function fromPagePOST(request: Request, context: RouteContext): Promise<Response> {
  const toolId = parseId(context.params.id)
  if (toolId === null) return notFound()
  if (!(await getTool(toolId))) return notFound()

  const parsed = parseManualUrl(await readJson(request))
  if (!parsed.ok) return errorResponse(400, 'INVALID_BODY', parsed.error)

  const importer = importerFor(parsed.value.url)
  // Only the pages that publish documents are offered, so only those are
  // accepted: fetching a shop's product page to tell somebody afterwards that
  // it has no manuals is a round trip nobody needed.
  if (!importer || !importer.manuals) {
    return Response.json(
      {
        error: importer
          ? t('{source} nie udostępnia instrukcji. Spróbuj ze strony producenta: {sources}', {
              source: importer.label,
              sources: MANUAL_SOURCES.map((source) => source.label).join(', '),
            })
          : t('Nie umiem czytać tej strony. Obsługiwane źródła: {sources}', {
              sources: MANUAL_SOURCES.map((source) => source.label).join(', '),
            }),
      },
      { status: 400 },
    )
  }

  let html: string
  try {
    const page = await fetchRemoteFile(parsed.value.url, {
      accept: 'text/html,application/xhtml+xml',
      limit: 4_000_000,
    })
    html = new TextDecoder('utf-8').decode(page.bytes)
  } catch {
    return errorResponse(422, 'PAGE_UNREACHABLE', t('Nie udało się pobrać strony produktu'))
  }

  const product = importer.parse(html, parsed.value.url)
  if (!product) {
    return errorResponse(422, 'NOT_A_PRODUCT_PAGE', t('Pod tym adresem nie ma karty produktu'))
  }

  const offered = fitToCard(product).manuals.slice(0, MAX_IMPORT_MANUALS)
  if (offered.length === 0) {
    return errorResponse(
      422,
      'SOURCE_HAS_NO_MANUALS',
      t('Ta strona nie udostępnia żadnych instrukcji'),
    )
  }

  const manuals: Manual[] = []
  const failed: { error: string; url: string }[] = []

  for (const manual of offered) {
    try {
      manuals.push(
        await saveManualFromUrl(toolId, manual.url, manual.title, 'import', context.user?.id ?? 0),
      )
    } catch (error) {
      // One document that will not download must not lose the others.
      if (error instanceof ManualRejectedError) {
        failed.push({ error: error.message, url: manual.url })
        continue
      }
      throw error
    }
  }

  if (manuals.length === 0) {
    return errorResponse(
      422,
      'DOWNLOAD_FAILED',
      failed[0]?.error ?? t('Nie udało się pobrać instrukcji'),
      {
        extra: { failed },
      },
    )
  }

  return Response.json({ failed, manuals }, { status: 201 })
}

// GET /api/manuals — every manual there is, whichever tool keeps it.
//
// The shelf rather than the drawer, the same split the photo library makes:
// the panel on a card answers "what does this tool come with", this answers
// "what documents do we have", which is the question somebody asks when a
// manual is missing from a card that should have it.
export async function libraryGET(request: Request): Promise<Response> {
  const query = parseManualQuery(new URL(request.url).searchParams)

  return Response.json(await listAllManuals(query), {
    headers: { 'cache-control': 'no-store' },
  })
}

// PATCH /api/manuals/:id — renaming from the library, where the document is
// not being looked at through any one card.
export async function libraryPATCH(request: Request, context: RouteContext): Promise<Response> {
  const manualId = parseId(context.params.id)
  if (manualId === null) return notFound()

  const parsed = parseManualTitle(await readJson(request))
  if (!parsed.ok) return errorResponse(400, 'INVALID_BODY', parsed.error)

  const manual = await retitleManual(manualId, parsed.value)
  if (!manual) return notFound()

  return Response.json({ manual })
}

// POST /api/manuals/delete — off every card at once and off the disk.
//
// A batch, like the photo library's bin: "these documents should not be in the
// catalog" is a decision somebody makes about several at a time, and it is a
// different decision from taking one off a card.
export async function libraryDeletePOST(request: Request): Promise<Response> {
  const parsed = parseManualIds(await readJson(request))
  if (!parsed.ok) return errorResponse(400, 'INVALID_BODY', parsed.error)

  const kept = await listKeptBy(parsed.value)
  await deleteManualsByIds(parsed.value)

  // What the delete took off which cards, so a screen showing them can say so
  // rather than quietly refreshing.
  return Response.json({ deleted: parsed.value.length, tools: kept })
}

// POST /api/tools/:id/manuals/attach — documents the catalog already has.
export async function attachPOST(request: Request, context: RouteContext): Promise<Response> {
  const toolId = parseId(context.params.id)
  if (toolId === null) return notFound()
  if (!(await getTool(toolId))) return notFound()

  const parsed = parseManualIds(await readJson(request))
  if (!parsed.ok) return errorResponse(400, 'INVALID_BODY', parsed.error)

  const attached = await attachManualsTo(toolId, parsed.value, context.user?.id ?? 0)

  return Response.json({ attached, manuals: await listManuals(toolId) }, { status: 201 })
}

export async function detailPATCH(request: Request, context: RouteContext): Promise<Response> {
  const toolId = parseId(context.params.id)
  const manualId = parseId(context.params.manualId)
  if (toolId === null || manualId === null) return notFound()

  const parsed = parseManualTitle(await readJson(request))
  if (!parsed.ok) return errorResponse(400, 'INVALID_BODY', parsed.error)

  const manual = await renameManual(toolId, manualId, parsed.value)
  if (!manual) return notFound()

  return Response.json({ manual })
}

export async function detailDELETE(_request: Request, context: RouteContext): Promise<Response> {
  const toolId = parseId(context.params.id)
  const manualId = parseId(context.params.manualId)
  if (toolId === null || manualId === null) return notFound()

  if (!(await unlinkManual(toolId, manualId))) return notFound()

  return Response.json({ ok: true })
}

// The bytes. By the manual's own id rather than through a card, because the
// same document belongs to several and none of them owns it.
export async function fileGET(_request: Request, context: RouteContext): Promise<Response> {
  const manualId = parseId(context.params.id)
  if (manualId === null) return notFound()

  const manual = await getManualById(manualId)
  if (!manual) return notFound()

  const bytes = await readManualBytes(manual.storageKey)
  if (!bytes) return notFound()

  return new Response(bytes, {
    headers: {
      // Named for the person saving it, and shown rather than downloaded: a
      // manual is something to read on the spot.
      'cache-control': 'private, max-age=31536000, immutable',
      'content-disposition': contentDisposition(manual.title),
      'content-length': String(bytes.byteLength),
      'content-type': 'application/pdf',
    },
  })
}

// A manual refused for a reason the caller can act on, carrying the status
// that reason deserves. One class rather than four, because the mapping from
// "what was wrong" to "what to answer" belongs in one place.
export class ManualRejectedError extends Error {
  readonly code: ErrorCode
  readonly status: number

  constructor(message: string, status: number, code: ErrorCode) {
    super(message)
    this.name = 'ManualRejectedError'
    this.status = status
    this.code = code
  }
}

// Fetching a document from an address and putting it on a card. Exported
// because importing a whole card walks a page's manuals the same way: a PDF
// arriving from a URL is fetched, checked and refused on exactly the same
// terms whichever screen asked for it.
export async function saveManualFromUrl(
  toolId: number,
  url: string,
  title: string,
  source: ManualSource,
  actorId: number,
): Promise<Manual> {
  let file: { bytes: Uint8Array; sourceUrl: string }
  try {
    file = await fetchRemoteFile(url, { accept: 'application/pdf', limit: MAX_MANUAL_BYTES })
  } catch (error) {
    // The other side did not answer. The request itself was fine, which is why
    // this is not a 400.
    if (error instanceof ImageFetchError)
      throw new ManualRejectedError(error.message, 422, 'DOWNLOAD_FAILED')
    throw error
  }

  return saveManualBytesFor(
    toolId,
    file.bytes,
    { source, sourceUrl: file.sourceUrl, title: title || titleFromFileName(url) },
    actorId,
  )
}

export async function saveManualBytesFor(
  toolId: number,
  bytes: Uint8Array,
  about: { source: ManualSource; sourceUrl?: string; title: string },
  actorId: number,
): Promise<Manual> {
  if (bytes.byteLength === 0) throw new ManualRejectedError(t('Pusty plik'), 400, 'INVALID_BODY')
  if (bytes.byteLength > MAX_MANUAL_BYTES) {
    throw new ManualRejectedError(
      t('Plik jest większy niż {mb} MB', { mb: Math.round(MAX_MANUAL_BYTES / 1024 / 1024) }),
      413,
      'BODY_TOO_LARGE',
    )
  }
  // The header said PDF; the bytes decide. A page answering with an error page
  // under a `.pdf` address is the common one this catches.
  if (!isPdf(bytes)) throw new ManualRejectedError(t('Ten plik nie jest PDF-em'), 415, 'NOT_A_PDF')

  const stored = await saveManualBytes(bytes)
  const manual = await insertManual(
    {
      source: about.source,
      sourceUrl: about.sourceUrl,
      stored,
      title: about.title || 'Instrukcja',
    },
    actorId,
  )

  try {
    await linkManual(toolId, manual.id, actorId)
  } catch (error) {
    if (error instanceof ManualAlreadyOnCardError) {
      throw new ManualRejectedError(error.message, 409, 'MANUAL_ALREADY_ON_CARD')
    }
    throw error
  }

  return manual
}

// The same work as an answer rather than as an exception: a route hands back a
// Response, while the importer collects failures beside its successes.
async function listKeptBy(manualIds: number[]): Promise<{ id: number; name: string }[]> {
  const page = await listAllManuals({ limit: manualIds.length, offset: 0, search: null })
  const wanted = new Set(manualIds)

  const byId = new Map<number, { id: number; name: string }>()
  for (const manual of page.items) {
    if (!wanted.has(manual.id)) continue
    for (const tool of manual.tools) byId.set(tool.id, tool)
  }

  return [...byId.values()]
}

async function answering(work: () => Promise<Manual>): Promise<Response> {
  try {
    return Response.json({ manual: await work() }, { status: 201 })
  } catch (error) {
    if (error instanceof ManualRejectedError) {
      return errorResponse(error.status, error.code, error.message)
    }
    throw error
  }
}

// A title is what a person reads; a file name is what their computer saves.
//
// Two of them, because a header is bytes: the plain one is ASCII so that any
// client can read it, and `filename*` carries the real title for the ones that
// can. Without the first, "Instrukcja obsługi" is a header nothing can encode;
// without the second, a Polish title arrives at the person's disk with the
// letters knocked out of it.
export function contentDisposition(title: string): string {
  const written = title.trim() || 'instrukcja'
  const ascii = written
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/["\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  const plain = `${ascii || 'instrukcja'}.pdf`
  const encoded = encodeURIComponent(`${written}.pdf`)

  return `inline; filename="${plain}"; filename*=UTF-8''${encoded}`
}

function parseId(value: string | undefined): null | number {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function notFound(): Response {
  return errorResponse(404, 'MANUAL_NOT_FOUND', 'Not found')
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}
