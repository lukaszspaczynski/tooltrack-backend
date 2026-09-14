// The documents that belong beside a tool.
//
// Split in two the same way the photographs are: the panel on a card answers
// "what does this tool come with", and `/api/manuals` answers "what documents
// do we have" — which is the question somebody asks when a manual is missing
// from a card that should have it.
//
// A document is **shared, not owned**. The same PDF sits on every card of that
// model, stored once and reached by its own id rather than through any one of
// them, which is why the bytes are served from `/api/manuals/:id/file` and not
// from a path under a tool.
//
// As with a photograph, the declared content-type is a claim: the first bytes
// decide, and a shop answering with an error page under a `.pdf` address is
// the common case that catches.

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
import { MANUAL_PAGING } from '../../server/routes/paging'

// The body of a save from an address, and of a read from a product page.
const URL_BODY = ref('ManualUrlBody')

const ID_LIST = ref('ManualIdsBody')

export const MANUAL_OPERATIONS: OperationSpec[] = [
  {
    description:
      'What this tool comes with: the manual, maybe a parts diagram, maybe a safety sheet.',
    operationId: 'listToolManuals',
    pathParams: { id: 'The tool card.' },
    responses: {
      200: jsonResponse('The documents on this card.', object({ manuals: arrayOf(ref('Manual')) })),
      ...errors(401, 403, 404, 503),
    },
    route: 'GET /api/tools/:id/manuals',
    summary: 'The documents on a card',
    tag: 'manuals',
  },
  {
    description:
      'Two request shapes on one route, like the photographs.\n\nWith `application/pdf` (or `application/octet-stream`) the body is the file, and `?name=` carries the file name to take a title from.\n\nWith `application/json` the body is an address this server fetches.\n\nEither way the bytes are checked before anything is stored: an empty body is a 400, one over the size limit a 413, and anything whose first bytes are not a PDF a 415 — whatever the content-type or the `.pdf` on the end of the address claimed.',
    operationId: 'addToolManual',
    pathParams: { id: 'The tool card.' },
    query: [
      queryParam(
        'name',
        'The file name, for a title. Only read when the body is the file itself.',
        { type: 'string' },
        'GBH-2-26.pdf',
      ),
    ],
    requestBody: {
      content: {
        'application/json': { schema: URL_BODY },
        'application/octet-stream': { schema: { format: 'binary', type: 'string' } },
        'application/pdf': { schema: { format: 'binary', type: 'string' } },
      },
      description: 'The PDF itself, or the address to fetch it from.',
      required: true,
    },
    responses: {
      201: jsonResponse('Stored and put on the card.', object({ manual: ref('Manual') })),
      409: jsonResponse('That document is already on this card.', ref('Error')),
      413: jsonResponse('The file is larger than this server keeps.', ref('Error')),
      415: jsonResponse('The bytes are not a PDF.', ref('Error')),
      422: jsonResponse('The address would not download.', ref('Error')),
      ...errors(400, 401, 403, 404, 503),
    },
    route: 'POST /api/tools/:id/manuals',
    summary: 'Add a document to a card',
    tag: 'manuals',
  },
  {
    description:
      'The documents a product page offers, read by the same scripts that import a whole card — so a shop this server cannot read is refused here in the same words, and at most eight are taken (a page offering thirty is listing somebody’s whole catalogue).\n\nOnly sources that publish documents at all are accepted. Fetching a shop’s page to say afterwards that it has no manuals is a round trip nobody needed, which is what `manuals` on `GET /api/tools/import/sources` is for.\n\nOne document that will not download does not lose the others; `failed` reports each. When every one fails the status is 422 and nothing was stored.',
    operationId: 'addToolManualsFromPage',
    pathParams: { id: 'The tool card.' },
    requestBody: jsonBody(URL_BODY, 'The product page to read.'),
    responses: {
      201: jsonResponse('At least one document was stored.', ref('ManualImportResponse')),
      400: jsonResponse(
        'The body did not parse, or the address is from a source this server cannot read — or can read but which publishes no documents. The message names the ones that do.',
        ref('Error'),
      ),
      422: jsonResponse(
        'The page would not load, is not a product page, publishes no documents, or every one of them failed to download.',
        object(
          {
            error: { type: 'string' },
            failed: arrayOf(object({ error: { type: 'string' }, url: { type: 'string' } })),
          },
          ['error'],
        ),
      ),
      ...errors(401, 403, 404, 503),
    },
    route: 'POST /api/tools/:id/manuals/from-page',
    summary: 'Take the documents a product page publishes',
    tag: 'manuals',
  },
  {
    description:
      'Documents the catalog already has. The same PDF belongs on every card of that model, and attaching costs a row rather than a second copy of a 7 MB file.',
    operationId: 'attachToolManuals',
    pathParams: { id: 'The tool card.' },
    requestBody: jsonBody(ID_LIST),
    responses: {
      201: jsonResponse(
        'How many were newly attached, and the card’s documents as they now stand.',
        ref('ManualAttachResponse'),
      ),
      ...errors(400, 401, 403, 404, 503),
    },
    route: 'POST /api/tools/:id/manuals/attach',
    summary: 'Put existing documents on a card',
    tag: 'manuals',
  },
  {
    description:
      'Renaming as this card calls it. The title is the only thing about a document anybody edits — everything else is a fact about the file.',
    operationId: 'renameToolManual',
    pathParams: {
      id: 'The tool card.',
      manualId: 'The document, which must be on this card.',
    },
    requestBody: jsonBody(ref('ManualTitleBody')),
    responses: {
      200: jsonResponse('The document, renamed.', object({ manual: ref('Manual') })),
      ...errors(400, 401, 403, 404, 503),
    },
    route: 'PATCH /api/tools/:id/manuals/:manualId',
    summary: 'Rename a document on a card',
    tag: 'manuals',
  },
  {
    description:
      'Off this card. The file stays as long as another card keeps it — to take a document out of the catalog entirely, use `POST /api/manuals/delete`.',
    operationId: 'removeToolManual',
    pathParams: {
      id: 'The tool card.',
      manualId: 'The document, which must be on this card.',
    },
    responses: {
      200: jsonResponse('Removed.', object({ ok: { const: true, type: 'boolean' } })),
      ...errors(401, 403, 404, 503),
    },
    route: 'DELETE /api/tools/:id/manuals/:manualId',
    summary: 'Take a document off a card',
    tag: 'manuals',
  },
  {
    description:
      'The shelf rather than the drawer. Every item carries the tools that keep it, because "what is this a manual for" is the question this screen exists to answer and asking it per row would be a query per document.\n\nA bad value in the query string is clamped or dropped rather than refused, like every other list here.',
    operationId: 'listManualLibrary',
    query: [
      queryParam('q', 'Matches the document and the tools that keep it.', { type: 'string' }),
      limitParam(MANUAL_PAGING),
      OFFSET_PARAM,
    ],
    responses: {
      200: jsonResponse('A page of documents.', ref('ManualLibraryPage')),
      ...errors(401, 403, 503),
    },
    route: 'GET /api/manuals',
    summary: 'Every document, with the tools that keep it',
    tag: 'manuals',
  },
  {
    description:
      'Renaming from the library, where the document is not being looked at through any one card.',
    operationId: 'renameManual',
    pathParams: { id: 'The document.' },
    requestBody: jsonBody(ref('ManualTitleBody')),
    responses: {
      200: jsonResponse('The document, renamed.', object({ manual: ref('Manual') })),
      ...errors(400, 401, 403, 404, 503),
    },
    route: 'PATCH /api/manuals/:id',
    summary: 'Rename a document',
    tag: 'manuals',
  },
  {
    description:
      'Off every card at once and off the disk. A different decision from taking one off a single card, and made about several at a time — which is why it is a batch and why it is capped at fifty.\n\n`tools` names the cards the delete took a document from, so a screen showing them can say so rather than quietly refreshing.',
    operationId: 'deleteManuals',
    requestBody: jsonBody(ID_LIST),
    responses: {
      200: jsonResponse('What was removed, and from where.', ref('ManualDeleteResponse')),
      ...errors(400, 401, 403, 503),
    },
    route: 'POST /api/manuals/delete',
    summary: 'Delete documents outright',
    tag: 'manuals',
  },
  {
    description:
      'The bytes, by the document’s own id rather than through a card, because the same document belongs to several and none of them owns it.\n\nServed to be **read on the spot** rather than downloaded: `content-disposition` is `inline`, and carries the title twice — a plain ASCII form any client can read, and `filename*` with the real one for those that can.',
    operationId: 'getManualFile',
    pathParams: { id: 'The document.' },
    responses: {
      200: binaryResponse('The PDF.', 'application/pdf'),
      ...errors(401, 403, 404),
    },
    route: 'GET /api/manuals/:id/file',
    summary: 'The document itself',
    tag: 'manuals',
  },
]
