// Who may reach what.
//
// Every route here needs `users.manage`, which only `admin` holds. Two further
// rules are enforced on top of that capability, and neither is about
// permission — they are the two ways an admin who legitimately holds it can
// still lock everybody out:
//
//   1. **You cannot change your own role or status.** An admin who demotes
//      themselves needs another admin to undo it, and on a small site there may
//      not be one. That is a 403.
//   2. **The last active admin cannot be removed or demoted.** After that
//      nobody can grant the role back, and the only way in is an environment
//      variable or SQL. That is a 409.
//
// The e-mail is deliberately not editable. It is the login identity and the
// unique key; changing it is an account migration rather than a field edit.

import {
  arrayOf,
  errors,
  jsonBody,
  jsonResponse,
  object,
  type OperationSpec,
  ref,
} from '../operation'

export const USER_OPERATIONS: OperationSpec[] = [
  {
    description:
      'Every account. The capability list travels with each row so the screen can show what a role actually means without repeating that table client side.',
    operationId: 'listUsers',
    responses: {
      200: jsonResponse('Every account, with what its role allows.', ref('UserListResponse')),
      ...errors(401, 403, 503),
    },
    route: 'GET /api/users',
    summary: 'List accounts',
    tag: 'users',
  },
  {
    description:
      'The display name, the role and the status. Only the fields present are touched, and a body with none of them is a 400.',
    operationId: 'updateUser',
    pathParams: { id: 'The account to edit.' },
    requestBody: jsonBody(
      ref('UserPatchBody'),
      'The fields to change, and only those. At least one.',
    ),
    responses: {
      200: jsonResponse(
        'The account as it now stands.',
        object({ user: ref('UserWithCapabilities') }),
      ),
      403: jsonResponse(
        'This is your own account, and the body changes your role or status. Ask another admin.',
        ref('Error'),
      ),
      409: jsonResponse(
        'This is the last active admin, and the change would leave none.',
        ref('Error'),
      ),
      ...errors(400, 401, 404, 503),
    },
    route: 'PATCH /api/users/:id',
    summary: 'Edit an account',
    tag: 'users',
  },
  {
    description:
      'The tool cards they created stay, with `createdBy` set to null. Losing the catalog because somebody left is not an outcome anybody would ask for.',
    operationId: 'deleteUser',
    pathParams: { id: 'The account to delete.' },
    responses: {
      200: jsonResponse('Deleted.', object({ ok: { const: true, type: 'boolean' } })),
      403: jsonResponse('This is your own account.', ref('Error')),
      409: jsonResponse('This is the last active admin.', ref('Error')),
      ...errors(401, 404, 503),
    },
    route: 'DELETE /api/users/:id',
    summary: 'Delete an account',
    tag: 'users',
  },
]
