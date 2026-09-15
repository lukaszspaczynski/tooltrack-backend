// The item cards themselves, and the parameters under one.
//
// Two conventions run through the whole domain and are worth reading once
// rather than in eleven descriptions.
//
// Every write answers with the **whole card**, not the row that changed. A
// screen showing the spec sheet does not then have to merge one parameter into
// a list it already holds, and cannot end up displaying a card assembled from
// two different moments.
//
// An id that is not digits is a **404 rather than a 400**. The client was given
// that URL by a link; telling it to fix a request it did not compose is no help,
// and "no such item" is what actually happened.

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
import { LIMIT_PARAM, OFFSET_PARAM } from '../components'
import { ITEM_CONDITIONS, ITEM_KINDS } from '../../server/routes/items-input'

const CARD = jsonResponse('The card, with its parameters.', object({ item: ref('ItemDetail') }))

export const ITEM_OPERATIONS: OperationSpec[] = [
  {
    description:
      'A page of cards for the grid. Every item carries two things the card itself does not: `primaryPhotoUrl` for the thumbnail, and `organizer` saying where the item lies — both fetched for the whole page in one query rather than per row, because this list is read on a phone.\n\nA bad value in the query string is clamped or dropped rather than refused: a link somebody pasted with `?limit=banana` should still show the catalog. The one exception is `condition`, where a value naming no condition is a 400 — silently listing every item would look like an answer rather than a typo.',
    operationId: 'listItems',
    query: [
      queryParam('q', 'Free-text search over the card.', { type: 'string' }, 'młot'),
      queryParam('category', 'Exact category, as the cards spell it.', { type: 'string' }),
      queryParam(
        'kind',
        'Only cards of this sort. `case` is how the boxes screen asks for the boxes: they are cards like any other and `GET /api/items` includes them.',
        { enum: [...ITEM_KINDS], type: 'string' },
      ),
      queryParam(
        'attributes',
        'Set to `1` to have every card carry its spec sheet. Off by default — a grid shows a name, a maker and a condition, and sending every sheet to draw that would be paying for what nobody reads. The boxes screen turns it on: what somebody scanning a shelf of boxes is choosing between is the measurements and what goes in.',
        { enum: ['1'], type: 'string' },
        '1',
      ),
      queryParam(
        'model',
        'Exact model, as the cards spell it. A filter picked from `GET /api/items/models` rather than typed, which is why it matches the whole string where `q` matches part of one.',
        { type: 'string' },
        'PRO',
      ),
      queryParam('condition', 'Only cards in this condition.', {
        enum: [...ITEM_CONDITIONS],
        type: 'string',
      }),
      queryParam(
        'inOrganizer',
        'Absent lists everything. `false` lists only items that are in no organizer, which is what the organizer wizard offers.',
        { type: 'boolean' },
      ),
      queryParam(
        'sort',
        'Newest edit first by default: the catalog is used most right after somebody changed something in it.',
        { default: 'updatedAt', enum: ['updatedAt', 'createdAt', 'name'], type: 'string' },
      ),
      queryParam('order', 'Direction.', { default: 'desc', enum: ['desc', 'asc'], type: 'string' }),
      LIMIT_PARAM,
      OFFSET_PARAM,
    ],
    responses: {
      200: jsonResponse('A page of cards.', ref('ItemListPage')),
      400: jsonResponse('`condition` names no condition this catalog has.', ref('Error')),
      ...errors(401, 403, 503),
    },
    route: 'GET /api/items',
    summary: 'List item cards',
    tag: 'items',
  },
  {
    description:
      'A new card arrives with no parameters, and `attributes` comes back as an empty array rather than absent — saying so beats leaving the client to work out whether the field is missing or empty.',
    operationId: 'createItem',
    requestBody: jsonBody(
      ref('ItemCreateBody'),
      'Only `name` is required; the rest default to blank.',
    ),
    responses: {
      201: jsonResponse('The new card.', object({ item: ref('ItemDetail') })),
      409: jsonResponse('Another card already carries that serial number.', ref('Error')),
      ...errors(400, 401, 403, 503),
    },
    route: 'POST /api/items',
    summary: 'Create an item card',
    tag: 'items',
  },
  {
    description:
      'Read from the cards themselves rather than from a table of categories, so the list is what is actually in use. That is the list to offer in a filter.',
    operationId: 'listItemCategories',
    responses: {
      200: jsonResponse(
        'Every category in use, with how many cards carry it.',
        object({ categories: arrayOf(ref('CategoryCount')) }),
      ),
      ...errors(401, 403, 503),
    },
    route: 'GET /api/items/categories',
    summary: 'The categories in use',
    tag: 'items',
  },
  {
    description:
      'Read from the cards themselves rather than from a table of models, so the list is what is actually on the shelf. `?kind=case` is what the boxes screen asks: a workshop owns nine of the same Qbrick and one of everything else, so the model is the filter that means something there.',
    operationId: 'listItemModels',
    query: [
      queryParam('kind', 'Only the models of cards of this sort.', {
        enum: [...ITEM_KINDS],
        type: 'string',
      }),
    ],
    responses: {
      200: jsonResponse(
        'Every model in use, with how many cards carry it.',
        object({ models: arrayOf(ref('ModelCount')) }),
      ),
      ...errors(401, 403, 503),
    },
    route: 'GET /api/items/models',
    summary: 'The models in use',
    tag: 'items',
  },
  {
    description:
      'What the form offers while somebody types a parameter name, most used first. Read from the cards for the same reason the category list is: the names in use are the vocabulary, and "napięcie sieciowe" typed the same way on every card is what makes the catalog answerable later. Names differing only in case or spacing count as one.',
    operationId: 'listItemAttributeNames',
    responses: {
      200: jsonResponse(
        'Every parameter name in use, with how many cards carry it.',
        object({ names: arrayOf(ref('AttributeNameCount')) }),
      ),
      ...errors(401, 403, 503),
    },
    route: 'GET /api/items/attributes',
    summary: 'The parameter names in use',
    tag: 'items',
  },
  {
    description:
      'The card with its whole spec sheet. The list answers with the card alone: a grid shows a name, a maker and a condition, and sending every card’s parameters to draw that would be paying for what nobody reads.',
    operationId: 'getItem',
    pathParams: { id: 'The card.' },
    responses: { 200: CARD, ...errors(401, 403, 404, 503) },
    route: 'GET /api/items/:id',
    summary: 'One item card',
    tag: 'items',
  },
  {
    description:
      'Only the fields present in the body are touched. `""` and absent are different on purpose: clearing the brand is a real edit, and a PATCH that could not express it would force the client to resend the whole card. A body with no editable field at all is a 400 rather than a no-op that looks to the screen like it saved something.',
    operationId: 'updateItem',
    pathParams: { id: 'The card to edit.' },
    requestBody: jsonBody(
      ref('ItemPatchBody'),
      'The fields to change, and only those. At least one.',
    ),
    responses: {
      200: CARD,
      409: jsonResponse('Another card already carries that serial number.', ref('Error')),
      ...errors(400, 401, 403, 404, 503),
    },
    route: 'PATCH /api/items/:id',
    summary: 'Edit an item card',
    tag: 'items',
  },
  {
    description:
      'The pictures and documents no other card uses go with it; one that another card still shows stays, which is the whole point of storing them as links.\n\nDeleting a card that is already gone answers 404 rather than 200. It is the outcome the caller wanted either way, but two people clearing the same row from two phones should not both be told they did it.',
    operationId: 'deleteItem',
    pathParams: { id: 'The card to delete.' },
    responses: {
      200: jsonResponse('Deleted.', object({ ok: { const: true, type: 'boolean' } })),
      ...errors(401, 403, 404, 503),
    },
    route: 'DELETE /api/items/:id',
    summary: 'Delete an item card',
    tag: 'items',
  },
  {
    description:
      'Everything is copied except the serial number, which identifies one physical machine: the copy starts blank there, so the person filling it in is the one who read the plate.\n\nThe photographs and the documents come along as links to the same files — two of the same model look alike and read the same manual, and a link costs a row rather than a second 7 MB PDF.',
    operationId: 'duplicateItem',
    pathParams: { id: 'The card to copy.' },
    responses: {
      201: jsonResponse('The copy.', object({ item: ref('ItemDetail') })),
      ...errors(401, 403, 404, 503),
    },
    route: 'POST /api/items/:id/duplicate',
    summary: 'Duplicate an item card',
    tag: 'items',
  },
  {
    description:
      'One line off a rating plate: mains voltage, speed, chuck, weight. Both halves are required and neither may be blank — a parameter with no name says nothing, and one with no value is a question rather than an answer.\n\nRuns of whitespace inside either half collapse to a single space, because the index that keeps names unique folds case and trims the ends; without it "napięcie  sieciowe" would sit on the card beside "napięcie sieciowe".',
    operationId: 'addItemAttribute',
    pathParams: { id: 'The card to add the parameter to.' },
    requestBody: jsonBody(
      object({
        name: { maxLength: 80, minLength: 1, type: 'string' },
        value: {
          description: 'Carries its unit — "230 V" rather than 230.',
          maxLength: 200,
          minLength: 1,
          type: 'string',
        },
      }),
    ),
    responses: {
      201: CARD,
      409: jsonResponse('This card already carries a parameter with that name.', ref('Error')),
      ...errors(400, 401, 403, 404, 503),
    },
    route: 'POST /api/items/:id/attributes',
    summary: 'Add a parameter to a card',
    tag: 'items',
  },
  {
    description:
      'A typo in the name, or a value read off the plate again. Sending neither is refused rather than answered with the row unchanged. A parameter that is not this card’s reads the same as one that never existed.',
    operationId: 'updateItemAttribute',
    pathParams: {
      attributeId: 'The parameter, which must belong to this card.',
      id: 'The card the parameter is on.',
    },
    requestBody: jsonBody({
      additionalProperties: false,
      minProperties: 1,
      properties: {
        name: { maxLength: 80, minLength: 1, type: 'string' },
        value: { maxLength: 200, minLength: 1, type: 'string' },
      },
      type: 'object',
    }),
    responses: {
      200: CARD,
      409: jsonResponse('This card already carries a parameter with that name.', ref('Error')),
      ...errors(400, 401, 403, 404, 503),
    },
    route: 'PATCH /api/items/:id/attributes/:attributeId',
    summary: 'Edit a parameter',
    tag: 'items',
  },
  {
    description: 'Answers with the card, so the screen holding the spec sheet can redraw it whole.',
    operationId: 'deleteItemAttribute',
    pathParams: {
      attributeId: 'The parameter, which must belong to this card.',
      id: 'The card the parameter is on.',
    },
    responses: { 200: CARD, ...errors(401, 403, 404, 503) },
    route: 'DELETE /api/items/:id/attributes/:attributeId',
    summary: 'Delete a parameter',
    tag: 'items',
  },
  {
    description:
      'Where a label goes on a box: a size and nothing else, width by height in whole millimetres, and neither may be zero — a slot with no width is not a slot.\n\nOnly a case has any, and that is a constraint rather than a check: the slot carries a `kind` fixed to `case` and points at `(id, kind)` on the card, so the database refuses a drill a place for a sticker — and refuses turning a box that has slots into something else.\n\nThe whole card comes back rather than the slot, because the screen shows the slots together and would otherwise have to merge one into a list it already holds.',
    operationId: 'addItemLabelSlot',
    pathParams: { id: 'The case.' },
    requestBody: jsonBody(ref('LabelSlotBody')),
    responses: {
      201: CARD,
      409: jsonResponse(
        'This card is not a case, or it already has a slot that size.',
        ref('Error'),
      ),
      ...errors(400, 401, 403, 404, 503),
    },
    route: 'POST /api/items/:id/label-slots',
    summary: 'Add a label slot to a case',
    tag: 'items',
  },
  {
    description: 'Answers with the card, so the screen holding the slots can redraw it whole.',
    operationId: 'removeItemLabelSlot',
    pathParams: { id: 'The case.', slotId: 'The slot, which must be this card’s.' },
    responses: { 200: CARD, ...errors(401, 403, 404, 503) },
    route: 'DELETE /api/items/:id/label-slots/:slotId',
    summary: 'Remove a label slot',
    tag: 'items',
  },
]
