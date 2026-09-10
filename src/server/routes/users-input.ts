// The admin user-management body. Pure; see input.ts.

import {
  isAccountStatus,
  isRole,
  ROLE_OPTIONS,
  type AccountStatus,
  type Role,
} from '../../access/roles'
import { invalid, isPlainObject, trimmedString, valid, type Parsed } from './input'
import { MAX_DISPLAY_NAME_LENGTH } from './auth-input'

export type UserPatch = {
  displayName?: string
  role?: Role
  status?: AccountStatus
}

export function parseUserPatch(body: unknown): Parsed<UserPatch> {
  if (!isPlainObject(body)) return invalid('Expected a JSON object')

  const patch: UserPatch = {}

  if ('role' in body) {
    if (!isRole(body.role)) {
      return invalid(
        `role must be one of: ${ROLE_OPTIONS.map((option) => option.value).join(', ')}`,
      )
    }
    patch.role = body.role
  }

  if ('status' in body) {
    if (!isAccountStatus(body.status)) return invalid('status must be active or disabled')
    patch.status = body.status
  }

  if ('displayName' in body) {
    const displayName = trimmedString(body.displayName)
    if (displayName === null) return invalid('displayName must be a string')
    if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
      return invalid(`displayName must be at most ${MAX_DISPLAY_NAME_LENGTH} characters`)
    }
    patch.displayName = displayName
  }

  // The email is not editable here. It is the login identity and the unique
  // key; changing it is an account migration, not a field edit.
  if (Object.keys(patch).length === 0) return invalid('No editable fields in request body')

  return valid(patch)
}
