// The one table that says what each API route requires. The guard in
// src/server/route-guard.ts is the only caller, and it runs before any handler,
// so a route cannot be reached without appearing here.
//
// It is deliberately a table and not a decorator on each handler: the question
// "what can a viewer reach?" has to be answerable by reading one file, and a
// new route that nobody classified has to be refused rather than exposed.
// That is what the `deny` outcome is — the default, not an error case.

import { hasCapability, isActiveUser, type Capability, type User } from './roles'

export type RouteDomain = 'auth' | 'public' | 'tools' | 'users'

export type RouteCheck =
  // Reachable without a session. The handler still decides what it answers.
  | { kind: 'allow' }
  // Needs an active account holding the capability.
  | { kind: 'capability'; capability: Capability }
  // Not classified. Refused.
  | { kind: 'deny' }

export type RouteRequirement = {
  check: RouteCheck
  domain: RouteDomain
}

type Rule = {
  domain: RouteDomain
  methods: Partial<Record<Method, RouteCheck>>
  pattern: RegExp
}

type Method = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'

const READ_TOOLS: RouteCheck = { capability: 'tools.read', kind: 'capability' }
const WRITE_TOOLS: RouteCheck = { capability: 'tools.write', kind: 'capability' }
const MANAGE_USERS: RouteCheck = { capability: 'users.manage', kind: 'capability' }
const ALLOW: RouteCheck = { kind: 'allow' }

// Order matters: the first matching pattern decides. `/api/tools/categories`
// sits above `/api/tools/:id` because the id pattern would otherwise swallow
// it and ask for a tool named "categories".
const RULES: readonly Rule[] = [
  {
    domain: 'public',
    methods: { GET: ALLOW },
    pattern: /^\/(?:healthz|api\/version)$/,
  },
  {
    // Registration, login, logout and "who am I" cannot require a capability:
    // they are how a caller finds out whether it has one. Each handler does
    // its own check — /api/auth/me answers 401 without a session, logout is
    // idempotent, and register always creates a viewer.
    domain: 'auth',
    methods: { GET: ALLOW, PATCH: ALLOW, POST: ALLOW },
    pattern: /^\/api\/auth\/(?:register|login|logout|me|password)$/,
  },
  {
    domain: 'tools',
    methods: { GET: READ_TOOLS },
    pattern: /^\/api\/tools\/categories$/,
  },
  {
    domain: 'tools',
    methods: { GET: READ_TOOLS, POST: WRITE_TOOLS },
    pattern: /^\/api\/tools$/,
  },
  {
    domain: 'tools',
    methods: { DELETE: WRITE_TOOLS, GET: READ_TOOLS, PATCH: WRITE_TOOLS },
    pattern: /^\/api\/tools\/[^/]+$/,
  },
  {
    domain: 'users',
    methods: { GET: MANAGE_USERS },
    pattern: /^\/api\/users$/,
  },
  {
    domain: 'users',
    methods: { DELETE: MANAGE_USERS, GET: MANAGE_USERS, PATCH: MANAGE_USERS },
    pattern: /^\/api\/users\/[^/]+$/,
  },
]

export function routeRequirement(pathname: string, method: string): RouteRequirement {
  const normalized = normalizePathname(pathname)
  const rule = RULES.find((candidate) => candidate.pattern.test(normalized))

  if (!rule) return { check: { kind: 'deny' }, domain: domainOf(normalized) }

  // A known path asked with a method it does not implement is not a policy
  // question. It is refused here as `deny`, and index.ts answers 405 for the
  // methods it knows about before the guard is reached.
  const check = rule.methods[method.toUpperCase() as Method] ?? { kind: 'deny' as const }

  return { check, domain: rule.domain }
}

export function satisfiesRequirement(user: null | undefined | User, requirement: RouteRequirement) {
  switch (requirement.check.kind) {
    case 'allow':
      return true
    case 'capability':
      return isActiveUser(user) && hasCapability(user, requirement.check.capability)
    case 'deny':
      return false
  }
}

// Only used to label a refusal in logs, never to decide one.
function domainOf(pathname: string): RouteDomain {
  if (pathname.startsWith('/api/auth/')) return 'auth'
  if (pathname.startsWith('/api/tools')) return 'tools'
  if (pathname.startsWith('/api/users')) return 'users'
  return 'public'
}

// A trailing slash is the same route. Anything else — casing, encoded
// segments, `..` — is left exactly as the router will see it, because a policy
// that normalizes more than the router does is a policy that can be walked
// around.
function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1)
  return pathname
}
