// The ToolTrack API process: a plain node:http server that adapts each request
// to a web Request, matches it against the table in matchRoute, runs it past
// the access guard, and writes the handler's Response back out.
//
// There is no framework. Route modules export functions from Request to
// Response, which means every handler can be called directly from a test with
// a Request built by hand, and the whole routing surface is one readable list
// rather than an assembly of middleware whose order decides the behaviour.

import { createServer } from 'node:http'
import type { IncomingMessage } from 'node:http'

import 'dotenv/config'

import { preflightResponse, withCorsHeaders } from './cors'
import { routeErrorResponse } from './pg-error-response'
import { readRequestBody, requestUrl } from './request-body-limit'
import { enforceRoutePolicy } from './route-guard'
import type { RouteHandler } from './route-context'
import * as auth from './routes/auth'
import * as tools from './routes/tools'
import * as users from './routes/users'
import * as version from './routes/version'
import { writeResponse } from './write-response'

type Method = 'DELETE' | 'GET' | 'OPTIONS' | 'PATCH' | 'POST' | 'PUT'

type RouteMatch = {
  // The methods this path implements, for the Allow header of a 405.
  allow: string[]
  // null when the path exists but not with this method.
  handler: null | RouteHandler
  params: Record<string, string>
}

const DEFAULT_PORT = 37411

const TOOL_DETAIL_PATTERN = /^\/api\/tools\/(\d+)$/
const USER_DETAIL_PATTERN = /^\/api\/users\/(\d+)$/

// Every path the router answers. Also the body of the 404, because the most
// common reason to see one is a client calling a path that moved.
const ROUTES = [
  'GET /healthz',
  'GET /api/version',
  'POST /api/auth/register',
  'POST /api/auth/login',
  'POST /api/auth/logout',
  'GET /api/auth/me',
  'PATCH /api/auth/password',
  'GET /api/tools',
  'POST /api/tools',
  'GET /api/tools/categories',
  'GET /api/tools/:id',
  'PATCH /api/tools/:id',
  'DELETE /api/tools/:id',
  'GET /api/users',
  'PATCH /api/users/:id',
  'DELETE /api/users/:id',
] as const

const server = createServer(async (req, res) => {
  let request: null | Request = null

  try {
    // The URL is parsed once, here, and the same one is used for the body cap
    // and for the Request the router matches, so the two can never disagree
    // about which path this is.
    const url = requestUrl(req, `localhost:${port}`)
    const body = await readRequestBody(req)
    if (!body.ok) {
      await writeResponse(res, body.response)
      return
    }

    request = toRequest(req, url, body.body)

    // Preflight is answered before routing: the browser sends OPTIONS to a
    // path it has not been allowed to call yet, and the answer is about CORS,
    // not about this route.
    const preflight = preflightResponse(request)
    if (preflight) {
      await writeResponse(res, preflight)
      return
    }

    const match = matchRoute(url.pathname, request.method)
    if (!match) {
      await writeResponse(
        res,
        withCorsHeaders(
          Response.json({ error: 'Not found', routes: ROUTES }, { status: 404 }),
          request,
        ),
      )
      return
    }

    // A known path asked with the wrong method is answered here, before the
    // guard, so that a client fixing its call gets told what to fix instead of
    // a flat 403. It reveals that the path exists, which the 404 body above
    // already lists anyway.
    if (!match.handler) {
      await writeResponse(
        res,
        withCorsHeaders(
          Response.json(
            { error: 'Method not allowed' },
            { headers: { allow: match.allow.join(', ') }, status: 405 },
          ),
          request,
        ),
      )
      return
    }

    // Central access enforcement. It runs after the route is known, so an
    // unknown path still 404s, and before any handler, so no route can be
    // reached without being classified in src/access/route-policy.ts.
    const guard = await enforceRoutePolicy(request)
    if (!guard.ok) {
      await writeResponse(res, withCorsHeaders(guard.response, request))
      return
    }

    const response = await match.handler(request, { params: match.params, user: guard.user })
    await writeResponse(res, withCorsHeaders(response, request))
  } catch (error) {
    const response = routeErrorResponse('api', error)
    await writeResponse(res, request ? withCorsHeaders(response, request) : response)
  }
})

const port = Number.parseInt(process.env.PORT ?? '', 10) || DEFAULT_PORT

server.listen(port, () => {
  console.log(`[api] listening on http://localhost:${port}`)
})

function matchRoute(pathname: string, method: string): null | RouteMatch {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname

  if (path === '/healthz') return methodHandler(method, { GET: healthz })
  if (path === '/api/version') return methodHandler(method, { GET: version.GET })

  if (path === '/api/auth/register') return methodHandler(method, { POST: auth.register })
  if (path === '/api/auth/login') return methodHandler(method, { POST: auth.login })
  if (path === '/api/auth/logout') return methodHandler(method, { POST: auth.logout })
  if (path === '/api/auth/me') return methodHandler(method, { GET: auth.me })
  if (path === '/api/auth/password') return methodHandler(method, { PATCH: auth.changePassword })

  // Above the :id route on purpose: the id pattern is digits only, so
  // "categories" could not be mistaken for one, but the reading order should
  // match the routing order anyway.
  if (path === '/api/tools/categories') return methodHandler(method, { GET: tools.categoriesGET })
  if (path === '/api/tools') return methodHandler(method, { GET: tools.GET, POST: tools.POST })

  const toolDetail = TOOL_DETAIL_PATTERN.exec(path)
  if (toolDetail) {
    return methodHandler(
      method,
      { DELETE: tools.detailDELETE, GET: tools.detailGET, PATCH: tools.detailPATCH },
      { id: toolDetail[1] },
    )
  }

  if (path === '/api/users') return methodHandler(method, { GET: users.GET })

  const userDetail = USER_DETAIL_PATTERN.exec(path)
  if (userDetail) {
    return methodHandler(
      method,
      { DELETE: users.detailDELETE, PATCH: users.detailPATCH },
      { id: userDetail[1] },
    )
  }

  return null
}

function methodHandler(
  method: string,
  handlers: Partial<Record<Method, RouteHandler>>,
  params: Record<string, string> = {},
): RouteMatch {
  return {
    allow: Object.keys(handlers).sort(),
    handler: handlers[method.toUpperCase() as Method] ?? null,
    params,
  }
}

// Liveness only. It answers without touching Postgres, because a probe that
// fails when the database is briefly unreachable restarts a container that was
// about to recover on its own. Database trouble is reported per request, as a
// 503 from pg-error-response.ts.
function healthz(): Response {
  return Response.json({ ok: true })
}

function toRequest(req: IncomingMessage, url: URL, body: undefined | Uint8Array): Request {
  return new Request(url, {
    body,
    headers: headersFromIncoming(req),
    method: req.method,
  })
}

function headersFromIncoming(req: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
    } else if (value !== undefined) {
      headers.set(key, value)
    }
  }
  return headers
}
