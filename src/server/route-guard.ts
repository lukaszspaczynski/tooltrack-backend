// The single enforcement point for the whole API, called from the dispatch in
// index.ts before any handler runs.
//
// It resolves the session once and hands the user to the handler, so a route
// never authenticates a second time and never disagrees with the guard about
// who is calling.

import { routeRequirement, satisfiesRequirement } from '../access/route-policy'
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
    return { ok: false, response: Response.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  const user = await authenticateRequest(request)

  if (satisfiesRequirement(user, requirement)) return { ok: true, user }

  // 401 and 403 are different answers to different questions, and the client
  // acts on them differently: one sends you to the login screen, the other
  // tells you this account will never be allowed and asks an admin.
  if (!user)
    return { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) }

  if (user.status === 'disabled') {
    return {
      ok: false,
      response: Response.json({ error: 'This account is disabled' }, { status: 403 }),
    }
  }

  return { ok: false, response: Response.json({ error: 'Forbidden' }, { status: 403 }) }
}
