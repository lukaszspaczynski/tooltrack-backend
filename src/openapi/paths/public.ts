// The two endpoints a load balancer and a deploy pipeline ask for, and the
// document describing all the others. None of them needs a session.

import {
  arrayOf,
  errors,
  jsonBody,
  jsonResponse,
  object,
  type OperationSpec,
  ref,
} from '../operation'

export const PUBLIC_OPERATIONS: OperationSpec[] = [
  {
    description:
      'Liveness only, and deliberately never touches Postgres: a probe that fails during a brief database blip restarts a container that was about to recover. Database trouble is reported per request, as a 503.',
    operationId: 'getHealth',
    responses: {
      200: jsonResponse('The process is up.', object({ ok: { const: true, type: 'boolean' } })),
    },
    route: 'GET /healthz',
    summary: 'Liveness probe',
    tag: 'public',
  },
  {
    description:
      'The commit is passed into the image at build time and reads `unknown` for a plain `docker build`. `startedAt` is when this process came up, which is how you tell a restart from a redeploy.',
    operationId: 'getVersion',
    responses: {
      200: jsonResponse(
        'What is running.',
        object({
          commit: { type: 'string' },
          startedAt: { format: 'date-time', type: 'string' },
          version: { type: 'string' },
        }),
      ),
    },
    route: 'GET /api/version',
    summary: 'What is running',
    tag: 'public',
  },
  {
    description:
      'Swagger UI pointed at this API’s own document, vendored rather than loaded from a CDN — an authenticated screen pulling a megabyte of JavaScript from somebody else’s host is a supply chain nobody chose.\n\n**Try it out works.** The page is served from the API’s own origin, so the session cookie is first-party and the browser attaches it: log in through the app in another tab and the calls on this page are that session’s.',
    operationId: 'getDocs',
    responses: {
      200: {
        content: { 'text/html': { schema: { type: 'string' } } },
        description: 'The documentation page.',
      },
    },
    route: 'GET /api/docs',
    summary: 'Browse this API',
    tag: 'public',
  },
  {
    description: 'The Swagger UI stylesheet and bundle, from an allowlist of two.',
    operationId: 'getDocsAsset',
    pathParams: {
      asset: { description: 'A file name, never a path.', schema: { type: 'string' } },
    },
    responses: {
      200: {
        content: {
          'application/javascript': { schema: { type: 'string' } },
          'text/css': { schema: { type: 'string' } },
        },
        description: 'The asset.',
      },
      404: jsonResponse('No asset by that name.', ref('Error')),
    },
    route: 'GET /api/docs/:asset',
    summary: 'A file the documentation page needs',
    tag: 'public',
  },
  {
    description:
      'This document, served by the API it describes, so a client always reads the contract of the instance it is talking to rather than one checked in beside it.',
    operationId: 'getOpenapiDocument',
    responses: {
      200: jsonResponse('The OpenAPI 3.1 document.', { type: 'object' }),
    },
    route: 'GET /api/openapi.json',
    summary: 'The OpenAPI document',
    tag: 'public',
  },
]

export const AUTH_OPERATIONS: OperationSpec[] = [
  {
    description:
      'Always creates a viewer, whatever the body asks for: promotion is an administrator action and never a side effect of signing up. A display name is optional — without one the account is named after the part of the address before the @, which is a better placeholder than a blank row in the user list.',
    operationId: 'register',
    requestBody: jsonBody(ref('RegisterBody')),
    responses: {
      201: jsonResponse('The account, which is a viewer.', ref('SessionResponse')),
      ...errors(400, 409, 503),
    },
    route: 'POST /api/auth/register',
    summary: 'Create an account',
    tag: 'auth',
  },
  {
    description:
      'Sets the session cookie. The body is checked for presence rather than shape: telling somebody their address "looks wrong" at sign-in leaks which addresses this instance considers acceptable, so a bad address and a bad password are answered the same way.\n\nFailures are counted per address and per e-mail, and a caller over either limit is answered 429 with `Retry-After` before the password is looked at. Being refused does not extend the block, so somebody else\'s guessing cannot hold an account shut.',
    operationId: 'login',
    requestBody: jsonBody(ref('LoginBody')),
    responses: {
      200: jsonResponse(
        'Signed in. The session cookie is on the response.',
        ref('SessionResponse'),
      ),
      ...errors(400, 401, 429, 503),
    },
    route: 'POST /api/auth/login',
    summary: 'Sign in',
    tag: 'auth',
  },
  {
    description: 'Idempotent: logging out without a session is a 200, not an error.',
    operationId: 'logout',
    responses: {
      200: jsonResponse('Signed out, and the cookie cleared.', object({ ok: { type: 'boolean' } })),
    },
    route: 'POST /api/auth/logout',
    summary: 'Sign out',
    tag: 'auth',
  },
  {
    description:
      'The client renders its menu from `capabilities` rather than by comparing role strings of its own. That keeps one definition of what a role can do — here and in the guard — and avoids a UI that offers a button the API would refuse.',
    operationId: 'getCurrentUser',
    responses: {
      200: jsonResponse(
        'The account this session belongs to.',
        object({
          capabilities: arrayOf(ref('Capability')),
          effectiveRole: { anyOf: [ref('Role'), { type: 'null' }] },
          user: ref('User'),
        }),
      ),
      401: jsonResponse(
        'No session. The body is `{ "user": null }` rather than an error, so a client can ask this on load without treating a signed-out visitor as a failure.',
        object({ user: { type: 'null' } }),
      ),
    },
    route: 'GET /api/auth/me',
    summary: 'The account in hand',
    tag: 'auth',
  },
  {
    description:
      'The current password is required even though the session already proves who this is: it is what stops a borrowed, unlocked browser from becoming a permanent one.',
    operationId: 'changePassword',
    requestBody: jsonBody(ref('PasswordChangeBody')),
    responses: {
      200: jsonResponse('Changed.', object({ ok: { type: 'boolean' } })),
      ...errors(400, 401, 503),
    },
    route: 'PATCH /api/auth/password',
    summary: 'Change the password',
    tag: 'auth',
  },
  {
    description:
      'The language travels with the account rather than the browser, so a phone and a laptop agree about which one this person reads.',
    operationId: 'changeLanguage',
    requestBody: jsonBody(ref('LanguageBody')),
    responses: {
      200: jsonResponse('Changed.', object({ ok: { type: 'boolean' }, user: ref('User') })),
      ...errors(400, 401, 503),
    },
    route: 'PATCH /api/auth/language',
    summary: 'Change the interface language',
    tag: 'auth',
  },
]
