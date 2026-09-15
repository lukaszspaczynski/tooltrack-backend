// Makers, and their logos.
//
// A brand is a **grouping, not an owner**. An item card keeps its maker's name
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
import { limitParam, OFFSET_PARAM } from '../components'
import type { Schema } from '../types'
import { BRAND_PAGING } from '../../server/routes/paging'

const BRAND = jsonResponse('The maker.', object({ brand: ref('Brand') }))

export const BRAND_OPERATIONS: OperationSpec[] = [
  {
    description:
      'Every maker, with `itemCount` — how many cards name it. That count is the reason the list is worth looking at, and it is read-only.\n\nSorted by name unless `?sort=items`, and ascending by default, unlike every other list here: a shelf of makers is read alphabetically.',
    operationId: 'listBrands',
    query: [
      queryParam('q', 'Free-text search over the maker.', { type: 'string' }),
      queryParam('sort', 'By name, or by how many items name it.', {
        default: 'name',
        enum: ['name', 'items'],
        type: 'string',
      }),
      queryParam('order', 'Direction.', { default: 'asc', enum: ['asc', 'desc'], type: 'string' }),
      limitParam(BRAND_PAGING),
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
    requestBody: jsonBody(ref('BrandCreateBody')),
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
    requestBody: jsonBody(
      ref('BrandPatchBody'),
      'The fields to change, and only those. At least one.',
    ),
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
    requestBody: jsonBody(ref('BrandLogoBody'), 'The id of a photograph in the library.'),
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
