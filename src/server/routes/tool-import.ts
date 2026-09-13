// Making a card out of a shop's product page.
//
//   GET  /api/tools/import/sources  catalog.read
//   POST /api/tools/import          catalog.write
//
// The address decides which script reads the page (src/server/importers), and
// an address from a shop this server has never been taught to read is refused
// rather than guessed at. Nothing else here knows anything about any shop: the
// reading is pure and lives next to the shop it is about, this module fetches,
// writes the card and hangs the pictures on it.

import { fitToCard, IMPORT_SOURCES, importerFor, type ImportedProduct } from '../importers'
import { t } from '../i18n'
import type { RouteContext } from '../route-context'
import { importPhotoLinks } from './photos'
import { parseImportInput } from './tools-input'
import { addAttribute, createTool, getToolDetail } from './tools-store'

// A product page is text; a shop that answers with a hundred megabytes of
// something else is a shop that is not answering.
const MAX_PAGE_BYTES = 4_000_000
const PAGE_TIMEOUT_MS = 20_000

// A gallery can run to twenty-odd shots of the same drill. Each one is
// fetched, decoded and stored, so the ceiling is what keeps an import from
// being a minute of somebody watching a spinner.
const MAX_IMPORT_PHOTOS = 20

export async function sourcesGET(): Promise<Response> {
  return Response.json({ sources: IMPORT_SOURCES }, { headers: { 'cache-control': 'no-store' } })
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const parsed = parseImportInput(await readJson(request))
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  const importer = importerFor(parsed.value.url)
  if (!importer) {
    return Response.json(
      {
        error: t('Nie umiem czytać tej strony. Obsługiwane źródła: {sources}', {
          sources: IMPORT_SOURCES.map((source) => source.label).join(', '),
        }),
      },
      { status: 400 },
    )
  }

  let html: string
  try {
    html = await fetchPage(parsed.value.url)
  } catch {
    // The shop did not answer, or answered with something that is not a page.
    // The request itself was fine, which is why this is not a 400.
    return Response.json({ error: t('Nie udało się pobrać strony produktu') }, { status: 422 })
  }

  const product = importer.parse(html, parsed.value.url)
  if (!product) {
    return Response.json({ error: t('Pod tym adresem nie ma karty produktu') }, { status: 422 })
  }

  return createCard(fitToCard(product), context.user?.id ?? 0)
}

// The card, then its parameters, then its pictures — in that order, because
// each needs the one before it. A parameter or a photograph that fails does
// not fail the import: the card is the thing somebody asked for, and what
// could not be read is reported beside it rather than instead of it.
async function createCard(product: ImportedProduct, actorId: number): Promise<Response> {
  const tool = await createTool(
    {
      brand: product.brand,
      category: product.category,
      condition: 'new',
      model: product.model,
      name: product.name,
      notes: product.notes,
      // Deliberately blank. A serial number is one physical machine, and the
      // page describes a model somebody is about to own.
      serialNumber: '',
    },
    actorId,
  )

  const failed: string[] = []

  for (const attribute of product.attributes) {
    try {
      await addAttribute(tool.id, attribute, actorId)
    } catch {
      // The page listed the same parameter twice in a way the merge did not
      // catch, or something else the card refuses. One line is not worth the
      // import.
      failed.push(attribute.name)
    }
  }

  const photos = await importPhotoLinks(
    { id: tool.id, kind: 'tool' },
    product.photoUrls.slice(0, MAX_IMPORT_PHOTOS).map((url) => ({
      attribution: new URL(product.sourceUrl).hostname,
      fromSearch: false,
      url,
    })),
    actorId,
  )

  return Response.json(
    {
      imported: {
        attributes: product.attributes.length - failed.length,
        attributesFailed: failed,
        photos: photos.photos.length,
        photosFailed: photos.failed.length,
        sourceUrl: product.sourceUrl,
      },
      tool: await getToolDetail(tool.id),
    },
    { status: 201 },
  )
}

// The page, as text, with both ends of the rope tied: a timeout, so a shop
// that never answers does not hold the request open, and a ceiling, so one
// that answers forever does not fill the process.
async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      // Shops answer a bare fetch with a challenge page; saying who this is
      // gets the product card, which is what was asked for.
      'user-agent': 'ToolTrack/0.1 (+catalog importer)',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
  })

  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > MAX_PAGE_BYTES) throw new Error('page too large')

  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_PAGE_BYTES) throw new Error('page too large')

  return new TextDecoder('utf-8').decode(bytes)
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}
