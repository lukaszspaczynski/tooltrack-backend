// Organizers: which tools live in which case, and the labels that say so.
//
// An organizer is an **arrangement, not a container**. The link between a tool
// and an organizer lives in a table of its own, so deleting the arrangement
// touches no tool card — the tools stay, only the arrangement goes. A tool can
// be in one organizer at a time, which is what makes a label true.
//
// Four things run through the domain and are worth reading once.
//
// **Every write answers with the whole organizer.** Adding a tool, drawing a
// label, deleting one — each comes back with the arrangement as it now stands,
// because the screen shows the tools and the labels together and would
// otherwise have to merge one row into a list it already holds.
//
// **A label's size is never in the request.** It comes from the slot, which is
// one of the case's own, so a label cannot be printed at a size the box has no
// place for and therefore nobody can stick anywhere.
//
// **A label is drawn, then recorded.** The PDF is written before the row: a row
// pointing at a file that was never written is a broken label, while a file
// nobody points at is a wasted byte the delete path already knows how to find.
//
// **Nothing is silently truncated.** A request for more pictures than the label
// holds is refused rather than trimmed — a label quietly missing its sixth
// picture is one somebody prints before noticing.

import {
  arrayOf,
  binaryResponse,
  errors,
  jsonBody,
  jsonResponse,
  object,
  type OperationSpec,
  queryParam,
  ref,
} from '../operation'
import { LIMIT_PARAM, OFFSET_PARAM } from '../components'
import type { Schema } from '../types'

const ORGANIZER = jsonResponse(
  'The arrangement as it now stands, with its tools and its labels.',
  object({ organizer: ref('Organizer') }),
)

const LABEL_PATH_PARAMS = {
  id: 'The arrangement.',
  labelId: 'The label, which must be this arrangement’s.',
}

export const ORGANIZER_OPERATIONS: OperationSpec[] = [
  {
    description:
      'By number ascending unless asked otherwise: that is the order they are stacked in and the order people read them.',
    operationId: 'listOrganizers',
    query: [
      queryParam('q', 'Free-text search over the arrangement and its case.', { type: 'string' }),
      queryParam('caseId', 'Only the arrangements in this case.', {
        minimum: 1,
        type: 'integer',
      }),
      queryParam('sort', 'By number, or by name.', {
        default: 'number',
        enum: ['number', 'name'],
        type: 'string',
      }),
      queryParam('order', 'Direction.', { default: 'asc', enum: ['asc', 'desc'], type: 'string' }),
      LIMIT_PARAM,
      OFFSET_PARAM,
    ],
    responses: {
      200: jsonResponse('A page of arrangements.', ref('OrganizerPage')),
      ...errors(400, 401, 403, 503),
    },
    route: 'GET /api/organizers',
    summary: 'List organizers',
    tag: 'organizers',
  },
  {
    description:
      'The wizard’s last step, in one request: a case, a name, and the tools that were ticked. One request rather than three, so a half-made arrangement cannot exist because somebody closed the tab between two of them.\n\nAn arrangement without a case is an arrangement of nothing, so `caseId` is required. Leave `number` out for the next free one — only the server can see what is taken.',
    operationId: 'createOrganizer',
    requestBody: jsonBody(ref('OrganizerCreateBody')),
    responses: {
      201: jsonResponse('The new arrangement.', object({ organizer: ref('Organizer') })),
      404: jsonResponse('No such case.', ref('Error')),
      409: jsonResponse(
        'That number is taken, or one of the tools is already in another arrangement.',
        ref('Error'),
      ),
      ...errors(400, 401, 403, 503),
    },
    route: 'POST /api/organizers',
    summary: 'Create an organizer',
    tag: 'organizers',
  },
  {
    description: 'The arrangement, its case, the tools in it and the labels made for it.',
    operationId: 'getOrganizer',
    pathParams: { id: 'The arrangement.' },
    responses: { 200: ORGANIZER, ...errors(401, 403, 404, 503) },
    route: 'GET /api/organizers/:id',
    summary: 'One organizer',
    tag: 'organizers',
  },
  {
    description:
      'Only the fields present are touched. `caseId` may move the arrangement to another box but cannot be null — that would leave an arrangement of nothing.',
    operationId: 'updateOrganizer',
    pathParams: { id: 'The arrangement to edit.' },
    requestBody: jsonBody(ref('OrganizerPatchBody'), 'The fields to change, and only those.'),
    responses: {
      200: ORGANIZER,
      404: jsonResponse('No such arrangement, or no such case.', ref('Error')),
      409: jsonResponse('That number is taken.', ref('Error')),
      ...errors(400, 401, 403, 503),
    },
    route: 'PATCH /api/organizers/:id',
    summary: 'Edit an organizer',
    tag: 'organizers',
  },
  {
    description:
      'The tools stay; only the arrangement goes. Nothing here touches a tool card, which is the point of keeping the link in a table of its own.',
    operationId: 'deleteOrganizer',
    pathParams: { id: 'The arrangement to delete.' },
    responses: {
      200: jsonResponse('Deleted.', object({ ok: { const: true, type: 'boolean' } })),
      ...errors(401, 403, 404, 503),
    },
    route: 'DELETE /api/organizers/:id',
    summary: 'Delete an organizer',
    tag: 'organizers',
  },
  {
    description:
      'A tool is in one arrangement at a time — that is what makes a label true — so one that is already somewhere else is a 409 rather than a quiet move.',
    operationId: 'addOrganizerTools',
    pathParams: { id: 'The arrangement.' },
    requestBody: jsonBody(ref('ToolIdsBody')),
    responses: {
      200: ORGANIZER,
      409: jsonResponse('One of the tools is already in another arrangement.', ref('Error')),
      ...errors(400, 401, 403, 404, 503),
    },
    route: 'POST /api/organizers/:id/tools',
    summary: 'Put tools in an organizer',
    tag: 'organizers',
  },
  {
    description:
      'Takes the tool out of the arrangement. The card is untouched — it simply stops being anywhere.',
    operationId: 'removeOrganizerTool',
    pathParams: {
      id: 'The arrangement.',
      toolId: 'The tool, which must be in this arrangement.',
    },
    responses: {
      200: jsonResponse('Removed.', object({ ok: { const: true, type: 'boolean' } })),
      ...errors(401, 403, 404, 503),
    },
    route: 'DELETE /api/organizers/:id/tools/:toolId',
    summary: 'Take a tool out of an organizer',
    tag: 'organizers',
  },
  {
    description:
      'What the label wizard’s first step offers: the sizes this arrangement’s case has places for. A label can only be made at one of these, which is why the size is never in the request.',
    operationId: 'listOrganizerLabelSlots',
    pathParams: { id: 'The arrangement.' },
    responses: {
      200: jsonResponse(
        'The slots on this arrangement’s case.',
        object({ slots: arrayOf(ref('LabelSlot')) }),
      ),
      ...errors(401, 403, 404, 503),
    },
    route: 'GET /api/organizers/:id/label-slots',
    summary: 'The label sizes this case takes',
    tag: 'organizers',
  },
  {
    description:
      'Draws one and keeps it. The whole arrangement comes back, with the new label among its `labels`.\n\nA `slotId` that is not one of this case’s slots is a 400, as is a `photoIds` longer than the slot holds — the message names how many actually fit.',
    operationId: 'createOrganizerLabel',
    pathParams: { id: 'The arrangement.' },
    requestBody: jsonBody(ref('LabelRequestBody')),
    responses: {
      201: ORGANIZER,
      400: jsonResponse(
        'The body did not parse, the slot is not this case’s, there are more pictures than the label holds, or the label could not be drawn from what the catalog currently says.',
        ref('Error'),
      ),
      ...errors(401, 403, 404, 503),
    },
    route: 'POST /api/organizers/:id/labels',
    summary: 'Draw a label',
    tag: 'organizers',
  },
  {
    description:
      'Draws the chosen labels again from the options they were made with — which is how a label stops being wrong after somebody moved a tool.\n\nScoped to this arrangement: a label id belonging to another one is not found here rather than redrawn, which is what makes the URL mean what it says. For a selection spanning arrangements, use `POST /api/labels/refresh`.',
    operationId: 'refreshOrganizerLabels',
    pathParams: { id: 'The arrangement.' },
    requestBody: jsonBody(ref('LabelIdsBody')),
    responses: {
      200: jsonResponse(
        'How many were drawn, what went wrong with the rest, and the arrangement.',
        object({
          failed: arrayOf(object({ error: { type: 'string' }, id: { type: 'integer' } })),
          organizer: ref('Organizer'),
          refreshed: { type: 'integer' },
        }),
      ),
      404: jsonResponse('No such arrangement, or none of those labels are its.', ref('Error')),
      ...errors(400, 401, 403, 503),
    },
    route: 'POST /api/organizers/:id/labels/refresh',
    summary: 'Draw an organizer’s labels again',
    tag: 'organizers',
  },
  {
    description:
      'The label as it was drawn, ready to print. Served `immutable`: the file is named after the checksum of what it shows, so a label that changes is a different URL rather than the same one with new bytes. A row whose file is missing is a 404 — a broken label, not a broken server.',
    operationId: 'getOrganizerLabelFile',
    pathParams: LABEL_PATH_PARAMS,
    responses: {
      200: binaryResponse('The label PDF.', 'application/pdf'),
      ...errors(401, 403, 404),
    },
    route: 'GET /api/organizers/:id/labels/:labelId/file',
    summary: 'The label PDF',
    tag: 'organizers',
  },
  {
    description:
      'The same file as a picture, for the tile in the list. Older labels and ones whose render failed have none, which is why `previewUrl` on the row is nullable and this can 404 where the PDF does not.',
    operationId: 'getOrganizerLabelPreview',
    pathParams: LABEL_PATH_PARAMS,
    responses: {
      200: binaryResponse('The preview image.', 'image/png'),
      ...errors(401, 403, 404),
    },
    route: 'GET /api/organizers/:id/labels/:labelId/preview',
    summary: 'A picture of the label',
    tag: 'organizers',
  },
  {
    description:
      'Removes the label and, when no other row points at the same artwork, the file behind it.',
    operationId: 'deleteOrganizerLabel',
    pathParams: LABEL_PATH_PARAMS,
    responses: { 200: ORGANIZER, ...errors(401, 403, 404, 503) },
    route: 'DELETE /api/organizers/:id/labels/:labelId',
    summary: 'Delete a label',
    tag: 'organizers',
  },
]
