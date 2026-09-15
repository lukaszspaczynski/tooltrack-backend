// Drawing and reprinting labels.
//
// A label is **artwork, not a record of what was printed**. It is drawn from
// the arrangement it belongs to, so redrawing it is how it stops being wrong
// after somebody moved an item — and a sheet is drawn from scratch every time
// rather than stored, because keeping one would mean a second thing to redraw
// whenever any label on it changed.
//
// Labels are made and deleted from the organizer that owns them; what is here
// is the view across all of them, which is what a printing session needs.

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
import { limitParam, OFFSET_PARAM } from '../components'
import { LABEL_PAGING } from '../../server/routes/paging'

export const LABEL_OPERATIONS: OperationSpec[] = [
  {
    description:
      'Every label there is, whichever arrangement made it, newest first — the screen is opened to find what was printed last, and a label made a year ago is the one nobody is looking for.\n\nEach row carries both the arrangement and the box it is stuck on, because a sticker is found by the box far more often than by the arrangement. A label has no name of its own, so `q` matches those two.',
    operationId: 'listLabels',
    query: [
      queryParam('q', 'Matches the arrangement and the box.', { type: 'string' }),
      queryParam(
        'organizerId',
        'One arrangement’s labels. The organizer’s own screen does not need this; a link from it does.',
        { minimum: 1, type: 'integer' },
      ),
      queryParam('template', 'Which artwork.', {
        enum: ['number', 'contents'],
        type: 'string',
      }),
      queryParam('order', 'Direction.', { default: 'desc', enum: ['desc', 'asc'], type: 'string' }),
      limitParam(LABEL_PAGING),
      OFFSET_PARAM,
    ],
    responses: {
      200: jsonResponse('A page of labels.', ref('LabelPage')),
      400: jsonResponse('`template` or `organizerId` names something impossible.', ref('Error')),
      ...errors(401, 403, 503),
    },
    route: 'GET /api/labels',
    summary: 'Every label, with its arrangement and box',
    tag: 'labels',
  },
  {
    description: [
      'The chosen labels ganged onto A4, as a PDF to look at and print.',
      '',
      'A **GET** because the screen opens it in a tab, and a tab is a GET — which is also why the ids arrive in the query string rather than in a body. Nothing is stored: the sheet is a view of labels that already exist.',
      '',
      'The artwork is drawn again with no margin or crop marks rather than taken from each label’s own file — thirty margins is most of a sheet of paper — which also means a sheet can never show something a label no longer says. That redrawing is why there is a ceiling of 200: each one takes a moment, and a full sheet is tens of seconds of a single request.',
      '',
      'A label whose photographs have gone missing does not cost the other twenty-nine their sheet. What could not be drawn is printed **on the sheet itself**, because the answer here is a file in a new tab and nothing reads a header or a status line — a sheet of a hundred and ninety-four would otherwise be indistinguishable from the two hundred that were asked for.',
    ].join('\n'),
    operationId: 'getLabelSheet',
    query: [
      queryParam(
        'ids',
        'The labels to gang up, comma separated. At most 200 — as many as the list itself shows at once, so "show everything, tick everything, print it" cannot end in a refusal.',
        { type: 'string' },
        '12,13,14',
      ),
    ],
    responses: {
      200: binaryResponse('The sheet.', 'application/pdf'),
      400: jsonResponse('No ids, too many, or one that is not a number.', ref('Error')),
      404: jsonResponse('None of those labels exist.', ref('Error')),
      422: jsonResponse('Not one of them could be drawn.', ref('Error')),
      ...errors(401, 403, 503),
    },
    route: 'GET /api/labels/sheet',
    summary: 'A sheet of labels to print',
    tag: 'labels',
  },
  {
    description:
      'Draws the chosen labels again, wherever they live. This is how a label stops being wrong after somebody moved an item between boxes.\n\nThe selection spans arrangements, so the answer cannot be one of them the way the per-organizer refresh’s is — the screen re-reads the list instead. What it does say is how many were drawn and which were not, because a label whose photographs have been deleted since is the one thing somebody has to act on.',
    operationId: 'refreshLabels',
    requestBody: jsonBody(ref('LabelIdsBody')),
    responses: {
      200: jsonResponse(
        'How many were drawn, and what went wrong with the rest.',
        ref('LabelRefreshResponse'),
      ),
      404: jsonResponse('None of those labels exist.', ref('Error')),
      ...errors(400, 401, 403, 503),
    },
    route: 'POST /api/labels/refresh',
    summary: 'Draw labels again',
    tag: 'labels',
  },
]
