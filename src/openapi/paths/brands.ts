// Makers, and their logos.
//
// A brand is a **grouping, not an owner**. A tool card keeps its maker's name
// as text and merely points at a row here, so deleting a brand regroups the
// catalog rather than making a claim about who built anything — the cards keep
// the name and simply stop pointing.
//
// The logo is not uploaded here. It is a picture from the same library
// everything else draws from, pointed at by id, so a logo can be uploaded,
// searched for or cut out like any other photograph before it becomes one.

import {
  errors,
  jsonBody,
  jsonResponse,
  object,
  type OperationSpec,
  queryParam,
  ref,
} from '../operation'
import { OFFSET_PARAM } from '../components'
import type { Schema } from '../types'

// One colour, two spellings accepted. A leading colour is read off a logo or a
// brand book, where it is given as three numbers; CSS wants it as hex. Both
// arrive and one form is stored, so a comparison cannot miss because somebody
// wrote the same colour differently.
const COLOR: Schema = {
  description:
    'Accepted as `#rrggbb`, as `"18 36 71"`, `"18,36,71"` or `"rgb(18, 36, 71)"`. Always stored and returned as lowercase `#rrggbb`. An empty string is a maker whose colour nobody has said, and is allowed.',
  examples: ['#123447', '18 36 71'],
  type: 'string',
}

const WRITABLE_FIELDS: Record<string, Schema> = {
  color: COLOR,
  name: { maxLength: 120, minLength: 1, type: 'string' },
  notes: { maxLength: 4000, type: 'string' },
}

const BRAND = jsonResponse('The maker.', object({ brand: ref('Brand') }))

export const BRAND_OPERATIONS: OperationSpec[] = [
  {
    description:
      'Every maker, with `toolCount` — how many cards name it. That count is the reason the list is worth looking at, and it is read-only.\n\nSorted by name unless `?sort=tools`, and ascending by default, unlike every other list here: a shelf of makers is read alphabetically.',
    operationId: 'listBrands',
    query: [
      queryParam('q', 'Free-text search over the maker.', { type: 'string' }),
      queryParam('sort', 'By name, or by how many tools name it.', {
        default: 'name',
        enum: ['name', 'tools'],
        type: 'string',
      }),
      queryParam('order', 'Direction.', { default: 'asc', enum: ['asc', 'desc'], type: 'string' }),
      queryParam(
        'limit',
        'How many to return.',
        { default: 100, maximum: 500, minimum: 1, type: 'integer' },
        100,
      ),
      OFFSET_PARAM,
    ],
    responses: {
      200: jsonResponse('A page of makers.', ref('BrandPage')),
      ...errors(400, 401, 403, 503),
    },
    route: 'GET /api/brands',
    summary: 'List makers',
    tag: 'brands',
  },
  {
    description: 'Only the name is required. The colour and the note can wait.',
    operationId: 'createBrand',
    requestBody: jsonBody(object(WRITABLE_FIELDS, ['name'])),
    responses: {
      201: jsonResponse('The new maker.', object({ brand: ref('Brand') })),
      409: jsonResponse('A maker with that name already exists.', ref('Error')),
      ...errors(400, 401, 403, 503),
    },
    route: 'POST /api/brands',
    summary: 'Create a maker',
    tag: 'brands',
  },
  {
    description: 'One maker, with its logo and how many cards name it.',
    operationId: 'getBrand',
    pathParams: { id: 'The maker.' },
    responses: { 200: BRAND, ...errors(401, 403, 404, 503) },
    route: 'GET /api/brands/:id',
    summary: 'One maker',
    tag: 'brands',
  },
  {
    description:
      'Only the fields present in the body are touched, and a body with no editable field at all is a 400.',
    operationId: 'updateBrand',
    pathParams: { id: 'The maker to edit.' },
    requestBody: jsonBody({ ...object(WRITABLE_FIELDS, []), minProperties: 1 }),
    responses: {
      200: BRAND,
      409: jsonResponse('Another maker already has that name.', ref('Error')),
      ...errors(400, 401, 403, 404, 503),
    },
    route: 'PATCH /api/brands/:id',
    summary: 'Edit a maker',
    tag: 'brands',
  },
  {
    description:
      'The cards keep the maker’s name as text and simply stop pointing at a row. Deleting the grouping is not a claim about who made anything.',
    operationId: 'deleteBrand',
    pathParams: { id: 'The maker to delete.' },
    responses: {
      200: jsonResponse('Deleted.', object({ ok: { const: true, type: 'boolean' } })),
      ...errors(401, 403, 404, 503),
    },
    route: 'DELETE /api/brands/:id',
    summary: 'Delete a maker',
    tag: 'brands',
  },
  {
    description:
      'Points the maker at a picture that already exists. A PUT rather than a POST because there is one logo and setting it twice is setting it once: the body names which picture, and the maker comes back with `logoUrl` filled in.',
    operationId: 'setBrandLogo',
    pathParams: { id: 'The maker.' },
    requestBody: jsonBody(
      object({ photoId: { minimum: 1, type: 'integer' } }),
      'The id of a photograph in the library.',
    ),
    responses: {
      200: BRAND,
      404: jsonResponse('No such maker, or no such photograph.', ref('Error')),
      409: jsonResponse('That picture is already another maker’s logo.', ref('Error')),
      ...errors(400, 401, 403, 503),
    },
    route: 'PUT /api/brands/:id/logo',
    summary: 'Set the logo',
    tag: 'brands',
  },
  {
    description: 'Unpoints the maker. The picture stays in the library — it was never owned here.',
    operationId: 'clearBrandLogo',
    pathParams: { id: 'The maker.' },
    responses: { 200: BRAND, ...errors(401, 403, 404, 503) },
    route: 'DELETE /api/brands/:id/logo',
    summary: 'Clear the logo',
    tag: 'brands',
  },
]
