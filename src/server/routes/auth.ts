// POST /api/auth/register, POST /api/auth/login, POST /api/auth/logout,
// GET /api/auth/me, PATCH /api/auth/password.
//
// These are the only routes reachable without a session (see
// src/access/route-policy.ts): they are how a caller gets one, or finds out
// what it already has.

import { capabilitiesFor, effectiveRole, type User } from '../../access/roles'
import type { SessionResponse } from './responses'
import { errorResponse } from '../error-codes'
import {
  parseLoginInput,
  parseLanguageInput,
  parseTokenInput,
  parsePasswordChangeInput,
  parseRegisterInput,
} from './auth-input'
import { t } from '../i18n'
import { forgetFailedLogins, loginAttemptAllowed, recordFailedLogin } from '../login-throttle'
import type { RouteContext } from '../route-context'
import type { LoginAttempt } from '../login-throttle'
import {
  authenticateRequest,
  clearedSessionCookie,
  createUser,
  EmailTakenError,
  findCredentialsByEmail,
  findCredentialsById,
  issueSession,
  listSessions,
  revokeSession,
  revokeSessionById,
  setLanguage,
  setPassword,
  verifyPassword,
} from './auth-store'

export async function register(request: Request): Promise<Response> {
  const parsed = parseRegisterInput(await readJson(request))
  if (!parsed.ok) return errorResponse(400, 'INVALID_BODY', parsed.error)

  try {
    // Always a viewer. Registration is self-service, so it must not be able to
    // hand out anything an admin has to grant; createUser does not take a role.
    const user = await createUser(parsed.value)
    const session = await issueSession(user.id)

    return sessionResponse(session.user, session.cookie, 201)
  } catch (error) {
    if (error instanceof EmailTakenError) {
      return errorResponse(409, error.code, error.message)
    }
    throw error
  }
}

export async function login(request: Request, context: RouteContext): Promise<Response> {
  const parsed = parseLoginInput(await readJson(request))
  if (!parsed.ok) return errorResponse(400, 'INVALID_BODY', parsed.error)

  // Counted before anything is looked up, and keyed on what was *submitted*
  // rather than on what exists. An address nobody has an account for has to be
  // throttled exactly like one that does, or the difference between the two
  // answers is a way to find out which e-mails are registered here — the same
  // leak the single 401 below exists to close.
  //
  // A body that does not parse is not counted: it cannot be a guess at a
  // password, and counting it would let a flood of junk lock out a colleague.
  const attempt = { address: context.clientAddress, email: parsed.value.email }
  const refusal = throttled(attempt)
  if (refusal) return refusal

  const credentials = await findCredentialsByEmail(parsed.value.email)

  // One answer for "no such account", "wrong password" and "disabled", so that
  // the login form cannot be used to find out which addresses have an account
  // here.
  if (
    !credentials ||
    credentials.status === 'disabled' ||
    !(await verifyPassword(parsed.value.password, credentials))
  ) {
    recordFailedLogin(attempt)
    return errorResponse(401, 'INVALID_CREDENTIALS', t('Nieprawidłowy e-mail lub hasło'))
  }

  // A database failure is deliberately not caught and turned into a 401. A
  // saturated pool is not a wrong password, and the central mapper in
  // pg-error-response.ts answers a retryable 503 instead of sending someone to
  // reset a password that was always correct.
  const session = await issueSession(Number(credentials.id))

  forgetFailedLogins(attempt)

  return sessionResponse(session.user, session.cookie, 200)
}

// POST /api/auth/token — the same door as login, for a client that has no
// cookie jar worth relying on.
//
// It answers with the token itself and sets no cookie. That split is the point:
// a token in a response body is a token any script on a page can read, which is
// exactly what HttpOnly exists to prevent — so the web client keeps using
// /api/auth/login and never sees one, and a native client, where there is no
// page and no script, asks here.
//
// Everything else is the same session: one row in account.session, one hash,
// one expiry, and revoking, disabling an account or changing a password reach
// it without knowing there are two ways in.
export async function token(request: Request, context: RouteContext): Promise<Response> {
  const parsed = parseTokenInput(await readJson(request))
  if (!parsed.ok) return errorResponse(400, 'INVALID_BODY', parsed.error)

  // The same counter as login, deliberately shared. A throttle that guarded one
  // of two doors into the same house would be a throttle somebody walks around
  // by knocking on the other.
  const attempt = { address: context.clientAddress, email: parsed.value.email }
  const refusal = throttled(attempt)
  if (refusal) return refusal

  const credentials = await findCredentialsByEmail(parsed.value.email)

  if (
    !credentials ||
    credentials.status === 'disabled' ||
    !(await verifyPassword(parsed.value.password, credentials))
  ) {
    recordFailedLogin(attempt)
    return errorResponse(401, 'INVALID_CREDENTIALS', t('Nieprawidłowy e-mail lub hasło'))
  }

  const session = await issueSession(Number(credentials.id), parsed.value.device)

  forgetFailedLogins(attempt)

  return Response.json({
    capabilities: capabilitiesFor(session.user),
    expiresAt: session.expiresAt,
    token: session.token,
    user: session.user,
  })
}

// GET /api/auth/sessions — where this account is signed in.
//
// Its own account only, always: the user id comes from the guard rather than
// from anything the caller sent, so there is no id to tamper with.
export async function sessions(request: Request, context: RouteContext): Promise<Response> {
  if (!context.user) return errorResponse(401, 'UNAUTHENTICATED', 'Unauthorized')

  return Response.json({ sessions: await listSessions(request, context.user.id) })
}

// DELETE /api/auth/sessions/:id — sign a lost phone out.
//
// Scoped by user in the SQL as well as here. Revoking the session making the
// request is allowed and works: the answer goes out, and the next call with
// that token is a 401 — which is logging out the long way round, and is what a
// list with the current row on it should let somebody do.
export async function revokeSessionRoute(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  if (!context.user) return errorResponse(401, 'UNAUTHENTICATED', 'Unauthorized')

  const id = Number(context.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return errorResponse(404, 'SESSION_NOT_FOUND', t('Nie ma takiej sesji'))
  }

  // The same answer for "not yours" as for "not there", so the ids of other
  // people's sessions cannot be found by trying them.
  if (!(await revokeSessionById(context.user.id, id))) {
    return errorResponse(404, 'SESSION_NOT_FOUND', t('Nie ma takiej sesji'))
  }

  return new Response(null, { status: 204 })
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
  const body: SessionResponse = {
    capabilities: capabilitiesFor(user),
    effectiveRole: effectiveRole(user),
    user,
  }

  return Response.json(body)
}

export async function changePassword(request: Request): Promise<Response> {
  const user = await authenticateRequest(request)
  if (!user) return errorResponse(401, 'UNAUTHENTICATED', 'Unauthorized')

  const parsed = parsePasswordChangeInput(await readJson(request))
  if (!parsed.ok) return errorResponse(400, 'INVALID_BODY', parsed.error)

  const credentials = await findCredentialsById(user.id)
  if (!credentials || !(await verifyPassword(parsed.value.currentPassword, credentials))) {
    return errorResponse(403, 'INVALID_CREDENTIALS', t('Obecne hasło jest nieprawidłowe'))
  }

  // setPassword revokes every session, this one included, so the answer clears
  // the cookie rather than leaving the caller holding a dead one.
  await setPassword(user.id, parsed.value.newPassword)

  return Response.json(
    { ok: true, reauthenticationRequired: true },
    { headers: { 'set-cookie': clearedSessionCookie() } },
  )
}

// PATCH /api/auth/language — which language this account reads in.
//
// It answers with the same shape as /api/auth/me rather than `{ ok: true }`,
// because the client has just been handed a new version of the user it is
// showing and would otherwise have to ask for it again.
export async function changeLanguage(request: Request): Promise<Response> {
  const user = await authenticateRequest(request)
  if (!user) return errorResponse(401, 'UNAUTHENTICATED', 'Unauthorized')

  const parsed = parseLanguageInput(await readJson(request))
  if (!parsed.ok) return errorResponse(400, 'INVALID_BODY', parsed.error)

  const updated = await setLanguage(user.id, parsed.value)

  return Response.json({
    capabilities: capabilitiesFor(updated),
    effectiveRole: effectiveRole(updated),
    user: updated,
  })
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

// The 429 both doors answer with, written once. `Retry-After` is in seconds
// because that is what the header means; the sentence rounds to minutes
// because that is what a person waits in.
function throttled(attempt: LoginAttempt): null | Response {
  const decision = loginAttemptAllowed(attempt)
  if (decision.allowed) return null

  return errorResponse(
    429,
    'TOO_MANY_ATTEMPTS',
    t('Za dużo nieudanych prób logowania. Spróbuj ponownie za {minutes} min.', {
      minutes: Math.ceil(decision.retryAfterSeconds / 60),
    }),
    { headers: { 'retry-after': String(decision.retryAfterSeconds) } },
  )
}
