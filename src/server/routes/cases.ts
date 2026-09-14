// The cases: GET/POST /api/cases, GET/PATCH/DELETE /api/cases/:id and
// GET /api/cases/systems.
//
// Reading needs catalog.read, writing needs catalog.write, and both are
// checked by the guard before any of this runs (src/access/route-policy.ts).
// Nothing here re-checks a role; a handler that decided access for itself
// would be a second answer to a question the policy already answers.
//
// Photos of a case are not here: they are the same routes as a tool's, under
// /api/cases/:id/photos, served by routes/photos.ts.

import { parseCaseCreate, parseCasePatch, parseCaseQuery, parseLabelSlot } from './cases-input'
import { errorResponse } from '../error-codes'
import {
  addLabelSlot,
  createCase,
  deleteCase,
  getCase,
  LabelSlotTakenError,
  listCases,
  listSystems,
  removeLabelSlot,
  type CaseListPage,
  updateCase,
} from './cases-store'
import {
  addAttribute,
  AttributeNameTakenError,
  deleteAttribute,
  deleteAttributesOf,
  listAttributeNames,
  updateAttribute,
} from './attributes-store'
import { parseOwnerId } from './photo-owner'
import { parseAttributeCreate, parseAttributePatch } from './tools-input'
import { dropOrphanedPhotos, photoIdsOf, photoUrl, primaryPhotoIds } from './photos-store'
import type { RouteContext } from '../route-context'

export async function GET(request: Request): Promise<Response> {
  const query = parseCaseQuery(new URL(request.url).searchParams)
  if (!query.ok) return errorResponse(400, 'INVALID_QUERY', query.error)

  const page = await listCases(query.value)

  // The main photo of every case on the page, in one query. The grid shows
  // thumbnails, and asking per card would be a request per row.
  const primary = await primaryPhotoIds(
    'case',
    page.items.map((item) => item.id),
  )

  // Annotated rather than inferred: this is the shape the contract promises,
  // and the compiler is what keeps the promise once the schema is generated
  // from the type rather than from what this happens to return today.
  const body: CaseListPage = {
    ...page,
    items: page.items.map((item) => ({
      ...item,
      primaryPhotoUrl: primary.has(item.id) ? photoUrl(primary.get(item.id)!) : null,
    })),
  }

  return Response.json(body, { headers: { 'cache-control': 'no-store' } })
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const parsed = parseCaseCreate(await readJson(request))
  if (!parsed.ok) return errorResponse(400, 'INVALID_BODY', parsed.error)

  const created = await createCase(parsed.value, actorId(context))

  return Response.json({ case: created }, { status: 201 })
}

export async function systemsGET(): Promise<Response> {
  return Response.json(
    { systems: await listSystems() },
    { headers: { 'cache-control': 'no-store' } },
  )
}

export async function detailGET(_request: Request, context: RouteContext): Promise<Response> {
  const id = parseOwnerId(context.params.id)
  if (id === null) return notFound()

  const found = await getCase(id)
  if (!found) return notFound()

  return Response.json({ case: found }, { headers: { 'cache-control': 'no-store' } })
}

export async function detailPATCH(request: Request, context: RouteContext): Promise<Response> {
  const id = parseOwnerId(context.params.id)
  if (id === null) return notFound()

  const parsed = parseCasePatch(await readJson(request))
  if (!parsed.ok) return errorResponse(400, 'INVALID_BODY', parsed.error)

  const updated = await updateCase(id, parsed.value, actorId(context))
  if (!updated) return notFound()

  return Response.json({ case: updated })
}

export async function detailDELETE(_request: Request, context: RouteContext): Promise<Response> {
  const id = parseOwnerId(context.params.id)
  if (id === null) return notFound()

  // Read before the delete: once the case is gone its links have cascaded away
  // and there is nothing left to say which pictures were its.
  const photoIds = await photoIdsOf({ id, kind: 'case' })

  const deleted = await deleteCase(id)
  if (!deleted) return notFound()

  // The pictures no other card shows go with it. One that a tool inside the
  // case also uses stays, which is the whole point of the links.
  await dropOrphanedPhotos(photoIds)
  // No cascade does this: the attribute table's pair is not a foreign key,
  // because one column cannot point at two tables.
  await deleteAttributesOf('tool_case', id)

  return Response.json({ ok: true })
}

// POST /api/cases/:id/label-slots — one more place a label goes.
export async function labelSlotPOST(request: Request, context: RouteContext): Promise<Response> {
  const id = parseOwnerId(context.params.id)
  if (id === null) return notFound()

  const parsed = parseLabelSlot(await readJson(request))
  if (!parsed.ok) return errorResponse(400, 'INVALID_BODY', parsed.error)

  // Checked before the insert so a missing case is a 404 about the case rather
  // than a foreign key violation about a column nobody asked about.
  if (!(await getCase(id))) return notFound()

  try {
    await addLabelSlot(id, parsed.value.widthMm, parsed.value.heightMm, actorId(context))
  } catch (error) {
    if (error instanceof LabelSlotTakenError) {
      return errorResponse(409, error.code, error.message)
    }
    throw error
  }

  // The whole case comes back: the screen shows the slots together and would
  // otherwise have to merge one into a list it already holds.
  return Response.json({ case: await getCase(id) }, { status: 201 })
}

export async function labelSlotDELETE(_request: Request, context: RouteContext): Promise<Response> {
  const id = parseOwnerId(context.params.id)
  const slotId = parseOwnerId(context.params.slotId)
  if (id === null || slotId === null) return notFound()

  const removed = await removeLabelSlot(id, slotId)
  if (!removed) {
    return errorResponse(404, 'LABEL_SLOT_NOT_FOUND', 'Ta skrzynka nie ma takiego miejsca')
  }

  return Response.json({ case: await getCase(id) })
}

// The guard has already refused an anonymous caller on every write route, so
// the user is present here. The fallback is only so the types stay honest
// without a non-null assertion.
function actorId(context: RouteContext): number {
  if (!context.user) throw new Error('cases write reached without an authenticated user')
  return context.user.id
}

function notFound(): Response {
  return errorResponse(404, 'CASE_NOT_FOUND', 'Nie ma takiej skrzynki')
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}

// The parameters under a case, on exactly the terms a tool's are: a name and a
// value, both free text, unique per case. The columns hold what every box has —
// a length is a length — and this holds what they do not: a stacking system, a
// lid type, whatever the next kind of box turns out to state.
//
// Each answers with the whole case rather than the row that changed, the same
// way the label slots do: a screen showing the sheet would otherwise have to
// merge one row into a list it already holds.
export async function attributePOST(request: Request, context: RouteContext): Promise<Response> {
  const id = parseOwnerId(context.params.id)
  if (id === null || !(await getCase(id))) return notFound()

  const parsed = parseAttributeCreate(await readJson(request))
  if (!parsed.ok) return errorResponse(400, 'INVALID_BODY', parsed.error)

  try {
    await addAttribute('tool_case', id, parsed.value, actorId(context))
  } catch (error) {
    if (error instanceof AttributeNameTakenError) {
      return errorResponse(409, error.code, error.message)
    }
    throw error
  }

  return Response.json({ case: await getCase(id) }, { status: 201 })
}

export async function attributePATCH(request: Request, context: RouteContext): Promise<Response> {
  const id = parseOwnerId(context.params.id)
  const attributeId = parseOwnerId(context.params.attributeId)
  if (id === null || attributeId === null) return notFound()

  const parsed = parseAttributePatch(await readJson(request))
  if (!parsed.ok) return errorResponse(400, 'INVALID_BODY', parsed.error)

  try {
    // Null is a parameter that is not this case's, which is the same answer as
    // one that never existed.
    if (!(await updateAttribute('tool_case', id, attributeId, parsed.value))) return notFound()
  } catch (error) {
    if (error instanceof AttributeNameTakenError) {
      return errorResponse(409, error.code, error.message)
    }
    throw error
  }

  return Response.json({ case: await getCase(id) })
}

export async function attributeDELETE(_request: Request, context: RouteContext): Promise<Response> {
  const id = parseOwnerId(context.params.id)
  const attributeId = parseOwnerId(context.params.attributeId)
  if (id === null || attributeId === null) return notFound()

  if (!(await deleteAttribute('tool_case', id, attributeId))) return notFound()

  return Response.json({ case: await getCase(id) })
}

// What the form offers while somebody types a parameter name on a case. Asked
// per kind, because a box and a drill have nothing in common on a spec sheet.
export async function attributeNamesGET(): Promise<Response> {
  return Response.json(
    { names: await listAttributeNames('tool_case') },
    { headers: { 'cache-control': 'no-store' } },
  )
}
