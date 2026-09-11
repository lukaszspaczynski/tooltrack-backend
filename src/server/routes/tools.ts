// The tool catalog: GET/POST /api/tools, GET/PATCH/DELETE /api/tools/:id and
// GET /api/tools/categories.
//
// Reading needs catalog.read, writing needs catalog.write, and both are checked by
// the guard before any of this runs (src/access/route-policy.ts). Nothing here
// re-checks a role; a handler that decided access for itself would be a second
// answer to a question the policy already answers.

import type { RouteContext } from '../route-context'
import { dropOrphanedPhotos, photoIdsOf, photoUrl, primaryPhotoIds } from './photos-store'
import { parseToolCreate, parseToolPatch, parseToolQuery } from './tools-input'
import {
  createTool,
  deleteTool,
  getTool,
  listCategories,
  listTools,
  SerialNumberTakenError,
  updateTool,
} from './tools-store'

export async function GET(request: Request): Promise<Response> {
  const query = parseToolQuery(new URL(request.url).searchParams)
  if (!query.ok) return Response.json({ error: query.error }, { status: 400 })

  const page = await listTools(query.value)

  // The main photo of every tool on the page, in one query. The grid shows
  // thumbnails, and asking per card would be twenty-four requests for one
  // screen.
  const primary = await primaryPhotoIds(
    'tool',
    page.items.map((tool) => tool.id),
  )

  return Response.json(
    {
      ...page,
      items: page.items.map((tool) => ({
        ...tool,
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

    return Response.json({ tool }, { status: 201 })
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

  const tool = await getTool(id)
  if (!tool) return notFound()

  return Response.json({ tool }, { headers: { 'cache-control': 'no-store' } })
}

export async function detailPATCH(request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  if (id === null) return notFound()

  const parsed = parseToolPatch(await readJson(request))
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  try {
    const tool = await updateTool(id, parsed.value, actorId(context))
    if (!tool) return notFound()

    return Response.json({ tool })
  } catch (error) {
    if (error instanceof SerialNumberTakenError) {
      return Response.json({ error: error.message }, { status: 409 })
    }
    throw error
  }
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
