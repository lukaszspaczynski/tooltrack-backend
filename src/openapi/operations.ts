// Every endpoint this document describes, and — just as deliberately — every
// endpoint it does not.
//
// `PENDING` is empty, and the point is that it stays a list rather than being
// deleted. The test in coverage.test.ts asserts that DESCRIBED and PENDING
// together are exactly the routing table in src/server/route-list.ts, with
// nothing in both and nothing in neither, so a route added tomorrow fails the
// build until somebody says which of the two it belongs in. That is what keeps
// the spec from quietly falling behind the server: it cannot omit a route
// without somebody writing the omission down.

import type { OperationSpec } from './operation'
import { IMPORT_OPERATIONS } from './paths/import'
import { ADDRESS_OPERATIONS } from './paths/addresses'
import { BRAND_OPERATIONS } from './paths/brands'
import { CASE_OPERATIONS } from './paths/cases'
import { LABEL_OPERATIONS } from './paths/labels'
import { MANUAL_OPERATIONS } from './paths/manuals'
import { ORGANIZER_OPERATIONS } from './paths/organizers'
import { PHOTO_OPERATIONS } from './paths/photos'
import { AUTH_OPERATIONS, PUBLIC_OPERATIONS } from './paths/public'
import { SETTINGS_OPERATIONS } from './paths/settings'
import { ITEM_OPERATIONS } from './paths/items'
import { USER_OPERATIONS } from './paths/users'

export const OPERATIONS: OperationSpec[] = [
  ...PUBLIC_OPERATIONS,
  ...AUTH_OPERATIONS,
  ...IMPORT_OPERATIONS,
  ...ITEM_OPERATIONS,
  ...PHOTO_OPERATIONS,
  ...MANUAL_OPERATIONS,
  ...CASE_OPERATIONS,
  ...ADDRESS_OPERATIONS,
  ...BRAND_OPERATIONS,
  ...SETTINGS_OPERATIONS,
  ...LABEL_OPERATIONS,
  ...USER_OPERATIONS,
  ...ORGANIZER_OPERATIONS,
]

// Described, as the routing table spells them.
export const DESCRIBED: string[] = OPERATIONS.map((operation) => operation.route)

// Routes that are real, reachable and guarded, but not described — because
// what a spec cannot generate is the half no machine knows: what an endpoint
// is for, which failures it can actually produce, and what its body means.
// Empty today. A route parked here is a gap somebody chose, not one that
// happened.
export const PENDING: string[] = []
