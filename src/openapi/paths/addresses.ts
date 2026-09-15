// Where the kit is kept: a workshop, a yard, a site, a van.
//
// A thing of its own rather than a line typed on fifty cards. Fifty spellings
// of "Budowa Mokotów" is a catalog in which "what is on the Mokotów site"
// cannot be asked, which is the only question this feature exists to answer.
//
// Assigning one is deliberately not here. An item is at one place and an
// arrangement is at one place, so it is `addressId` on each of those, set by
// the PATCH that already edits them. An endpoint per pairing would be two more
// routes saying what one column already says.

import { limitParam, OFFSET_PARAM } from '../components'
import {
  errors,
  jsonBody,
  jsonResponse,
  object,
  type OperationSpec,
  queryParam,
  ref,
} from '../operation'
import { ADDRESS_PAGING } from '../../server/routes/paging'

const ADDRESS = jsonResponse('The place.', object({ address: ref('Address') }))

const ID_PARAM = { id: 'The address id.' }

export const ADDRESS_OPERATIONS: OperationSpec[] = [
  {
    description: [
      'Every place, with `itemCount` and `organizerCount` — how many things say they are there. Those counts are most of why the list is worth looking at: they answer "where is the kit" and "which of these is empty and can be tidied away".',
      '',
      'Sorted by name unless `?sort=` says otherwise, and ascending by default, like the makers: a short list of places is read alphabetically rather than newest-first.',
    ].join('\n'),
    operationId: 'listAddresses',
    query: [
      queryParam('q', 'Free-text over name, city, street, postcode and notes.', {
        type: 'string',
      }),
      queryParam('sort', 'By name, by city, or by how much is kept there.', {
        default: 'name',
        enum: ['name', 'city', 'items'],
        type: 'string',
      }),
      queryParam('order', 'Direction.', { default: 'asc', enum: ['asc', 'desc'], type: 'string' }),
      limitParam(ADDRESS_PAGING),
      OFFSET_PARAM,
    ],
    responses: {
      200: jsonResponse('A page of places.', ref('AddressPage')),
      ...errors(400, 401, 403, 503),
    },
    route: 'GET /api/addresses',
    summary: 'List places',
    tag: 'addresses',
  },
  {
    description:
      'Only `name` is required, and it is the part a picker shows — a crew says "magazyn", not a postcode. The rest is the postal half, for when somebody has to drive there, and all of it is optional: a yard on a building site has a name and no street, and refusing to record it until somebody invents one means it is not recorded at all.\n\nNames are unique folded and trimmed, so "Magazyn" and "magazyn " are one place rather than two lines nobody can choose between.',
    operationId: 'createAddress',
    requestBody: jsonBody(ref('AddressCreateBody')),
    responses: {
      201: ADDRESS,
      ...errors(400, 401, 403, 409, 503),
    },
    route: 'POST /api/addresses',
    summary: 'Add a place',
    tag: 'addresses',
  },
  {
    description: 'One place, with what is kept there counted.',
    operationId: 'getAddress',
    pathParams: ID_PARAM,
    responses: { 200: ADDRESS, ...errors(401, 403, 404, 503) },
    route: 'GET /api/addresses/:id',
    summary: 'Read a place',
    tag: 'addresses',
  },
  {
    description: 'Any subset of the create body. Absent fields are left alone.',
    operationId: 'updateAddress',
    pathParams: ID_PARAM,
    requestBody: jsonBody(ref('AddressPatchBody')),
    responses: { 200: ADDRESS, ...errors(400, 401, 403, 404, 409, 503) },
    route: 'PATCH /api/addresses/:id',
    summary: 'Edit a place',
    tag: 'addresses',
  },
  {
    description:
      'The items and arrangements that were here stay in the catalog and stop pointing at anything — closing a site must not take the kit that was on it out of the catalog.\n\n`cleared` says how many lost their place. That number is the reason this answer is not a bare `ok`: "delete" on a list of places reads like tidying up, and forty cards quietly losing their location does not.',
    operationId: 'deleteAddress',
    pathParams: ID_PARAM,
    responses: {
      200: jsonResponse(
        'Deleted, and what stopped pointing at it.',
        object({
          cleared: object({
            organizers: { type: 'integer' },
            items: { type: 'integer' },
          }),
          ok: { type: 'boolean' },
        }),
      ),
      ...errors(401, 403, 404, 503),
    },
    route: 'DELETE /api/addresses/:id',
    summary: 'Delete a place',
    tag: 'addresses',
  },
]
