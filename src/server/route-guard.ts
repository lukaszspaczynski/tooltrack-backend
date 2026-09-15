// The single enforcement point for the whole API, called from the dispatch in
// index.ts before any handler runs.
//
// It resolves the session once and hands the user to the handler, so a route
// never authenticates a second time and never disagrees with the guard about
// who is calling.

import { routeRequirement, satisfiesRequirement } from '../access/route-policy'
import { belowFloor, CLIENT_HEADER } from './client-version'
import { errorResponse } from './error-codes'
import { t } from './i18n'
import type { User } from '../access/roles'
import { authenticateRequest } from './routes/auth-store'

export type GuardResult = { ok: false; response: Response } | { ok: true; user: null | User }

export async function enforceRoutePolicy(request: Request): Promise<GuardResult> {
  const { pathname } = new URL(request.url)
  const requirement = routeRequirement(pathname, request.method)

  if (requirement.check.kind === 'deny') {
    // A path the router knows but the policy does not classify. Refused in
    // every environment, including development: a rule that only exists in
    // production is a rule nobody tests.
    console.warn(`[route-guard] unclassified route ${request.method} ${pathname}`)
    return { ok: false, response: errorResponse(403, 'FORBIDDEN', 'Forbidden') }
  }

  // Before authenticating, and before anything else this request wants.
  //
  // A client too old to be answered should be told that rather than sent to a
  // login screen it will come back from and fail anyway — and the answer needs
  // no session to be correct, since the version is in the request.
  //
  // The `public` family is exempt: /healthz, /api/version and the contract are
  // how somebody finds out what is going on, and refusing those would make an
  // old build harder to diagnose without making it any safer.
  if (requirement.domain !== 'public') {
    const stale = belowFloor(request.headers.get(CLIENT_HEADER))

    if (stale) {
      return {
        ok: false,
        response: errorResponse(
          426,
          'CLIENT_TOO_OLD',
          t('Ta wersja aplikacji jest za stara. Zaktualizuj ją, żeby korzystać dalej.'),
          { extra: { client: `${stale.name}/${stale.version}`, minimum: stale.minimum } },
        ),
      }
    }
  }

  const user = await authenticateRequest(request)

  if (satisfiesRequirement(user, requirement)) return { ok: true, user }

  // 401 and 403 are different answers to different questions, and the client
  // acts on them differently: one sends you to the login screen, the other
  // tells you this account will never be allowed and asks an admin.
  if (!user) return { ok: false, response: errorResponse(401, 'UNAUTHENTICATED', 'Unauthorized') }

  if (user.status === 'disabled') {
    return {
      ok: false,
      response: errorResponse(403, 'ACCOUNT_DISABLED', 'This account is disabled'),
    }
  }

  return { ok: false, response: errorResponse(403, 'FORBIDDEN', 'Forbidden') }
}
