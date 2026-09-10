// POST /api/auth/register, POST /api/auth/login, POST /api/auth/logout,
// GET /api/auth/me, PATCH /api/auth/password.
//
// These are the only routes reachable without a session (see
// src/access/route-policy.ts): they are how a caller gets one, or finds out
// what it already has.

import { capabilitiesFor, effectiveRole, type User } from '../../access/roles'
import { parseLoginInput, parsePasswordChangeInput, parseRegisterInput } from './auth-input'
import {
  authenticateRequest,
  clearedSessionCookie,
  createUser,
  EmailTakenError,
  findCredentialsByEmail,
  findCredentialsById,
  issueSession,
  revokeSession,
  setPassword,
  verifyPassword,
} from './auth-store'

export async function register(request: Request): Promise<Response> {
  const parsed = parseRegisterInput(await readJson(request))
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  try {
    // Always a viewer. Registration is self-service, so it must not be able to
    // hand out anything an admin has to grant; createUser does not take a role.
    const user = await createUser(parsed.value)
    const session = await issueSession(user.id)

    return sessionResponse(session.user, session.cookie, 201)
  } catch (error) {
    if (error instanceof EmailTakenError) {
      return Response.json({ error: error.message }, { status: 409 })
    }
    throw error
  }
}

export async function login(request: Request): Promise<Response> {
  const parsed = parseLoginInput(await readJson(request))
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  const credentials = await findCredentialsByEmail(parsed.value.email)

  // One answer for "no such account", "wrong password" and "disabled", so that
  // the login form cannot be used to find out which addresses have an account
  // here.
  if (
    !credentials ||
    credentials.status === 'disabled' ||
    !(await verifyPassword(parsed.value.password, credentials))
  ) {
    return Response.json({ error: 'Invalid email or password' }, { status: 401 })
  }

  // A database failure is deliberately not caught and turned into a 401. A
  // saturated pool is not a wrong password, and the central mapper in
  // pg-error-response.ts answers a retryable 503 instead of sending someone to
  // reset a password that was always correct.
  const session = await issueSession(Number(credentials.id))

  return sessionResponse(session.user, session.cookie, 200)
}

export async function logout(request: Request): Promise<Response> {
  await revokeSession(request)

  // Idempotent on purpose: logging out without a session, or with one that has
  // already expired, is a success. The cookie is cleared either way.
  return Response.json({ ok: true }, { headers: { 'set-cookie': clearedSessionCookie() } })
}

export async function me(request: Request): Promise<Response> {
  const user = await authenticateRequest(request)
  if (!user) return Response.json({ user: null }, { status: 401 })

  // The client renders its menu from `capabilities`, never by comparing role
  // strings of its own. That keeps one definition of what a role can do, here
  // and in the guard, and a UI that hides a button the API would refuse.
  return Response.json({
    capabilities: capabilitiesFor(user),
    effectiveRole: effectiveRole(user),
    user,
  })
}

export async function changePassword(request: Request): Promise<Response> {
  const user = await authenticateRequest(request)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = parsePasswordChangeInput(await readJson(request))
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  const credentials = await findCredentialsById(user.id)
  if (!credentials || !(await verifyPassword(parsed.value.currentPassword, credentials))) {
    return Response.json({ error: 'Current password is incorrect' }, { status: 403 })
  }

  // setPassword revokes every session, this one included, so the answer clears
  // the cookie rather than leaving the caller holding a dead one.
  await setPassword(user.id, parsed.value.newPassword)

  return Response.json(
    { ok: true, reauthenticationRequired: true },
    { headers: { 'set-cookie': clearedSessionCookie() } },
  )
}

function sessionResponse(user: User, cookie: string, status: number): Response {
  return Response.json(
    { capabilities: capabilitiesFor(user), user },
    { headers: { 'set-cookie': cookie }, status },
  )
}

// A malformed body is the caller's mistake, not a 500. Every parser here
// already refuses anything that is not the object it expects, so undefined is
// enough to produce the right 400.
async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}
