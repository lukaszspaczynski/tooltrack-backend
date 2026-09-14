// Photographs, wherever they hang.
//
// A case carries pictures on exactly the same terms as a tool, and one module
// in src/server/routes/photos.ts serves both — which of the two is in the path
// is the only difference that reaches the SQL. So the two families are written
// here once and produced twice, rather than copied: routes that are the same
// thing should not be able to drift apart in the contract either.
//
// Three things about this domain are unusual enough to be worth stating before
// the operations rather than inside each of them.
//
// **An upload is the raw file in the body**, with its own content-type, not
// `multipart/form-data`. One file per request needs no envelope, and
// `fetch(url, { body: file })` is less code than building a FormData — while
// parsing multipart by hand in a server with no framework is the kind of code
// that is wrong for a year before anybody notices. The same route also takes
// JSON, and the content-type is what picks between them.
//
// **The declared type is a claim**; the first bytes decide, and whatever they
// turn out to be is stored as PNG. A body announcing `image/png` that is really
// a PDF is a 415.
//
// **A cutout is two steps.** Preview runs the edit and caches the result
// without writing a photo, so one nobody accepts expires on its own; commit
// names that result by its checksum and turns it into a row. A save therefore
// costs no second call to a paid service to produce a picture the person has
// already looked at.

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

const PHOTO_SOURCES = ['upload', 'url', 'search', 'edit']
const CUTOUT_METHODS = ['local', 'removebg', 'gemini']

// The image types a raw upload may announce. Written out rather than left as
// `image/*`, because a generator turns each one into a callable content type
// and a wildcard into nothing it can use.
const UPLOAD_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

const RAW_IMAGE_CONTENT = Object.fromEntries(
  UPLOAD_CONTENT_TYPES.map((type) => [type, { schema: { format: 'binary', type: 'string' } }]),
)

// One address, or a batch ticked in the suggestion grid. Both go the same way,
// because "save the three I ticked" is "save this one" repeated.
const LINKS_SCHEMA: Schema = {
  anyOf: [
    object(
      {
        attribution: {
          description: 'Author and licence, carried through to the stored photo.',
          type: 'string',
        },
        url: { format: 'uri', type: 'string' },
      },
      ['url'],
    ),
    object({
      items: {
        items: object({ attribution: { type: 'string' }, url: { format: 'uri', type: 'string' } }, [
          'url',
        ]),
        maxItems: 30,
        minItems: 1,
        type: 'array',
      },
    }),
  ],
  description:
    'Either one `url`, or `items` picked from the suggestions. A link sent as `items` is recorded as having come from a search and one sent as `url` as a paste, because the card says which.',
}

const CUTOUT_RUN_BODY = jsonBody(
  {
    additionalProperties: false,
    description:
      'Overrides for this run only. Everything is optional, and an empty body — or none at all — uses the settings an admin configured.',
    properties: {
      method: { enum: CUTOUT_METHODS, type: 'string' },
      padding: { maximum: 200, minimum: 0, type: 'integer' },
      removeBgType: { enum: ['auto', 'product'], type: 'string' },
      threshold: {
        description: 'How light counts as background, summed over the three channels.',
        maximum: 765,
        minimum: 1,
        type: 'integer',
      },
    },
    type: 'object',
  },
  'Optional. Omit it entirely to use the configured settings.',
)

type Family = {
  // 'tools' or 'cases', as the path spells it.
  owner: string
  // What one of them is, for a path parameter description.
  card: string
  // Capitalised, for an operationId.
  suffix: string
}

const FAMILIES: Family[] = [
  { card: 'The tool card.', owner: 'tools', suffix: 'Tool' },
  { card: 'The case.', owner: 'cases', suffix: 'Case' },
]

function operationsFor({ card, owner, suffix }: Family): OperationSpec[] {
  const id = { id: card }
  const onPhoto = { id: card, photoId: 'The photograph, which must be on this card.' }

  return [
    {
      description:
        '`?exclusive=1` narrows it to the pictures this card is the only home of — what a delete confirmation needs, because "and its photographs" is not something anybody can weigh without a number, and that number is not the length of the gallery when another card shows half of it.',
      operationId: `list${suffix}Photos`,
      pathParams: id,
      query: [
        queryParam(
          'exclusive',
          'Set to `1` for only the pictures no other card shows.',
          { enum: ['1'], type: 'string' },
          '1',
        ),
      ],
      responses: {
        200: jsonResponse(
          'The gallery, main photograph first.',
          object({ photos: arrayOf(ref('CardPhoto')) }),
        ),
        ...errors(401, 403, 404, 503),
      },
      route: `GET /api/${owner}/:id/photos`,
      summary: 'List the photographs on a card',
      tag: 'photos',
    },
    {
      description:
        'Two requests in one, told apart by the content-type.\n\nWith an `image/*` body the bytes are the file: they are converted to PNG and stored, and the answer is `{ photo }`.\n\nWith `application/json` the body carries addresses this server fetches on the caller’s behalf, and the answer is `{ photos, failed }` — one bad link out of ten must not lose the other nine, so each failure is reported next to the address that caused it. When every link fails the status is 422 and nothing was stored.',
      operationId: `add${suffix}Photo`,
      pathParams: id,
      requestBody: {
        content: { ...RAW_IMAGE_CONTENT, 'application/json': { schema: LINKS_SCHEMA } },
        description: 'The file itself, or the addresses to fetch.',
        required: true,
      },
      responses: {
        201: jsonResponse(
          'Stored. An upload answers with `photo`; links answer with `photos` and whatever `failed`.',
          {
            anyOf: [
              object({ photo: ref('CardPhoto') }),
              object({
                failed: arrayOf(object({ error: { type: 'string' }, url: { type: 'string' } })),
                photos: arrayOf(ref('CardPhoto')),
              }),
            ],
          },
        ),
        409: jsonResponse('That photograph is already on this card.', ref('Error')),
        415: jsonResponse(
          'The bytes are not an image this server can decode, whatever the content-type claimed.',
          ref('Error'),
        ),
        422: jsonResponse(
          'Every address failed. `failed` says what happened to each.',
          object(
            {
              error: { type: 'string' },
              failed: arrayOf(object({ error: { type: 'string' }, url: { type: 'string' } })),
            },
            ['error'],
          ),
        ),
        ...errors(400, 401, 403, 404, 413, 503),
      },
      route: `POST /api/${owner}/:id/photos`,
      summary: 'Upload a photograph, or fetch one from an address',
      tag: 'photos',
    },
    {
      description:
        'The way out of the library’s unassigned shelf, and the other half of being able to upload a picture before deciding what it is. A photograph that belongs to nothing is moved onto this card, keeping its id; one that already belongs elsewhere is copied, which costs a row rather than a second file.\n\nNothing attached at all is a 409 — some of them failing is normal and reported per photograph.',
      operationId: `attach${suffix}Photos`,
      pathParams: id,
      requestBody: jsonBody(
        object({
          photoIds: {
            items: { minimum: 1, type: 'integer' },
            maxItems: 200,
            minItems: 1,
            type: 'array',
          },
        }),
      ),
      responses: {
        201: jsonResponse(
          'At least one was attached.',
          object({
            failed: arrayOf(object({ id: { type: 'integer' }, reason: { type: 'string' } })),
            photos: arrayOf(ref('CardPhoto')),
          }),
        ),
        409: jsonResponse(
          'None of them could be attached.',
          object(
            {
              error: { type: 'string' },
              failed: arrayOf(object({ id: { type: 'integer' }, reason: { type: 'string' } })),
            },
            ['error'],
          ),
        ),
        ...errors(400, 401, 403, 404, 503),
      },
      route: `POST /api/${owner}/:id/photos/attach`,
      summary: 'Put existing photographs on a card',
      tag: 'photos',
    },
    {
      description:
        'The bytes. Content-addressed behind a row id, so this response can never change and is served `immutable` for a year — but `private`, because the catalog is behind a login and a shared cache must not hold it. A row whose file is missing is a 404: a broken photograph, not a broken server.',
      operationId: `get${suffix}PhotoFile`,
      pathParams: onPhoto,
      responses: {
        200: binaryResponse('The image.', 'image/png'),
        ...errors(401, 403, 404),
      },
      route: `GET /api/${owner}/:id/photos/:photoId/file`,
      summary: 'The photograph itself',
      tag: 'photos',
    },
    {
      description:
        'Promoting is the only edit a photograph has: everything else about it — its size, its type, where it came from — is a fact about the file rather than a decision. Being the main one is a property of the pairing, so the same photograph can head one card and sit fourth on another.',
      operationId: `promote${suffix}Photo`,
      pathParams: onPhoto,
      requestBody: jsonBody(object({ isPrimary: { const: true, type: 'boolean' } })),
      responses: {
        200: jsonResponse('The photograph, now the main one.', object({ photo: ref('CardPhoto') })),
        ...errors(400, 401, 403, 404, 503),
      },
      route: `PATCH /api/${owner}/:id/photos/:photoId`,
      summary: 'Make a photograph the main one',
      tag: 'photos',
    },
    {
      description: 'Off this card, and off the disk if no other card shows it.',
      operationId: `remove${suffix}Photo`,
      pathParams: onPhoto,
      responses: {
        200: jsonResponse('Removed.', object({ ok: { const: true, type: 'boolean' } })),
        ...errors(401, 403, 404, 503),
      },
      route: `DELETE /api/${owner}/:id/photos/:photoId`,
      summary: 'Remove a photograph from a card',
      tag: 'photos',
    },
    {
      description:
        'The one-click edit: the thing alone, without the bench it was photographed on.\n\nIt **adds** a photograph rather than replacing one. The original stays and the two are linked by `derivedFrom`, so a cutout that mangled the tool is one delete away from undone. The new photograph does not become the main one on its own — whether the cutout is better than the photograph is a judgement, and the person looking at both makes it.\n\nThe default method needs no key and no service, and refuses with a 422 rather than returning half a cut-out workbench.',
      operationId: `cutout${suffix}Photo`,
      pathParams: onPhoto,
      responses: {
        201: jsonResponse(
          'The cutout, and which method produced it.',
          object({ photo: ref('CardPhoto'), provider: { enum: CUTOUT_METHODS, type: 'string' } }),
        ),
        422: jsonResponse(
          'The picture is not one this method can cut out — too busy a background, or nothing that reads as a single object.',
          ref('Error'),
        ),
        ...errors(401, 403, 404, 503),
      },
      route: `POST /api/${owner}/:id/photos/:photoId/cutout`,
      summary: 'Cut the subject out of a photograph',
      tag: 'photos',
    },
    {
      description:
        'Runs the cutout and hands back somewhere to look at it, without writing a photograph. The result goes into a cache that expires on its own, and `preview.checksum` is what `…/cutout/commit` takes to keep it.',
      operationId: `preview${suffix}Cutout`,
      pathParams: onPhoto,
      requestBody: CUTOUT_RUN_BODY,
      responses: {
        200: jsonResponse(
          'The cutout, cached rather than stored.',
          object({
            preview: object({
              byteSize: { type: 'integer' },
              checksum: {
                description: 'sha256 of the bytes. What commit names to keep them.',
                pattern: '^[0-9a-f]{64}$',
                type: 'string',
              },
              contentType: { type: 'string' },
              height: { type: ['integer', 'null'] },
              url: { type: 'string' },
              width: { type: ['integer', 'null'] },
            }),
            provider: { enum: CUTOUT_METHODS, type: 'string' },
          }),
        ),
        422: jsonResponse('The picture is not one this method can cut out.', ref('Error')),
        ...errors(400, 401, 403, 404, 503),
      },
      route: `POST /api/${owner}/:id/photos/:photoId/cutout/preview`,
      summary: 'Try a cutout without keeping it',
      tag: 'photos',
    },
    {
      description:
        'Addressed by checksum, so nothing here can serve a file that was not produced by a cutout somebody just ran. `cache-control` carries what is left of this preview’s life rather than a fresh TTL on every request: a browser holding a picture the server has already swept is how a save fails after a preview that still looked fine.',
      operationId: `get${suffix}CutoutPreview`,
      pathParams: {
        ...onPhoto,
        checksum: 'The `preview.checksum` the preview call answered with.',
      },
      responses: {
        200: binaryResponse('The preview image.', 'image/png'),
        404: jsonResponse('No such preview, or it has expired.', ref('Error')),
        ...errors(401, 403),
      },
      route: `GET /api/${owner}/:id/photos/:photoId/cutout/preview/:checksum`,
      summary: 'The preview image',
      tag: 'photos',
    },
    {
      description:
        'Keeps a preview. The bytes are already on disk; this is the row that turns them into a photograph of this card. Both stores are addressed by content, so the checksum — and the client’s idea of what it accepted — does not change.\n\nA preview that has expired, or comes from a tab left open since yesterday, is a 409: asked for again rather than half-saved.',
      operationId: `commit${suffix}Cutout`,
      pathParams: onPhoto,
      requestBody: jsonBody(
        object({ checksum: { pattern: '^[0-9a-f]{64}$', type: 'string' } }),
        'The checksum of a preview this server produced. Nothing else — naming the bytes by content is what makes a save unable to invent a photograph that was never previewed.',
      ),
      responses: {
        201: jsonResponse('Kept.', object({ photo: ref('CardPhoto') })),
        409: jsonResponse(
          'The preview has expired or is damaged, or that cutout is already on this card.',
          ref('Error'),
        ),
        ...errors(400, 401, 403, 404, 503),
      },
      route: `POST /api/${owner}/:id/photos/:photoId/cutout/commit`,
      summary: 'Keep a previewed cutout',
      tag: 'photos',
    },
    {
      description: [
        'Links and thumbnails, nothing downloaded: the client shows them, somebody ticks the ones that are actually this machine, and `POST …/photos` with those addresses is what puts bytes on our disk. It needs `catalog.write` for that reason — it is the first half of an edit.',
        '',
        'Without `q` the query is built from the card: a tool by its maker and model, a case by who makes it and what it is called.',
        '',
        'Every engine enabled for this account is asked in parallel and contributes its own share; one failing costs its results rather than the search, and `failed` says which. With no engine enabled at all the answer is 503 — the catalog is fine, this one integration is not.',
        suffix === 'Tool'
          ? '\n`?source=page` reads the product page this card was imported from instead of the engines. Not a search: the address is written on the card, so it is the one source that cannot return somebody else’s machine.'
          : '\n`?source=page` answers 422 here: a case is not imported from anywhere.',
      ].join('\n'),
      operationId: `suggest${suffix}Photos`,
      pathParams: id,
      query: [
        queryParam('q', 'What to search for. Defaults to a query built from the card.', {
          type: 'string',
        }),
        queryParam('source', 'Set to `page` for the product page instead of the engines.', {
          enum: ['page'],
          type: 'string',
        }),
      ],
      responses: {
        200: jsonResponse('What was found.', ref('PhotoSearchResult')),
        422: jsonResponse(
          'There is no product page to read: the card was not imported, or its address is from a source this server cannot read.',
          object({ error: { type: 'string' }, providers: arrayOf({ type: 'string' }) }, [
            'error',
            'providers',
          ]),
        ),
        503: jsonResponse(
          'No search engine is configured and enabled for this account.',
          object({ error: { type: 'string' }, providers: arrayOf({ type: 'string' }) }, [
            'error',
            'providers',
          ]),
        ),
        ...errors(401, 403, 404),
      },
      route: `GET /api/${owner}/:id/photo-suggestions`,
      summary: 'Where a picture of this card could come from',
      tag: 'photos',
    },
  ]
}

// The library: the same collection from the other side — every picture on disk
// with the card it belongs to, or with none.
const LIBRARY_OPERATIONS: OperationSpec[] = [
  {
    description:
      'Every photograph on disk, newest first, because the library is opened right after an import went wrong. `q` matches the tool a picture belongs to rather than the picture: a photograph has no name of its own, and "which tool was this" is the question people ask.',
    operationId: 'listLibraryPhotos',
    query: [
      queryParam('q', 'Matches the card the photograph belongs to.', { type: 'string' }),
      queryParam(
        'assigned',
        'Absent lists both. `false` is the shelf of pictures still waiting for a card.',
        { type: 'boolean' },
      ),
      queryParam('source', 'How the photograph arrived.', {
        enum: PHOTO_SOURCES,
        type: 'string',
      }),
      queryParam('order', 'Direction.', { default: 'desc', enum: ['desc', 'asc'], type: 'string' }),
      { ...LIMIT_PARAM, schema: { default: 48, maximum: 200, minimum: 1, type: 'integer' } },
      OFFSET_PARAM,
    ],
    responses: {
      200: jsonResponse('A page of photographs.', ref('LibraryPage')),
      400: jsonResponse(
        '`source` or `assigned` names something this catalog has no.',
        ref('Error'),
      ),
      ...errors(401, 403, 503),
    },
    route: 'GET /api/photos',
    summary: 'Every photograph, with or without a card',
    tag: 'photos',
  },
  {
    description:
      'An upload that belongs to no card. Pictures arrive before anybody decides what they are — a batch off a phone at the end of a day — and forcing a card at that moment is how photographs end up on the wrong one. They wait here instead, and `?assigned=false` finds them again.\n\nUnlike the per-card upload this does **not** refuse bytes that are already on disk: with no card there is no link to duplicate, so it answers with the picture that is there. A 409 would only make the client ask what to do about a fact nobody can change.',
    operationId: 'uploadLibraryPhoto',
    requestBody: {
      content: {
        ...RAW_IMAGE_CONTENT,
        'application/json': {
          schema: object(
            { attribution: { type: 'string' }, url: { format: 'uri', type: 'string' } },
            ['url'],
          ),
        },
      },
      required: true,
    },
    responses: {
      201: jsonResponse('Stored.', object({ photo: ref('Photo') })),
      415: jsonResponse('The bytes are not an image this server can decode.', ref('Error')),
      ...errors(400, 401, 403, 413, 422, 503),
    },
    route: 'POST /api/photos',
    summary: 'Upload a photograph with no card',
    tag: 'photos',
  },
  {
    description: 'The bytes, by the picture’s own id, because it is not reached through any card.',
    operationId: 'getLibraryPhotoFile',
    pathParams: { id: 'The photograph.' },
    responses: { 200: binaryResponse('The image.', 'image/png'), ...errors(401, 403, 404) },
    route: 'GET /api/photos/:id/file',
    summary: 'A photograph by its own id',
    tag: 'photos',
  },
  {
    description:
      'The library’s bin: deletes outright, from every card at once. A cap of two hundred keeps one mis-click from taking the whole library and keeps the transaction short.\n\n`deleted` can be lower than `requested` — somebody else may have removed a photograph between the screen loading and the button being pressed, and the client shows what actually happened rather than what was asked for. `promoted` names the cards that now show a different main picture.',
    operationId: 'deleteLibraryPhotos',
    requestBody: jsonBody(
      object({
        ids: {
          items: { minimum: 1, type: 'integer' },
          maxItems: 200,
          minItems: 1,
          type: 'array',
        },
      }),
    ),
    responses: {
      200: jsonResponse(
        'What was actually removed.',
        object({
          deleted: { type: 'integer' },
          promoted: arrayOf(ref('PhotoOwner')),
          requested: { type: 'integer' },
        }),
      ),
      ...errors(400, 401, 403, 503),
    },
    route: 'POST /api/photos/delete',
    summary: 'Delete photographs outright',
    tag: 'photos',
  },
]

export const PHOTO_OPERATIONS: OperationSpec[] = [
  ...FAMILIES.flatMap(operationsFor),
  ...LIBRARY_OPERATIONS,
]
