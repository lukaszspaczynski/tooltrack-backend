// What every endpoint shares: how a caller authenticates, how a failure comes
// back, and the query parameters that mean the same thing on every list.

import { ERROR_CODES } from '../server/error-codes'
import { ITEM_PAGING, type Paging } from '../server/routes/paging'
import { jsonResponse, object, queryParam, ref } from './operation'
import type { Parameter, Response, Schema } from './types'

export const SECURITY_SCHEMES: Record<string, Schema> = {
  // The token from POST /api/auth/token, carried by hand. For a client that is
  // not a browser: there is no page, so nothing can read a token out of a
  // response, and no cookie jar worth depending on.
  bearerAuth: {
    description:
      'Opaque session token from `POST /api/auth/token`, sent as `Authorization: Bearer <token>`. The same session a cookie carries — same expiry, same revocation — and it wins over a cookie when both are present.',
    scheme: 'bearer',
    type: 'http',
  },
  // A session cookie, set by POST /api/auth/login and cleared by logout. It is
  // httpOnly, so a browser client never reads it and never sends it by hand —
  // `credentials: 'include'` is the whole of what a fetch has to do.
  sessionCookie: {
    description:
      'Session cookie set by `POST /api/auth/login`. httpOnly, and marked Secure when the server runs with NODE_ENV=production.',
    in: 'cookie',
    name: 'tooltrack_session',
    type: 'apiKey',
  },
}

// The error body, which is the same object everywhere.
//
// Two fields with two different jobs. `error` is prose for a person and arrives
// in the language the request asked for, so it is the one field a client must
// never branch on. `code` is the stable name of the failure: never translated,
// never reworded, and the same whichever route produced it — a client that
// handles SERIAL_NUMBER_TAKEN once handles it on the create and the edit alike.
//
// The enum is the catalogue in src/server/error-codes.ts, read rather than
// copied, so a code the server can return and the contract does not mention is
// impossible: adding one changes this document, and `npm run openapi:check`
// fails until it is rebuilt.
export const ERROR_SCHEMA: Schema = object({
  code: {
    description: [
      'The stable name of the failure. Branch on this, not on `error`.',
      '',
      ...Object.entries(ERROR_CODES).map(([code, what]) => `- \`${code}\` — ${what}`),
    ].join('\n'),
    enum: Object.keys(ERROR_CODES),
    type: 'string',
  },
  error: {
    description:
      'What went wrong, written for a person and translated to the language of the Accept-Language header. Not a stable identifier.',
    type: 'string',
  },
})

// Only the ones an operation actually points at. A 415 is not here: every
// route that can produce one describes it in its own words — "the bytes are not
// an image this server can decode" says more than a shared sentence about
// content types, because on those routes the header was never what decided.
const FAILURE: Record<number, string> = {
  400: 'The body or the query string did not parse. `error` says which field and why.',
  401: 'No session, or a session that has expired. Log in and retry.',
  403: 'Authenticated, but the account does not hold the capability this route needs.',
  404: 'No such record, or none this account may see.',
  409: 'The write conflicts with one already stored — a serial number, an e-mail or a parameter name that is taken.',
  413: 'The request body is larger than this route accepts.',
  422: 'The request was well formed, but something it depends on elsewhere failed — a page that would not load, a file that would not decode.',
  426: 'This build of the client is older than the floor this server answers. The body carries `minimum`, the build to update to. Sent only to a caller that identified itself with `X-ToolTrack-Client`; the public routes never send it, so a stale build can still read /api/version and the contract.',
  429: 'Too many failed sign-ins from this address, or against this e-mail. `Retry-After` carries the seconds to wait; the same answer is given whether or not an account by that name exists.',
  503: 'The database is unreachable. The request itself was fine; retry it.',
}

export const ERROR_RESPONSES: Record<string, Response> = Object.fromEntries(
  Object.entries(FAILURE).map(([status, description]) => [
    status,
    jsonResponse(description, ref('Error')),
  ]),
)

// Paging, built from the object the parser clamps with, so the ceiling the
// contract publishes is the ceiling the server enforces. `ITEM_PAGING` and its
// neighbours live in src/server/routes/paging.ts.
export function limitParam(paging: Paging): Parameter {
  return queryParam(
    'limit',
    'How many records to return. A value above the maximum is clamped rather than refused.',
    { default: paging.default, maximum: paging.max, minimum: 1, type: 'integer' },
    paging.default,
  )
}

export const LIMIT_PARAM: Parameter = limitParam(ITEM_PAGING)

export const OFFSET_PARAM: Parameter = queryParam(
  'offset',
  'How many records to skip, for paging.',
  { default: 0, minimum: 0, type: 'integer' },
  0,
)

// Asked for on every request, not just the ones that can fail: it decides the
// language of every message this API writes, including the successful ones.
export const ACCEPT_LANGUAGE_PARAM: Parameter = {
  description:
    'Picks the language of any prose this API returns. `pl` and `en` are understood; anything else falls back to Polish.',
  example: 'pl',
  in: 'header',
  name: 'Accept-Language',
  schema: { enum: ['pl', 'en'], type: 'string' },
}

// Sent by a client that can be too old to be answered, which is a client that
// ships on its own schedule rather than with the server. Optional and always
// has been: every build that exists today sends nothing, and a server that
// refused those would be refusing its own web client.
export const CLIENT_PARAM: Parameter = {
  description:
    'Which build is calling, as `name/version` — `mobile/1.4.2`. Logged the first time each build is seen, which is how "may the old field go yet" gets an answer. When `TOOLTRACK_MIN_CLIENT` names a floor for this client and the build is under it, every route but the public ones answers 426.',
  example: 'mobile/1.4.2',
  in: 'header',
  name: 'X-ToolTrack-Client',
  schema: { pattern: '^[A-Za-z][A-Za-z0-9-]*/\\d+(\\.\\d+){0,3}$', type: 'string' },
}

export const TAGS = [
  { description: 'Liveness and what is running. No session needed.', name: 'public' },
  { description: 'Registering, logging in, and the account in hand.', name: 'auth' },
  { description: 'The item cards themselves, and their parameters.', name: 'items' },
  { description: 'Reading a product page into a card.', name: 'import' },
  { description: 'Photographs, wherever they hang.', name: 'photos' },
  { description: 'The documents that belong beside an item.', name: 'manuals' },
  { description: 'Cases, and the slots a label goes in.', name: 'cases' },
  { description: 'Organizers, and what is placed in them.', name: 'organizers' },
  { description: 'Where the kit is kept: a workshop, a yard, a site.', name: 'addresses' },
  { description: 'Makers, and their logos.', name: 'brands' },
  { description: 'Drawing and reprinting labels.', name: 'labels' },
  { description: 'Server-wide and per-account settings.', name: 'settings' },
  { description: 'Who may reach what.', name: 'users' },
]
