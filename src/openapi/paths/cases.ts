// Cases, and the slots a label goes in.
//
// A case is a box a tool lives in, described mostly by measurements — and a
// measurement is **nullable rather than zero**. A case with no height does not
// exist; a case nobody has measured is normal, so `null` means unmeasured and
// an explicit `null` in a PATCH clears a number copied off the wrong spec
// sheet. Sending a number as a string is accepted too, because a form sends
// `"450"` and a Polish keyboard produces `"4,5"`.
//
// Photographs of a case are not here. They are the same routes as a tool's,
// under `/api/cases/:id/photos`, and are described with the rest of the
// photographs.

import {
  arrayOf,
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
import { CASE_PAGING } from '../../server/routes/paging'

const CASE = jsonResponse('The case, with its label slots.', object({ case: ref('ToolCase') }))

export const CASE_OPERATIONS: OperationSpec[] = [
  {
    description:
      'A page of cases for the shelf. Every item carries `primaryPhotoUrl` for the thumbnail, fetched for the whole page in one query rather than per row.\n\nA bad value in the query string is clamped or dropped rather than refused: a link somebody pasted with `?limit=banana` should still show the shelf.',
    operationId: 'listCases',
    query: [
      queryParam('q', 'Free-text search over the case.', { type: 'string' }),
      queryParam('manufacturer', 'Exact maker, as the cases spell it.', { type: 'string' }),
      queryParam('system', 'Exact stacking system.', { type: 'string' }, 'L-BOXX'),
      queryParam('sort', 'By name unless asked otherwise.', {
        default: 'name',
        enum: ['name', 'capacityL', 'createdAt', 'updatedAt'],
        type: 'string',
      }),
      queryParam('order', 'Direction.', { default: 'desc', enum: ['desc', 'asc'], type: 'string' }),
      limitParam(CASE_PAGING),
      OFFSET_PARAM,
    ],
    responses: {
      200: jsonResponse('A page of cases.', ref('CaseListPage')),
      ...errors(400, 401, 403, 503),
    },
    route: 'GET /api/cases',
    summary: 'List cases',
    tag: 'cases',
  },
  {
    description:
      'Two fields are required. A case with no name cannot be pointed at in a van, and without a maker the name alone — "Toolbox 2.0" — does not say what it is. Every measurement is optional and starts unmeasured.',
    operationId: 'createCase',
    requestBody: jsonBody(ref('CaseCreateBody')),
    responses: {
      201: jsonResponse('The new case.', object({ case: ref('ToolCase') })),
      ...errors(400, 401, 403, 503),
    },
    route: 'POST /api/cases',
    summary: 'Create a case',
    tag: 'cases',
  },
  {
    description:
      'Read from the cases themselves rather than from a table of systems, so the list is what is actually on the shelf. That is the list to offer in a filter.',
    operationId: 'listCaseSystems',
    responses: {
      200: jsonResponse(
        'Every stacking system in use, with how many cases belong to it.',
        object({ systems: arrayOf(ref('SystemCount')) }),
      ),
      ...errors(401, 403, 503),
    },
    route: 'GET /api/cases/systems',
    summary: 'The stacking systems in use',
    tag: 'cases',
  },
  {
    description: 'The case and its label slots. The list answers without the slots.',
    operationId: 'getCase',
    pathParams: { id: 'The case.' },
    responses: { 200: CASE, ...errors(401, 403, 404, 503) },
    route: 'GET /api/cases/:id',
    summary: 'One case',
    tag: 'cases',
  },
  {
    description:
      'Only the fields present in the body are touched. An explicit `null` clears a measurement, which is a real edit — a number copied off the wrong spec sheet has to be removable — while absent leaves it alone. A body with no editable field at all is a 400.',
    operationId: 'updateCase',
    pathParams: { id: 'The case to edit.' },
    requestBody: jsonBody(
      ref('CasePatchBody'),
      'The fields to change, and only those. At least one.',
    ),
    responses: { 200: CASE, ...errors(400, 401, 403, 404, 503) },
    route: 'PATCH /api/cases/:id',
    summary: 'Edit a case',
    tag: 'cases',
  },
  {
    description:
      'The pictures no other card shows go with it. One that a tool inside the case also uses stays, which is the whole point of storing them as links.',
    operationId: 'deleteCase',
    pathParams: { id: 'The case to delete.' },
    responses: {
      200: jsonResponse('Deleted.', object({ ok: { const: true, type: 'boolean' } })),
      ...errors(401, 403, 404, 503),
    },
    route: 'DELETE /api/cases/:id',
    summary: 'Delete a case',
    tag: 'cases',
  },
  {
    description:
      'One more place a label goes. A slot is a size and nothing else: width by height, in millimetres, and neither may be `null` — a slot with no width is not a slot.\n\nThe whole case comes back rather than the slot, because the screen shows the slots together and would otherwise have to merge one into a list it already holds.',
    operationId: 'addCaseLabelSlot',
    pathParams: { id: 'The case.' },
    requestBody: jsonBody(ref('CaseLabelSlotBody')),
    responses: {
      201: CASE,
      409: jsonResponse('This case already has a slot that size.', ref('Error')),
      ...errors(400, 401, 403, 404, 503),
    },
    route: 'POST /api/cases/:id/label-slots',
    summary: 'Add a label slot to a case',
    tag: 'cases',
  },
  {
    description: 'Answers with the case, so the screen holding the slots can redraw it whole.',
    operationId: 'removeCaseLabelSlot',
    pathParams: { id: 'The case.', slotId: 'The slot, which must be this case’s.' },
    responses: { 200: CASE, ...errors(401, 403, 404, 503) },
    route: 'DELETE /api/cases/:id/label-slots/:slotId',
    summary: 'Remove a label slot',
    tag: 'cases',
  },
]
