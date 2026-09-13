import type { Lang } from '../server/i18n/lang'

// Who may do what. This module is pure: no database, no Request, no Response.
// Everything that decides access — the route guard, the user routes, the
// scripts — reads the answer from here, so there is one table to change when
// the product changes its mind about a role.

export const ROLE_OPTIONS = [
  { label: 'Viewer', value: 'viewer' },
  { label: 'Editor', value: 'editor' },
  { label: 'Admin', value: 'admin' },
] as const

export type Role = (typeof ROLE_OPTIONS)[number]['value']

export type AccountStatus = 'active' | 'disabled'

// One capability for the catalog, not one per kind of thing in it. Tools live
// in cases, both carry photos, and every screen that shows one shows the
// other; a viewer who could read tools but not the case they are in would be
// looking at half a shelf.
export type Capability = 'catalog.read' | 'catalog.write' | 'users.manage'

// A role is a name for a set of capabilities and nothing else. Routes ask for
// a capability, never for a role, so adding a fourth role later is a line in
// this table rather than a sweep through the route policy.
export const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  admin: ['catalog.read', 'catalog.write', 'users.manage'],
  editor: ['catalog.read', 'catalog.write'],
  viewer: ['catalog.read'],
}

// Every registration lands here. Promotion is an admin action, never a
// side effect of signing up.
export const DEFAULT_ROLE: Role = 'viewer'

export type User = {
  createdAt: string
  displayName: string
  email: string
  id: number
  // Which language this account reads the interface in. It travels with the
  // user rather than with the browser, so a phone and a laptop agree.
  language: Lang
  role: Role
  status: AccountStatus
}

export function isRole(value: unknown): value is Role {
  // hasOwn, not `in`: `in` walks the prototype, so 'toString' would pass as a
  // role and reach a CHECK constraint that refuses it as a 500.
  return typeof value === 'string' && Object.hasOwn(ROLE_CAPABILITIES, value)
}

export function isAccountStatus(value: unknown): value is AccountStatus {
  return value === 'active' || value === 'disabled'
}

export function normalizeEmail(value: null | string | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

const DEFAULT_BOOTSTRAP_ADMIN_EMAILS: readonly string[] = []

function bootstrapAdminEmails(): Set<string> {
  const configured = process.env.TOOLTRACK_BOOTSTRAP_ADMIN_EMAILS
  if (configured === undefined) return new Set(DEFAULT_BOOTSTRAP_ADMIN_EMAILS)

  return new Set(
    configured
      .split(',')
      .map((entry) => normalizeEmail(entry))
      .filter((entry) => entry.length > 0),
  )
}

export function bootstrapAdminEmailList(): string[] {
  return [...bootstrapAdminEmails()]
}

export function isBootstrapAdminEmail(email: null | string | undefined): boolean {
  const normalized = normalizeEmail(email)
  if (!normalized) return false
  return bootstrapAdminEmails().has(normalized)
}

// Read from the environment on every call rather than at import time, so that
// a test can set the variable and a deploy can change it without a restart
// being the thing that decides who is an admin.
export function isBootstrapAdmin(user: null | undefined | User): boolean {
  return isBootstrapAdminEmail(user?.email)
}

export function isActiveUser(user: null | undefined | User): boolean {
  return Boolean(user) && user?.status === 'active'
}

export function effectiveRole(user: null | undefined | User): null | Role {
  if (!isActiveUser(user) || !user) return null
  return isBootstrapAdmin(user) ? 'admin' : user.role
}

export function capabilitiesFor(user: null | undefined | User): Capability[] {
  const role = effectiveRole(user)
  if (!role) return []
  return [...ROLE_CAPABILITIES[role]]
}

export function hasCapability(user: null | undefined | User, capability: Capability): boolean {
  return capabilitiesFor(user).includes(capability)
}

export function canReadCatalog(user: null | undefined | User): boolean {
  return hasCapability(user, 'catalog.read')
}

export function canWriteCatalog(user: null | undefined | User): boolean {
  return hasCapability(user, 'catalog.write')
}

export function canManageUsers(user: null | undefined | User): boolean {
  return hasCapability(user, 'users.manage')
}
