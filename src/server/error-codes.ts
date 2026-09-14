// The stable name of every failure this API can report.
//
// `error` is prose: it is written for a person and it arrives in the language
// the request asked for, so a client that branches on it breaks the first time
// somebody switches to English or rewords a message. The status code is stable
// but blunt — four different conflicts all answer 409, and a client that has to
// tell "this serial number is taken" from "this is the last active admin" can
// only do it by reading Polish.
//
// `code` is what a client branches on. It never changes and it is never
// translated. One list, here, so that adding a failure means naming it: the
// OpenAPI document enumerates this object, so a code that exists in the code
// and not in the contract fails `npm run openapi:check`.
//
// The names are the failure, not the route. `SERIAL_NUMBER_TAKEN` is the same
// fact whether it came from a create or an edit, and a client that handles it
// once handles it everywhere.

export const ERROR_CODES = {
  // The request itself
  INVALID_BODY: 'The body did not parse, or a field is out of range.',
  INVALID_QUERY: 'A query parameter names something impossible.',
  BODY_TOO_LARGE: 'The request body is over the route’s ceiling.',
  UNSUPPORTED_MEDIA_TYPE: 'The bytes are not a format this route can read.',
  METHOD_NOT_ALLOWED: 'The path exists, but not with this method. See the Allow header.',

  // Who is asking
  UNAUTHENTICATED: 'No session, or one that has expired.',
  FORBIDDEN: 'A session, but not the capability this route needs.',
  ACCOUNT_DISABLED: 'The account exists but has been switched off.',
  INVALID_CREDENTIALS: 'The e-mail and password do not match an account.',

  // Not there
  NOT_FOUND: 'No such record, or none this account may see.',
  TOOL_NOT_FOUND: 'No such tool card.',
  CASE_NOT_FOUND: 'No such case.',
  ORGANIZER_NOT_FOUND: 'No such organizer.',
  BRAND_NOT_FOUND: 'No such maker.',
  USER_NOT_FOUND: 'No such account.',
  PHOTO_NOT_FOUND: 'No such photograph, or its file is gone.',
  MANUAL_NOT_FOUND: 'No such document, or its file is gone.',
  LABEL_NOT_FOUND: 'No such label, or its file is gone.',
  SEARCH_ENGINE_NOT_FOUND: 'No search engine or cutout method by that name.',
  LABEL_SLOT_NOT_FOUND: 'This case has no such label slot.',
  TOOL_NOT_IN_ORGANIZER: 'That tool is not in this organizer.',

  // Already there
  EMAIL_TAKEN: 'An account with that e-mail already exists.',
  SERIAL_NUMBER_TAKEN: 'Another card already carries that serial number.',
  ATTRIBUTE_NAME_TAKEN: 'This card already has a parameter with that name.',
  BRAND_NAME_TAKEN: 'A maker with that name already exists.',
  LOGO_TAKEN: 'That picture is already another maker’s logo.',
  LABEL_SLOT_TAKEN: 'This case already has a slot that size.',
  ORGANIZER_NUMBER_TAKEN: 'Another organizer already has that number.',
  TOOL_ALREADY_IN_ORGANIZER: 'That tool is in another organizer already.',
  PHOTO_ALREADY_ON_CARD: 'That photograph is already on this card.',
  MANUAL_ALREADY_ON_CARD: 'That document is already on this card.',

  // The last two ways an admin can lock everybody out
  LAST_ACTIVE_ADMIN: 'The change would leave the installation with no admin.',
  SELF_ROLE_CHANGE: 'An account cannot change or delete itself here.',

  // Something elsewhere did not work
  PAGE_UNREACHABLE: 'The product page would not load.',
  NOT_A_PRODUCT_PAGE: 'There is no product card at that address.',
  UNSUPPORTED_SOURCE: 'No importer can read that host.',
  NO_SOURCE_PAGE: 'This card was not imported, so there is no page to read.',
  SOURCE_HAS_NO_MANUALS: 'That source publishes no documents.',
  DOWNLOAD_FAILED: 'Every address in the request failed to download.',
  IMAGE_UNREADABLE: 'The bytes are not an image this server can decode.',
  NOT_A_PDF: 'The bytes are not a PDF.',
  CUTOUT_UNSUITABLE: 'The picture is not one this method can cut out.',
  CUTOUT_UNAVAILABLE: 'No cutout method is configured and enabled.',
  PREVIEW_EXPIRED: 'The preview has been swept, or is damaged.',
  LABEL_UNDRAWABLE: 'The label cannot be drawn from what the catalog says now.',
  SEARCH_UNAVAILABLE: 'No search engine is configured and enabled.',
  ATTACH_FAILED: 'None of the selected records could be attached.',

  // The server, rather than the request
  DATABASE_UNAVAILABLE: 'Postgres is unreachable. The request was fine; retry.',
  INTERNAL: 'Something went wrong that the caller cannot act on.',
} as const

export type ErrorCode = keyof typeof ERROR_CODES

// The body every failure has. `code` is the contract; `error` is for the
// person reading the screen.
export type ErrorBody = {
  code: ErrorCode
  error: string
}

// One way to build a failure, so that none can be built without a code.
//
// `extra` is for the routes that report what happened to each of several
// things — a photo import says which addresses failed beside the message.
// `headers` is for the one failure that carries one: a 405 has to say what the
// path does allow.
export function errorResponse(
  status: number,
  code: ErrorCode,
  error: string,
  options: { extra?: Record<string, unknown>; headers?: Record<string, string> } = {},
): Response {
  return Response.json({ code, error, ...options.extra }, { headers: options.headers, status })
}
