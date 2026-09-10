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

import { capabilitiesFor } from '../../access/roles'
import type { RouteContext } from '../route-context'
import { countAdmins, deleteUser, findUserById, listUsers, updateUser } from './auth-store'
import { parseUserPatch } from './users-input'

export async function GET(): Promise<Response> {
  const users = await listUsers()

  return Response.json(
    {
      // The capability list travels with each row so the admin screen can show
      // what a role actually means without repeating the table client side.
      users: users.map((user) => ({ ...user, capabilities: capabilitiesFor(user) })),
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}

export async function detailPATCH(request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  if (id === null) return notFound()

  const parsed = parseUserPatch(await readJson(request))
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  const target = await findUserById(id)
  if (!target) return notFound()

  const self = context.user?.id === id
  if (self && (parsed.value.role !== undefined || parsed.value.status !== undefined)) {
    return Response.json(
      { error: 'You cannot change your own role or status. Ask another admin.' },
      { status: 403 },
    )
  }

  const losesAdmin =
    target.role === 'admin' &&
    target.status === 'active' &&
    ((parsed.value.role !== undefined && parsed.value.role !== 'admin') ||
      parsed.value.status === 'disabled')

  if (losesAdmin && (await countAdmins()) <= 1) {
    return Response.json({ error: 'This is the last active admin' }, { status: 409 })
  }

  const user = await updateUser(id, parsed.value)
  if (!user) return notFound()

  return Response.json({ user: { ...user, capabilities: capabilitiesFor(user) } })
}

export async function detailDELETE(_request: Request, context: RouteContext): Promise<Response> {
  const id = parseId(context.params.id)
  if (id === null) return notFound()

  if (context.user?.id === id) {
    return Response.json({ error: 'You cannot delete your own account' }, { status: 403 })
  }

  const target = await findUserById(id)
  if (!target) return notFound()

  if (target.role === 'admin' && target.status === 'active' && (await countAdmins()) <= 1) {
    return Response.json({ error: 'This is the last active admin' }, { status: 409 })
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
  return Response.json({ error: 'User not found' }, { status: 404 })
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}
