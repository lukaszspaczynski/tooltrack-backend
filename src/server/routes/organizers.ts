// The organizer: which tools live in which case.
//
//   GET    /api/organizers              catalog.read
//   POST   /api/organizers              catalog.write
//   GET    /api/organizers/:id          catalog.read
//   PATCH  /api/organizers/:id          catalog.write
//   DELETE /api/organizers/:id          catalog.write
//   POST   /api/organizers/:id/tools    catalog.write
//   DELETE /api/organizers/:id/tools/:toolId  catalog.write
//
// Reading needs catalog.read, writing needs catalog.write, and both are
// checked by the guard before any of this runs.

import { generateLabel, LabelDataError, type LabelOptions } from '../labels/generate'
import { errorResponse } from '../error-codes'
import { maxContentsPhotos } from '../labels/contents-label'
import { deleteLabelPdf, readLabelFile, saveLabelPdf } from '../labels/storage'
import { redrawLabels, storeLabelPreview } from './label-redraw'
import { labelsToRedraw } from './labels-store'
import {
  parseLabelIds,
  parseLabelRequest,
  parseOrganizerCreate,
  parseOrganizerPatch,
  parseOrganizerQuery,
  parseToolIds,
} from './organizers-input'
import {
  addTools,
  AddressNotFoundError,
  CaseNotFoundError,
  createOrganizer,
  deleteLabel,
  deleteOrganizer,
  getLabelFile,
  getOrganizer,
  insertLabel,
  labelSlotsFor,
  listOrganizers,
  NumberTakenError,
  removeTool,
  ToolAlreadyInOrganizerError,
  updateOrganizer,
} from './organizers-store'
import type { RouteContext } from '../route-context'
import { t } from '../i18n'

export async function GET(request: Request): Promise<Response> {
  const query = parseOrganizerQuery(new URL(request.url).searchParams)
  if (!query.ok) return errorResponse(400, 'INVALID_QUERY', query.error)

  return Response.json(await listOrganizers(query.value), {
    headers: { 'cache-control': 'no-store' },
  })
}

// The wizard's last step: a case, a name, and the tools that were ticked. One
// request, so a half-made organizer cannot exist because somebody closed the
// tab between two of them.
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const body = await readJson(request)
  const parsed = parseOrganizerCreate(body)
  if (!parsed.ok) return errorResponse(400, 'INVALID_BODY', parsed.error)

  let toolIds: number[] = []
  if (isObject(body) && 'toolIds' in body) {
    const tools = parseToolIds(body)
    if (!tools.ok) return errorResponse(400, 'INVALID_BODY', tools.error)
    toolIds = tools.value
  }

  try {
    const organizer = await createOrganizer(parsed.value, toolIds, actorId(context))

    return Response.json({ organizer }, { status: 201 })
  } catch (error) {
    return writeError(error)
  }
}

export async function detailGET(_request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  if (id === null) return notFound()

  const organizer = await getOrganizer(id)
  if (!organizer) return notFound()

  return Response.json({ organizer }, { headers: { 'cache-control': 'no-store' } })
}

export async function detailPATCH(request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  if (id === null) return notFound()

  const parsed = parseOrganizerPatch(await readJson(request))
  if (!parsed.ok) return errorResponse(400, 'INVALID_BODY', parsed.error)

  try {
    const organizer = await updateOrganizer(id, parsed.value, actorId(context))
    if (!organizer) return notFound()

    return Response.json({ organizer })
  } catch (error) {
    return writeError(error)
  }
}

export async function detailDELETE(_request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  if (id === null) return notFound()

  // The tools stay; only the arrangement goes. Nothing here touches a tool
  // card, which is the point of keeping the link in its own table.
  const deleted = await deleteOrganizer(id)
  if (!deleted) return notFound()

  return Response.json({ ok: true })
}

export async function toolsPOST(request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  if (id === null) return notFound()

  const parsed = parseToolIds(await readJson(request))
  if (!parsed.ok) return errorResponse(400, 'INVALID_BODY', parsed.error)

  try {
    const organizer = await addTools(id, parsed.value, actorId(context))
    if (!organizer) return notFound()

    return Response.json({ organizer })
  } catch (error) {
    return writeError(error)
  }
}

export async function toolDELETE(_request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  const toolId = parseId(context.params.toolId)
  if (id === null || toolId === null) return notFound()

  const removed = await removeTool(id, toolId)
  if (!removed) {
    return errorResponse(404, 'TOOL_NOT_IN_ORGANIZER', t('Tego narzędzia nie ma w tym organizerze'))
  }

  return Response.json({ ok: true })
}

// GET /api/organizers/:id/label-slots — what the wizard's first step offers:
// the sizes this organizer's case has places for.
export async function labelSlotsGET(_request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  if (id === null) return notFound()

  if (!(await getOrganizer(id))) return notFound()

  return Response.json(
    { slots: await labelSlotsFor(id) },
    { headers: { 'cache-control': 'no-store' } },
  )
}

// POST /api/organizers/:id/labels — draw one and keep it.
//
// The PDF is written first and the row second: a row pointing at a file that
// was never written is a broken label, while a file nobody points at is a
// wasted byte the delete path already knows how to find.
export async function labelPOST(request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  if (id === null) return notFound()

  const parsed = parseLabelRequest(await readJson(request))
  if (!parsed.ok) return errorResponse(400, 'INVALID_BODY', parsed.error)

  if (!(await getOrganizer(id))) return notFound()

  // The size comes from the case's own list of places, never from the request:
  // a label printed at a size the box has no place for is a label nobody can
  // stick anywhere.
  const slot = (await labelSlotsFor(id)).find((entry) => entry.id === parsed.value.slotId)
  if (!slot) {
    return errorResponse(
      400,
      'LABEL_SLOT_NOT_FOUND',
      t('Skrzynka tego organizera nie ma takiego miejsca na etykietę'),
    )
  }

  // How many pictures fit is a fact about the shape, so it can only be checked
  // once the slot is known. Refused rather than truncated: a label quietly
  // missing the sixth picture is one somebody prints before noticing.
  const photoIds = parsed.value.options.photoIds
  if (Array.isArray(photoIds)) {
    const allowed = maxContentsPhotos(slot)
    if (photoIds.length > allowed) {
      return Response.json(
        {
          error: t('Etykieta {width} × {height} mm mieści {allowed} zdjęcia', {
            allowed,
            height: slot.heightMm,
            width: slot.widthMm,
          }),
        },
        { status: 400 },
      )
    }
  }

  try {
    const bytes = await generateLabel(
      id,
      { heightMm: slot.heightMm, widthMm: slot.widthMm },
      parsed.value.options as unknown as LabelOptions,
    )
    const stored = await saveLabelPdf(bytes)

    await insertLabel(
      {
        byteSize: stored.byteSize,
        heightMm: slot.heightMm,
        options: parsed.value.options,
        organizerId: id,
        pdfPath: stored.path,
        previewPath: await storeLabelPreview(stored.path, bytes),
        slotId: slot.id,
        template: parsed.value.template,
        widthMm: slot.widthMm,
      },
      actorId(context),
    )

    return Response.json({ organizer: await getOrganizer(id) }, { status: 201 })
  } catch (error) {
    if (error instanceof LabelDataError) {
      return errorResponse(400, error.code, error.message)
    }
    throw error
  }
}

// POST /api/organizers/:id/labels/refresh — draw the chosen labels again from
// the options they were made with.
//
// Scoped to this organizer: a label id from another one is not found here
// rather than redrawn, which is what makes the URL mean what it says. The
// drawing itself is `label-redraw.ts`, shared with the screen that selects
// across organizers.
export async function labelRefreshPOST(request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  if (id === null) return notFound()

  const parsed = parseLabelIds(await readJson(request))
  if (!parsed.ok) return errorResponse(400, 'INVALID_BODY', parsed.error)

  if (!(await getOrganizer(id))) return notFound()

  const labels = await labelsToRedraw(parsed.value, id)
  if (labels.length === 0) return labelNotFound()

  const { failed, refreshed } = await redrawLabels(labels)

  return Response.json({ failed, organizer: await getOrganizer(id), refreshed })
}

export async function labelFileGET(_request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  const labelId = parseId(context.params.labelId)
  if (id === null || labelId === null) return labelNotFound()

  const label = await getLabelFile(id, labelId)
  if (!label?.path) return labelNotFound()

  const bytes = await readLabelFile(label.path)
  // A row whose file is missing is a broken label, not a broken server.
  if (!bytes) return labelNotFound()

  return new Response(bytes, {
    headers: {
      'cache-control': 'private, max-age=31536000, immutable',
      'content-disposition': `inline; filename="etykieta-${labelId}.pdf"`,
      'content-length': String(bytes.byteLength),
      'content-type': 'application/pdf',
    },
  })
}

// The same file the list points at, served as a picture. Immutable like the
// PDF: both are named after the checksum of what they show, so a label that
// changes is a different URL.
export async function labelPreviewGET(_request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  const labelId = parseId(context.params.labelId)
  if (id === null || labelId === null) return labelNotFound()

  const label = await getLabelFile(id, labelId)
  if (!label?.previewPath) return labelNotFound()

  const bytes = await readLabelFile(label.previewPath)
  if (!bytes) return labelNotFound()

  return new Response(bytes, {
    headers: {
      'cache-control': 'private, max-age=31536000, immutable',
      'content-length': String(bytes.byteLength),
      'content-type': 'image/png',
    },
  })
}

export async function labelDELETE(_request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  const labelId = parseId(context.params.labelId)
  if (id === null || labelId === null) return labelNotFound()

  const removed = await deleteLabel(id, labelId)
  if (!removed) return labelNotFound()

  // Outside the transaction: a failed unlink must not roll back a row that is
  // already gone.
  if (removed.orphanedPath) await deleteLabelPdf(removed.orphanedPath)

  return Response.json({ organizer: await getOrganizer(id) })
}

function labelNotFound(): Response {
  return errorResponse(404, 'ORGANIZER_NOT_FOUND', 'Nie ma takiej etykiety')
}

// A taken number and a tool that is already somewhere else are both conflicts
// the person can act on; a case that does not exist is a 404 about the case.
function writeError(error: unknown): Response {
  if (error instanceof NumberTakenError || error instanceof ToolAlreadyInOrganizerError) {
    return errorResponse(409, error.code, error.message)
  }
  if (error instanceof AddressNotFoundError || error instanceof CaseNotFoundError) {
    return errorResponse(404, error.code, error.message)
  }
  throw error
}

function actorId(context: RouteContext): number {
  if (!context.user) throw new Error('organizer write reached without an authenticated user')
  return context.user.id
}

function parseId(value: string | undefined): null | number {
  if (!value || !/^\d+$/.test(value)) return null

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function notFound(): Response {
  return errorResponse(404, 'ORGANIZER_NOT_FOUND', 'Nie ma takiego organizera')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}
