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

import {
  parseOrganizerCreate,
  parseOrganizerPatch,
  parseOrganizerQuery,
  parseToolIds,
} from './organizers-input'
import {
  addTools,
  CaseNotFoundError,
  createOrganizer,
  deleteOrganizer,
  getOrganizer,
  listOrganizers,
  NumberTakenError,
  removeTool,
  ToolAlreadyInOrganizerError,
  updateOrganizer,
} from './organizers-store'
import type { RouteContext } from '../route-context'

export async function GET(request: Request): Promise<Response> {
  const query = parseOrganizerQuery(new URL(request.url).searchParams)
  if (!query.ok) return Response.json({ error: query.error }, { status: 400 })

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
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  let toolIds: number[] = []
  if (isObject(body) && 'toolIds' in body) {
    const tools = parseToolIds(body)
    if (!tools.ok) return Response.json({ error: tools.error }, { status: 400 })
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
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

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
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

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
    return Response.json({ error: 'Tego narzędzia nie ma w tym organizerze' }, { status: 404 })
  }

  return Response.json({ ok: true })
}

// A taken number and a tool that is already somewhere else are both conflicts
// the person can act on; a case that does not exist is a 404 about the case.
function writeError(error: unknown): Response {
  if (error instanceof NumberTakenError || error instanceof ToolAlreadyInOrganizerError) {
    return Response.json({ error: error.message }, { status: 409 })
  }
  if (error instanceof CaseNotFoundError) {
    return Response.json({ error: error.message }, { status: 404 })
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
  return Response.json({ error: 'Nie ma takiego organizera' }, { status: 404 })
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
