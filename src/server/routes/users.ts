// Admin user management: GET /api/users, PATCH/DELETE /api/users/:id.
//
// Every route here needs users.manage, which only `admin` holds. The rules
// below are not about that — they are the two ways an admin with the right
// capability can still break the installation, and both are refused:
//
//   1. Changing your own role or status. An admin who demotes themselves needs
//      another admin to undo it, and on a small site there may not be one.
//   2. Removing the last active admin. After that nobody can grant the role
//      back, and the only way in is TOOLTRACK_BOOTSTRAP_ADMIN_EMAILS or SQL.

import { capabilitiesFor, type UserWithCapabilities } from '../../access/roles'
import { errorResponse } from '../error-codes'
import type { RouteContext } from '../route-context'
import { countAdmins, deleteUser, findUserById, listUsers, updateUser } from './auth-store'
import { parseUserPatch } from './users-input'

export async function GET(): Promise<Response> {
  const users = await listUsers()

  // The capability list travels with each row so the admin screen can show
  // what a role actually means without repeating the table client side.
  const rows: UserWithCapabilities[] = users.map((user) => ({
    ...user,
    capabilities: capabilitiesFor(user),
  }))

  return Response.json({ users: rows }, { headers: { 'cache-control': 'no-store' } })
}

export async function detailPATCH(request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  if (id === null) return notFound()

  const parsed = parseUserPatch(await readJson(request))
  if (!parsed.ok) return errorResponse(400, 'INVALID_BODY', parsed.error)

  const target = await findUserById(id)
  if (!target) return notFound()

  const self = context.user?.id === id
  if (self && (parsed.value.role !== undefined || parsed.value.status !== undefined)) {
    return errorResponse(
      403,
      'SELF_ROLE_CHANGE',
      'You cannot change your own role or status. Ask another admin.',
    )
  }

  const losesAdmin =
    target.role === 'admin' &&
    target.status === 'active' &&
    ((parsed.value.role !== undefined && parsed.value.role !== 'admin') ||
      parsed.value.status === 'disabled')

  if (losesAdmin && (await countAdmins()) <= 1) {
    return errorResponse(409, 'LAST_ACTIVE_ADMIN', 'This is the last active admin')
  }

  const user = await updateUser(id, parsed.value)
  if (!user) return notFound()

  const row: UserWithCapabilities = { ...user, capabilities: capabilitiesFor(user) }

  return Response.json({ user: row })
}

export async function detailDELETE(_request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  if (id === null) return notFound()

  if (context.user?.id === id) {
    return errorResponse(403, 'SELF_ROLE_CHANGE', 'You cannot delete your own account')
  }

  const target = await findUserById(id)
  if (!target) return notFound()

  if (target.role === 'admin' && target.status === 'active' && (await countAdmins()) <= 1) {
    return errorResponse(409, 'LAST_ACTIVE_ADMIN', 'This is the last active admin')
  }

  // The tool cards they created stay, with created_by set to null (see
  // catalog-schema.ts). Losing the catalog because someone left is not an
  // outcome anyone would ask for.
  await deleteUser(id)

  return Response.json({ ok: true })
}

function parseId(value: string | undefined): null | number {
  if (!value || !/^\d+$/.test(value)) return null

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function notFound(): Response {
  return errorResponse(404, 'USER_NOT_FOUND', 'User not found')
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}
