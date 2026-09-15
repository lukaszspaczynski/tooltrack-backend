// Reading a product page into a card. The shops this server can read are in
// src/server/importers; the dialog asks this API which they are rather than
// keeping a list of its own, so an installation never offers a source it
// cannot actually read.

import { errors, jsonBody, jsonResponse, object, type OperationSpec, ref } from '../operation'

const IMPORT_URL_BODY = jsonBody(ref('ImportUrlBody'), 'The address of the page to read.')

export const IMPORT_OPERATIONS: OperationSpec[] = [
  {
    description:
      'What the import dialog lists before asking for an address. `manuals` says whether that source publishes documents at all: a shop sells the item and leaves the manual to the maker, so a screen asking for one offers only the sources that have any.',
    operationId: 'listImportSources',
    responses: {
      200: jsonResponse(
        'The pages this server can read.',
        object({ sources: { items: ref('ImportSource'), type: 'array' } }),
      ),
      ...errors(401, 403),
    },
    route: 'GET /api/items/import/sources',
    summary: 'The sources that can be imported from',
    tag: 'import',
  },
  {
    description: [
      'The address decides which script reads the page, and an address from a host this server has never been taught to read is refused rather than guessed at — a page nobody has written a reader for would produce a card full of empty fields.',
      '',
      'The card is the thing being asked for, so a parameter or a photograph that fails does not fail the import: what could not be read is reported beside the card in `imported` rather than instead of it. The serial number is deliberately left blank, because the page describes a model and a serial number is one physical machine.',
      '',
      'Every imported card carries a `referenceUrl` holding the address it was read from, with any analytics tail removed. A field on the card rather than a parameter on its sheet: a card has exactly one, and the analytics tail a shop adds to a shared link is not part of it.',
    ].join('\n'),
    operationId: 'importItem',
    requestBody: IMPORT_URL_BODY,
    responses: {
      201: jsonResponse('The card, and what came with it.', ref('ImportResponse')),
      400: jsonResponse(
        'The body did not parse, or the address is from a host this server cannot read. The message names the ones it can.',
        ref('Error'),
      ),
      ...errors(401, 403, 422, 503),
    },
    route: 'POST /api/items/import',
    summary: 'Import a card from a product page',
    tag: 'import',
  },
  {
    description: [
      'Reads the page again into a card that already exists. What a product page knows, it overwrites: the maker, the model, the category, the description, the whole spec sheet and the documents.',
      '',
      'What it cannot know, it leaves alone — the name somebody gave this card, the serial number of this particular machine, its condition, and the photographs, which somebody may well have taken themselves. `imported.photos` is therefore always 0 here, and saying so beats a client wondering whether they were quietly replaced.',
      '',
      'The parameters and the documents are cleared and written again rather than merged: the page is the source of truth for what a machine is, so a parameter the maker has dropped should leave the card.',
    ].join('\n'),
    operationId: 'refreshItemFromPage',
    pathParams: { id: 'The card to read the page into.' },
    requestBody: IMPORT_URL_BODY,
    responses: {
      200: jsonResponse(
        'The card as it now stands, and what the page changed.',
        ref('ImportResponse'),
      ),
      ...errors(400, 401, 403, 404, 422, 503),
    },
    route: 'POST /api/items/:id/import',
    summary: 'Read the page again into an existing card',
    tag: 'import',
  },
]
