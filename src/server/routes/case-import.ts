// Making a case out of a maker's product page.
//
//   GET  /api/cases/import/sources  catalog.read
//   POST /api/cases/import          catalog.write
//   POST /api/cases/:id/import      catalog.write
//
// The same three routes an item has, for the same reasons, with one difference
// that is not cosmetic: a case has no parameters and no documents, so what
// comes with it is the photographs and nothing else.
//
// The address decides which script reads the page (src/server/importers), and
// an address from a site this server has never been taught to read is refused
// rather than guessed at. Nothing here knows anything about any maker: the
// reading is pure and lives next to the site it is about.

import { caseImporterFor, CASE_IMPORT_SOURCES, fitCaseToCard } from '../importers'
import type { ImportedCase } from '../importers'
import { errorResponse } from '../error-codes'
import { t } from '../i18n'
import type { RouteContext } from '../route-context'
import { replaceAttributes } from './attributes-store'
import { createCase, getCase, updateCase } from './cases-store'
import { fetchPage } from './page-fetch'
import { importPhotoLinks } from './photos'
import { parseImportInput } from './items-input'

// A gallery of a box runs to a dozen shots of the same lid. Each one is
// fetched, decoded and stored, so the ceiling is what keeps an import from
// being a minute of somebody watching a spinner.
const MAX_IMPORT_PHOTOS = 20

export async function sourcesGET(): Promise<Response> {
  return Response.json(
    { sources: CASE_IMPORT_SOURCES },
    { headers: { 'cache-control': 'no-store' } },
  )
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const read = await readPage(request)
  if ('response' in read) return read.response

  const imported = fitCaseToCard(read.imported)
  const actorId = context.user?.id ?? 0

  const created = await createCase(
    {
      capacityL: imported.capacityL,
      diagonalMm: imported.diagonalMm,
      ean: imported.ean,
      innerHeightMm: imported.innerHeightMm,
      innerLengthMm: imported.innerLengthMm,
      innerWidthMm: imported.innerWidthMm,
      loadKg: imported.loadKg,
      manufacturer: imported.manufacturer,
      name: imported.name,
      notes: imported.notes,
      referenceUrl: imported.sourceUrl,
      outerHeightMm: imported.outerHeightMm,
      outerLengthMm: imported.outerLengthMm,
      outerWidthMm: imported.outerWidthMm,
      sku: imported.sku,
      system: imported.system,
    },
    actorId,
  )

  await replaceAttributes('tool_case', created.id, imported.attributes, actorId)

  const photos = await hangPhotos(created.id, imported, actorId)

  return Response.json(
    { case: await getCase(created.id), imported: { ...photos, sourceUrl: imported.sourceUrl } },
    { status: 201 },
  )
}

// POST /api/cases/:id/import — reading the page again into a case that exists.
//
// What the page knows, it overwrites: the maker, the name, the system, the
// numbers, the note. What it cannot know, it leaves alone — the label slots
// somebody measured for this box, and the photographs, which somebody may well
// have taken themselves.
//
// The slots are the reason this is not a delete and a re-create. A slot is
// where a sticker goes on a particular box in a particular van, and no product
// page has an opinion about that.
export async function refreshPOST(request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  if (id === null || !(await getCase(id))) {
    return errorResponse(404, 'CASE_NOT_FOUND', t('Nie ma takiej skrzynki'))
  }

  const read = await readPage(request)
  if ('response' in read) return read.response

  const imported = fitCaseToCard(read.imported)

  const updated = await updateCase(
    id,
    {
      capacityL: imported.capacityL,
      diagonalMm: imported.diagonalMm,
      ean: imported.ean,
      innerHeightMm: imported.innerHeightMm,
      innerLengthMm: imported.innerLengthMm,
      innerWidthMm: imported.innerWidthMm,
      loadKg: imported.loadKg,
      manufacturer: imported.manufacturer,
      name: imported.name,
      notes: imported.notes,
      referenceUrl: imported.sourceUrl,
      outerHeightMm: imported.outerHeightMm,
      outerLengthMm: imported.outerLengthMm,
      outerWidthMm: imported.outerWidthMm,
      sku: imported.sku,
      system: imported.system,
    },
    context.user?.id ?? 0,
  )

  if (!updated) return errorResponse(404, 'CASE_NOT_FOUND', t('Nie ma takiej skrzynki'))

  // Cleared and written again, the same as an item's sheet: the page is the
  // source of truth for what the box is, so a row the maker has dropped should
  // leave the case too. That is the opposite of what the seeder does, and
  // deliberately — a seeder run months later has no business deleting a line
  // somebody typed, while this ran because somebody pressed a button meaning
  // "what does the page say now".
  await replaceAttributes('tool_case', id, imported.attributes, context.user?.id ?? 0)

  return Response.json({
    case: await getCase(id),
    imported: {
      // Deliberately untouched, and saying so beats a screen wondering whether
      // they were quietly replaced.
      photos: 0,
      photosFailed: 0,
      sourceUrl: imported.sourceUrl,
    },
  })
}

// The half both routes share: the body, the importer, the fetch and the parse.
// Every refusal on the way is one the caller can act on.
async function readPage(
  request: Request,
): Promise<{ imported: ImportedCase } | { response: Response }> {
  const parsed = parseImportInput(await readJson(request))
  if (!parsed.ok) return { response: errorResponse(400, 'INVALID_BODY', parsed.error) }

  const importer = caseImporterFor(parsed.value.url)
  if (!importer) {
    return {
      response: errorResponse(
        400,
        'UNSUPPORTED_SOURCE',
        t('Nie umiem czytać tej strony. Obsługiwane źródła: {sources}', {
          sources: CASE_IMPORT_SOURCES.map((source) => source.label).join(', '),
        }),
      ),
    }
  }

  let html: string
  try {
    html = await fetchPage(parsed.value.url)
  } catch {
    // The site did not answer, or answered with something that is not a page.
    // The request itself was fine, which is why this is not a 400.
    return {
      response: errorResponse(422, 'PAGE_UNREACHABLE', t('Nie udało się pobrać strony produktu')),
    }
  }

  const imported = importer.parse(html, parsed.value.url)
  if (!imported) {
    return {
      response: errorResponse(
        422,
        'NOT_A_PRODUCT_PAGE',
        t('Pod tym adresem nie ma karty produktu'),
      ),
    }
  }

  return { imported }
}

async function hangPhotos(
  caseId: number,
  imported: ImportedCase,
  actorId: number,
): Promise<{ photos: number; photosFailed: number }> {
  const result = await importPhotoLinks(
    { id: caseId, kind: 'case' },
    imported.photoUrls.slice(0, MAX_IMPORT_PHOTOS).map((url) => ({
      attribution: new URL(imported.sourceUrl).hostname,
      fromSearch: false,
      url,
    })),
    actorId,
  )

  return { photos: result.photos.length, photosFailed: result.failed.length }
}

function parseId(value: string | undefined): null | number {
  if (!value || !/^\d+$/.test(value)) return null

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}
