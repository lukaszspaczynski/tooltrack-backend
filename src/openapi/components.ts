// What every endpoint shares: how a caller authenticates, how a failure comes
// back, and the query parameters that mean the same thing on every list.

import { jsonResponse, object, queryParam, ref } from './operation'
import type { Parameter, Response, Schema } from './types'

export const SECURITY_SCHEMES: Record<string, Schema> = {
  // A session cookie, set by POST /api/auth/login and cleared by logout. It is
  // httpOnly, so a browser client never reads it and never sends it by hand —
  // `credentials: 'include'` is the whole of what a fetch has to do. A client
  // that is not a browser has to keep a cookie jar.
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
// The message is prose meant for a person, and it arrives in the language the
// request asked for — so it is the one field a client must never branch on.
// Until this API carries a stable code beside it, what a client can rely on is
// the status.
export const ERROR_SCHEMA: Schema = object({
  error: {
    description:
      'What went wrong, written for a person and translated to the language of the Accept-Language header. Not a stable identifier: branch on the status code.',
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
  503: 'The database is unreachable. The request itself was fine; retry it.',
}

export const ERROR_RESPONSES: Record<string, Response> = Object.fromEntries(
  Object.entries(FAILURE).map(([status, description]) => [
    status,
    jsonResponse(description, ref('Error')),
  ]),
)

// Paging, which every list route spells the same way.
export const LIMIT_PARAM: Parameter = queryParam(
  'limit',
  'How many records to return.',
  { default: 50, maximum: 200, minimum: 1, type: 'integer' },
  50,
)

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

export const TAGS = [
  { description: 'Liveness and what is running. No session needed.', name: 'public' },
  { description: 'Registering, logging in, and the account in hand.', name: 'auth' },
  { description: 'The tool cards themselves, and their parameters.', name: 'tools' },
  { description: 'Reading a product page into a card.', name: 'import' },
  { description: 'Photographs, wherever they hang.', name: 'photos' },
  { description: 'The documents that belong beside a tool.', name: 'manuals' },
  { description: 'Cases, and the slots a label goes in.', name: 'cases' },
  { description: 'Organizers, and what is placed in them.', name: 'organizers' },
  { description: 'Makers, and their logos.', name: 'brands' },
  { description: 'Drawing and reprinting labels.', name: 'labels' },
  { description: 'Server-wide and per-account settings.', name: 'settings' },
  { description: 'Who may reach what.', name: 'users' },
]
