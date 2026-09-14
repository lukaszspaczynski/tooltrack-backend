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

const IMPORT_OUTCOME = object({
  photos: {
    description:
      'Photographs fetched and stored. Always 0 on a refresh, whose photographs are deliberately left alone.',
    type: 'integer',
  },
  photosFailed: { description: 'Photographs that would not download or decode.', type: 'integer' },
  sourceUrl: { description: 'The address the case was read from.', format: 'uri', type: 'string' },
})

export const CASE_OPERATIONS: OperationSpec[] = [
  {
    description:
      'What the form offers while somebody types a parameter name on a case, most used first. Asked per kind rather than across the catalog: a box and a drill have nothing in common on a spec sheet, and suggesting "pojemność zbiornika" to somebody labelling a case would be noise where the point of the list is a vocabulary people converge on.',
    operationId: 'listCaseAttributeNames',
    responses: {
      200: jsonResponse(
        'Every parameter name in use on a case, with how many carry it.',
        object({ names: arrayOf(ref('AttributeNameCount')) }),
      ),
      ...errors(401, 403, 503),
    },
    route: 'GET /api/cases/attributes',
    summary: 'The parameter names in use on cases',
    tag: 'cases',
  },
  {
    description:
      "One line off the spec sheet of a box, on exactly the terms a tool's parameters are: both halves required, whitespace collapsed, one name per case.\n\nThe columns hold what every box has — a length is a length — and this holds what they do not: a stacking system, a lid type, whatever the next kind of box turns out to state. Answers with the whole case rather than the row that changed.",
    operationId: 'addCaseAttribute',
    pathParams: { id: 'The case to add the parameter to.' },
    requestBody: jsonBody(ref('AttributeCreateBody')),
    responses: {
      201: CASE,
      409: jsonResponse('This case already carries a parameter with that name.', ref('Error')),
      ...errors(400, 401, 403, 404, 503),
    },
    route: 'POST /api/cases/:id/attributes',
    summary: 'Add a parameter to a case',
    tag: 'cases',
  },
  {
    description:
      "A typo in the name, or a value read off the box again. A parameter that is not this case's reads the same as one that never existed.",
    operationId: 'updateCaseAttribute',
    pathParams: {
      attributeId: 'The parameter, which must belong to this case.',
      id: 'The case the parameter is on.',
    },
    requestBody: jsonBody(ref('AttributePatchBody')),
    responses: {
      200: CASE,
      409: jsonResponse('This case already carries a parameter with that name.', ref('Error')),
      ...errors(400, 401, 403, 404, 503),
    },
    route: 'PATCH /api/cases/:id/attributes/:attributeId',
    summary: 'Edit a parameter on a case',
    tag: 'cases',
  },
  {
    description: 'Answers with the case, so the screen holding the sheet can redraw it whole.',
    operationId: 'deleteCaseAttribute',
    pathParams: {
      attributeId: 'The parameter, which must belong to this case.',
      id: 'The case the parameter is on.',
    },
    responses: { 200: CASE, ...errors(401, 403, 404, 503) },
    route: 'DELETE /api/cases/:id/attributes/:attributeId',
    summary: 'Delete a parameter from a case',
    tag: 'cases',
  },
  {
    description:
      'What the import dialog lists before asking for an address. A shorter list than the tools one, and a different one: a page that sells drills has nothing to say about a box.',
    operationId: 'listCaseImportSources',
    responses: {
      200: jsonResponse(
        'The pages this server can read a case from.',
        object({
          sources: arrayOf(object({ host: { type: 'string' }, label: { type: 'string' } })),
        }),
      ),
      ...errors(401, 403),
    },
    route: 'GET /api/cases/import/sources',
    summary: 'The sources a case can be imported from',
    tag: 'cases',
  },
  {
    description:
      'Reads a maker’s product page into a case. Everything worth knowing about a box is a measurement, and a measurement the page states outside what a case can be is dropped rather than stored — a number nobody can have measured looks like a fact.\n\nWhat comes with it is the photographs and nothing else: a case has no parameters and no documents. The weight goes in the note, because the catalog stores what a box measures and what it carries rather than what it weighs empty.',
    operationId: 'importCase',
    requestBody: jsonBody(ref('ImportUrlBody'), 'The address of the page to read.'),
    responses: {
      201: jsonResponse(
        'The case, and what came with it.',
        object({ case: ref('ToolCase'), imported: IMPORT_OUTCOME }),
      ),
      400: jsonResponse(
        'The body did not parse, or the address is from a site this server cannot read. The message names the ones it can.',
        ref('Error'),
      ),
      ...errors(401, 403, 422, 503),
    },
    route: 'POST /api/cases/import',
    summary: 'Import a case from a product page',
    tag: 'cases',
  },
  {
    description:
      'Reads the page again into a case that already exists. What the page knows it overwrites: the maker, the name, the system, every measurement and the note.\n\nWhat it cannot know it leaves alone — the **label slots**, which are where a sticker goes on this particular box in this particular van and about which no product page has an opinion, and the photographs, which somebody may well have taken themselves. That is why this is a refresh rather than a delete and a re-import, and why `imported.photos` is always 0 here.',
    operationId: 'refreshCaseFromPage',
    pathParams: { id: 'The case to read the page into.' },
    requestBody: jsonBody(ref('ImportUrlBody'), 'The address of the page to read.'),
    responses: {
      200: jsonResponse(
        'The case as it now stands.',
        object({ case: ref('ToolCase'), imported: IMPORT_OUTCOME }),
      ),
      ...errors(400, 401, 403, 404, 422, 503),
    },
    route: 'POST /api/cases/:id/import',
    summary: 'Read the page again into an existing case',
    tag: 'cases',
  },
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
