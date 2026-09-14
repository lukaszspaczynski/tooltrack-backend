// The admin user-management body. Pure; see input.ts.

import { z } from 'zod'

import { ACCOUNT_STATUSES, ROLE_OPTIONS, type AccountStatus, type Role } from '../../access/roles'
import { invalid, NOT_AN_OBJECT, parseWith, type Parsed } from './input'
import { MAX_DISPLAY_NAME_LENGTH } from './auth-input'

const ROLES = ROLE_OPTIONS.map((option) => option.value) as [Role, ...Role[]]

export type UserPatch = {
  displayName?: string
  role?: Role
  status?: AccountStatus
}

// The e-mail is not in here. It is the login identity and the unique key;
// changing it is an account migration, not a field edit.
export const USER_PATCH_SCHEMA = z
  .object(
    {
      displayName: z
        .string({ error: () => 'displayName must be a string' })
        .trim()
        .max(MAX_DISPLAY_NAME_LENGTH, {
          error: () => `displayName must be at most ${MAX_DISPLAY_NAME_LENGTH} characters`,
        })
        .optional(),
      role: z.enum(ROLES, { error: () => `role must be one of: ${ROLES.join(', ')}` }).optional(),
      status: z
        .enum(ACCOUNT_STATUSES, { error: () => 'status must be active or disabled' })
        .optional(),
    },
    NOT_AN_OBJECT,
  )
  .strip()

export function parseUserPatch(body: unknown): Parsed<UserPatch> {
  const parsed = parseWith(USER_PATCH_SCHEMA, body)
  if (!parsed.ok) return parsed

  if (Object.keys(parsed.value).length === 0) {
    return invalid('No editable fields in request body')
  }

  return parsed
}
