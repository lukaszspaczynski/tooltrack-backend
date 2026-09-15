// Places: GET/POST /api/addresses and GET/PATCH/DELETE /api/addresses/:id.
//
// Assigning one is not here. An item is at one place and an arrangement is at
// one place, so it is `addressId` on each of those — a field on the thing that
// moved, edited by the PATCH that already edits it. An endpoint per pairing
// would be two more routes saying what one column already says.

import { errorResponse } from '../error-codes'
import { t } from '../i18n'
import type { RouteContext } from '../route-context'
import {
  AddressNameTakenError,
  createAddress,
  deleteAddress,
  getAddress,
  listAddresses,
  updateAddress,
} from './addresses-store'
import { parseAddressCreate, parseAddressPatch, parseAddressQuery } from './addresses-input'

export async function GET(request: Request): Promise<Response> {
  const query = parseAddressQuery(new URL(request.url).searchParams)
  if (!query.ok) return errorResponse(400, 'INVALID_QUERY', query.error)

  return Response.json(await listAddresses(query.value), {
    headers: { 'cache-control': 'no-store' },
  })
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const parsed = parseAddressCreate(await readJson(request))
  if (!parsed.ok) return errorResponse(400, 'INVALID_BODY', parsed.error)

  try {
    return Response.json(
      { address: await createAddress(parsed.value, actorId(context)) },
      {
        status: 201,
      },
    )
  } catch (error) {
    return writeError(error)
  }
}

export async function detailGET(_request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  if (id === null) return notFound()

  const address = await getAddress(id)
  if (!address) return notFound()

  return Response.json({ address }, { headers: { 'cache-control': 'no-store' } })
}

export async function detailPATCH(request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  if (id === null) return notFound()

  const parsed = parseAddressPatch(await readJson(request))
  if (!parsed.ok) return errorResponse(400, 'INVALID_BODY', parsed.error)

  try {
    const address = await updateAddress(id, parsed.value, actorId(context))
    if (!address) return notFound()

    return Response.json({ address })
  } catch (error) {
    return writeError(error)
  }
}

// The items and arrangements that were here stay in the catalog and stop
// pointing at anything — the foreign key sets the column to null. Closing a
// site is a normal thing to do and must not take the kit with it.
//
// How many that is comes back in `cleared`, because it is what the screen has
// to say before somebody agrees: "delete" on a list of places reads as tidying
// up, and forty cards quietly losing their location does not.
export async function detailDELETE(_request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  if (id === null) return notFound()

  const address = await getAddress(id)
  if (!address) return notFound()

  if (!(await deleteAddress(id))) return notFound()

  return Response.json({
    cleared: { organizers: address.organizerCount, items: address.itemCount },
    ok: true,
  })
}

function writeError(error: unknown): Response {
  if (error instanceof AddressNameTakenError) {
    return errorResponse(409, error.code, error.message)
  }
  throw error
}

function actorId(context: RouteContext): number {
  if (!context.user) throw new Error('address write reached without an authenticated user')
  return context.user.id
}

function parseId(value: string | undefined): null | number {
  if (!value || !/^\d+$/.test(value)) return null

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function notFound(): Response {
  return errorResponse(404, 'ADDRESS_NOT_FOUND', t('Nie ma takiego adresu'))
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}
