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
  parsePasswordChangeInput,
  parseRegisterInput,
} from './auth-input'
import { t } from '../i18n'
import { forgetFailedLogins, loginAttemptAllowed, recordFailedLogin } from '../login-throttle'
import type { RouteContext } from '../route-context'
import {
  authenticateRequest,
  clearedSessionCookie,
  createUser,
  EmailTakenError,
  findCredentialsByEmail,
  findCredentialsById,
  issueSession,
  revokeSession,
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
  const throttle = loginAttemptAllowed(attempt)

  if (!throttle.allowed) {
    return errorResponse(
      429,
      'TOO_MANY_ATTEMPTS',
      t('Za dużo nieudanych prób logowania. Spróbuj ponownie za {minutes} min.', {
        minutes: Math.ceil(throttle.retryAfterSeconds / 60),
      }),
      { headers: { 'retry-after': String(throttle.retryAfterSeconds) } },
    )
  }

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
