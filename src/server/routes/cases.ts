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

import { parseCaseCreate, parseCasePatch, parseCaseQuery } from './cases-input'
import { createCase, deleteCase, getCase, listCases, listSystems, updateCase } from './cases-store'
import { parseOwnerId } from './photo-owner'
import { photoUrl, primaryPhotoIds } from './photos-store'
import type { RouteContext } from '../route-context'

export async function GET(request: Request): Promise<Response> {
  const query = parseCaseQuery(new URL(request.url).searchParams)
  if (!query.ok) return Response.json({ error: query.error }, { status: 400 })

  const page = await listCases(query.value)

  // The main photo of every case on the page, in one query. The grid shows
  // thumbnails, and asking per card would be a request per row.
  const primary = await primaryPhotoIds(
    'case',
    page.items.map((item) => item.id),
  )

  return Response.json(
    {
      ...page,
      items: page.items.map((item) => ({
        ...item,
        primaryPhotoUrl: primary.has(item.id) ? photoUrl(primary.get(item.id)!) : null,
      })),
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const parsed = parseCaseCreate(await readJson(request))
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

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
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  const updated = await updateCase(id, parsed.value, actorId(context))
  if (!updated) return notFound()

  return Response.json({ case: updated })
}

export async function detailDELETE(_request: Request, context: RouteContext): Promise<Response> {
  const id = parseOwnerId(context.params.id)
  if (id === null) return notFound()

  // The photos go with it: the foreign key cascades, which is the whole reason
  // a photo points at a case with a real column rather than a loose id.
  const deleted = await deleteCase(id)
  if (!deleted) return notFound()

  return Response.json({ ok: true })
}

// The guard has already refused an anonymous caller on every write route, so
// the user is present here. The fallback is only so the types stay honest
// without a non-null assertion.
function actorId(context: RouteContext): number {
  if (!context.user) throw new Error('cases write reached without an authenticated user')
  return context.user.id
}

function notFound(): Response {
  return Response.json({ error: 'Nie ma takiej skrzynki' }, { status: 404 })
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}
