// The tool catalog: GET/POST /api/tools, GET/PATCH/DELETE /api/tools/:id,
// GET /api/tools/categories, and the parameters under a card —
// POST/PATCH/DELETE /api/tools/:id/attributes.
//
// Reading needs catalog.read, writing needs catalog.write, and both are checked by
// the guard before any of this runs (src/access/route-policy.ts). Nothing here
// re-checks a role; a handler that decided access for itself would be a second
// answer to a question the policy already answers.

import type { RouteContext } from '../route-context'
import { placementsFor } from './organizers-store'
import {
  copyPhotoLinks,
  dropOrphanedPhotos,
  photoIdsOf,
  photoUrl,
  primaryPhotoIds,
} from './photos-store'
import {
  parseAttributeCreate,
  parseAttributePatch,
  parseToolCreate,
  parseToolPatch,
  parseToolQuery,
} from './tools-input'
import {
  addAttribute,
  AttributeNameTakenError,
  createTool,
  deleteAttribute,
  deleteTool,
  duplicateTool,
  getTool,
  getToolDetail,
  listAttributeNames,
  listAttributes,
  listCategories,
  listTools,
  SerialNumberTakenError,
  updateAttribute,
  updateTool,
} from './tools-store'

export async function GET(request: Request): Promise<Response> {
  const query = parseToolQuery(new URL(request.url).searchParams)
  if (!query.ok) return Response.json({ error: query.error }, { status: 400 })

  const page = await listTools(query.value)

  // The main photo of every tool on the page, in one query. The grid shows
  // thumbnails, and asking per card would be twenty-four requests for one
  // screen.
  const ids = page.items.map((tool) => tool.id)
  const primary = await primaryPhotoIds('tool', ids)
  // Where each one lies. Two queries for a whole page rather than two per card.
  const placements = await placementsFor(ids)

  return Response.json(
    {
      ...page,
      items: page.items.map((tool) => ({
        ...tool,
        organizer: placements.get(tool.id) ?? null,
        primaryPhotoUrl: primary.has(tool.id) ? photoUrl(primary.get(tool.id)!) : null,
      })),
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const parsed = parseToolCreate(await readJson(request))
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  try {
    const tool = await createTool(parsed.value, actorId(context))

    // A new card has no parameters yet; saying so is better than leaving the
    // client to guess whether the field is missing or empty.
    return Response.json({ tool: { ...tool, attributes: [] } }, { status: 201 })
  } catch (error) {
    if (error instanceof SerialNumberTakenError) {
      return Response.json({ error: error.message }, { status: 409 })
    }
    throw error
  }
}

export async function categoriesGET(): Promise<Response> {
  return Response.json(
    { categories: await listCategories() },
    { headers: { 'cache-control': 'no-store' } },
  )
}

export async function detailGET(_request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  if (id === null) return notFound()

  const tool = await getToolDetail(id)
  if (!tool) return notFound()

  return Response.json({ tool }, { headers: { 'cache-control': 'no-store' } })
}

// GET /api/tools/attributes — the parameter names already in use.
//
// What the form offers while somebody types one, read from the tools
// themselves for the same reason the category list is: the names in use are
// the vocabulary, and "napięcie sieciowe" typed the same way on every card is
// what makes the catalog answerable later.
export async function attributeNamesGET(): Promise<Response> {
  return Response.json(
    { names: await listAttributeNames() },
    { headers: { 'cache-control': 'no-store' } },
  )
}

// The parameters under a card: mains voltage, speed, chuck, weight. Each one
// answers with the whole tool rather than the row that changed, the same way a
// case answers with itself when a label slot is added — a screen showing the
// list does not then have to merge one row into a list it already holds.
export async function attributePOST(request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  if (id === null) return notFound()
  if (!(await getTool(id))) return notFound()

  const parsed = parseAttributeCreate(await readJson(request))
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  try {
    await addAttribute(id, parsed.value, actorId(context))
  } catch (error) {
    if (error instanceof AttributeNameTakenError) {
      return Response.json({ error: error.message }, { status: 409 })
    }
    throw error
  }

  return Response.json({ tool: await getToolDetail(id) }, { status: 201 })
}

export async function attributePATCH(request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  const attributeId = parseId(context.params.attributeId)
  if (id === null || attributeId === null) return notFound()

  const parsed = parseAttributePatch(await readJson(request))
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  try {
    // Null here is a parameter that is not this tool's, which is the same
    // answer as one that never existed.
    if (!(await updateAttribute(id, attributeId, parsed.value))) return notFound()
  } catch (error) {
    if (error instanceof AttributeNameTakenError) {
      return Response.json({ error: error.message }, { status: 409 })
    }
    throw error
  }

  return Response.json({ tool: await getToolDetail(id) })
}

export async function attributeDELETE(_request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  const attributeId = parseId(context.params.attributeId)
  if (id === null || attributeId === null) return notFound()

  if (!(await deleteAttribute(id, attributeId))) return notFound()

  return Response.json({ tool: await getToolDetail(id) })
}

export async function detailPATCH(request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  if (id === null) return notFound()

  const parsed = parseToolPatch(await readJson(request))
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  try {
    const tool = await updateTool(id, parsed.value, actorId(context))
    if (!tool) return notFound()

    return Response.json({ tool: { ...tool, attributes: await listAttributes(id) } })
  } catch (error) {
    if (error instanceof SerialNumberTakenError) {
      return Response.json({ error: error.message }, { status: 409 })
    }
    throw error
  }
}

// POST /api/tools/:id/duplicate — another card just like this one.
//
// Everything is copied except the serial number, which identifies one physical
// machine: the copy starts blank there, so the person filling it in is the one
// who read the plate. The photos come along as links to the same pictures —
// two of the same model look the same, and a link costs a row rather than a
// file.
export async function duplicatePOST(_request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  if (id === null) return notFound()

  const actor = actorId(context)
  const copy = await duplicateTool(id, actor)
  if (!copy) return notFound()

  await copyPhotoLinks({ id, kind: 'tool' }, { id: copy.id, kind: 'tool' }, actor)

  return Response.json({ tool: copy }, { status: 201 })
}

export async function detailDELETE(_request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  if (id === null) return notFound()

  // Read before the delete: once the tool is gone its links have cascaded away
  // and there is nothing left to say which pictures were its.
  const photoIds = await photoIdsOf({ id, kind: 'tool' })

  const deleted = await deleteTool(id)
  // Deleting a card that is already gone is the outcome the caller wanted, but
  // it is still worth saying which of the two happened: two people clearing
  // the same row from two phones should not both be told they did it.
  if (!deleted) return notFound()

  // The pictures no other card shows go with it. One that another card still
  // uses stays, which is the whole point of the links.
  await dropOrphanedPhotos(photoIds)

  return Response.json({ ok: true })
}

// The guard has already refused an anonymous caller on every write route, so
// the user is present here. The fallback is only so the types stay honest
// without a non-null assertion.
function actorId(context: RouteContext): number {
  if (!context.user) throw new Error('tools write reached without an authenticated user')
  return context.user.id
}

// Ids are bigint columns; anything else in the path is a tool that does not
// exist rather than a bad request. Answering 400 would tell a client to fix a
// URL it was given by a link.
function parseId(value: string | undefined): null | number {
  if (!value || !/^\d+$/.test(value)) return null

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function notFound(): Response {
  return Response.json({ error: 'Tool not found' }, { status: 404 })
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}
