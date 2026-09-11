// Producers: GET/POST /api/brands, GET/PATCH/DELETE /api/brands/:id and the
// logo, which is a picture from the library pointed at rather than uploaded
// here.
//
//   PUT    /api/brands/:id/logo   catalog.write   { photoId }
//   DELETE /api/brands/:id/logo   catalog.write

import { parseBrandCreate, parseBrandPatch, parseBrandQuery, parseLogo } from './brands-input'
import {
  BrandNameTakenError,
  clearLogo,
  createBrand,
  deleteBrand,
  getBrand,
  listBrands,
  LogoTakenError,
  PhotoNotFoundError,
  setLogo,
  updateBrand,
} from './brands-store'
import type { RouteContext } from '../route-context'

export async function GET(request: Request): Promise<Response> {
  const query = parseBrandQuery(new URL(request.url).searchParams)
  if (!query.ok) return Response.json({ error: query.error }, { status: 400 })

  return Response.json(await listBrands(query.value), { headers: { 'cache-control': 'no-store' } })
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const parsed = parseBrandCreate(await readJson(request))
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  try {
    const brand = await createBrand(parsed.value, actorId(context))

    return Response.json({ brand }, { status: 201 })
  } catch (error) {
    return writeError(error)
  }
}

export async function detailGET(_request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  if (id === null) return notFound()

  const brand = await getBrand(id)
  if (!brand) return notFound()

  return Response.json({ brand }, { headers: { 'cache-control': 'no-store' } })
}

export async function detailPATCH(request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  if (id === null) return notFound()

  const parsed = parseBrandPatch(await readJson(request))
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  try {
    const brand = await updateBrand(id, parsed.value, actorId(context))
    if (!brand) return notFound()

    return Response.json({ brand })
  } catch (error) {
    return writeError(error)
  }
}

export async function detailDELETE(_request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  if (id === null) return notFound()

  // The tools keep the maker's name as text and simply stop pointing at a row.
  // Deleting the grouping is not a claim about who made them.
  const deleted = await deleteBrand(id)
  if (!deleted) return notFound()

  return Response.json({ ok: true })
}

export async function logoPUT(request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  if (id === null) return notFound()

  const parsed = parseLogo(await readJson(request))
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  try {
    const brand = await setLogo(id, parsed.value, actorId(context))
    if (!brand) return notFound()

    return Response.json({ brand })
  } catch (error) {
    return writeError(error)
  }
}

export async function logoDELETE(_request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  if (id === null) return notFound()

  const brand = await clearLogo(id)
  if (!brand) return notFound()

  return Response.json({ brand })
}

// A taken name and a picture already used as another logo are conflicts the
// person can act on; a picture that does not exist is a 404 about the picture.
function writeError(error: unknown): Response {
  if (error instanceof BrandNameTakenError || error instanceof LogoTakenError) {
    return Response.json({ error: error.message }, { status: 409 })
  }
  if (error instanceof PhotoNotFoundError) {
    return Response.json({ error: error.message }, { status: 404 })
  }
  throw error
}

function actorId(context: RouteContext): number {
  if (!context.user) throw new Error('brand write reached without an authenticated user')
  return context.user.id
}

function parseId(value: string | undefined): null | number {
  if (!value || !/^\d+$/.test(value)) return null

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function notFound(): Response {
  return Response.json({ error: 'Nie ma takiej marki' }, { status: 404 })
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}
