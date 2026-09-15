// The ToolTrack API process: a plain node:http server that adapts each request
// to a web Request, matches it against the table in matchRoute, runs it past
// the access guard, and writes the handler's Response back out.
//
// There is no framework. Route modules export functions from Request to
// Response, which means every handler can be called directly from a test with
// a Request built by hand, and the whole routing surface is one readable list
// rather than an assembly of middleware whose order decides the behaviour.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

import 'dotenv/config'

import { preflightResponse, withCorsHeaders } from './cors'
import { errorResponse } from './error-codes'
import { routeErrorResponse } from './pg-error-response'
import { startPreviewSweeping } from './photo-storage'
import { clientAddress } from './client-address'
import { CLIENT_HEADER, noteClient } from './client-version'
import { readRequestBody, requestUrl } from './request-body-limit'
import { parseAcceptLanguage, withLanguage } from './i18n'
import { enforceRoutePolicy } from './route-guard'
import { ROUTES } from './route-list'
import { writeResponse } from './write-response'

type Method = 'DELETE' | 'GET' | 'OPTIONS' | 'PATCH' | 'POST' | 'PUT'

import { matchRoute, type RouteMatch } from './router'

const DEFAULT_PORT = 37411

const server = createServer(async (req, res) => {
  // Everything this request does happens inside the language it asked for, so
  // a handler, a store or a body parser can say something in it without the
  // language being threaded through all three as a parameter. See i18n/index.
  await withLanguage(parseAcceptLanguage(req.headers['accept-language']), () => answer(req, res))
})

async function answer(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let request: null | Request = null

  try {
    // The URL is parsed once, here, and the same one is used for the body cap
    // and for the Request the router matches, so the two can never disagree
    // about which path this is.
    const url = requestUrl(req, `localhost:${port}`)
    const body = await readRequestBody(req, url.pathname)
    if (!body.ok) {
      await writeResponse(res, body.response)
      return
    }

    request = toRequest(req, url, body.body)

    // One line the first time each build calls, and nothing after. Before any
    // floor is set this is the whole point of the header: "can the old field go
    // yet" is a question the log answers and guessing does not.
    noteClient(req.headers[CLIENT_HEADER])

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
          errorResponse(404, 'NOT_FOUND', 'Not found', { extra: { routes: ROUTES } }),
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
          errorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed', {
            headers: { allow: match.allow.join(', ') },
          }),
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

    const response = await match.handler(request, {
      // Read from the socket here rather than from the Request: the headers on
      // that object came from the caller, so a client could otherwise announce
      // its own address to a counter that exists to limit it.
      clientAddress: clientAddress(req.socket.remoteAddress, req.headers['x-forwarded-for']),
      params: match.params,
      user: guard.user,
    })
    await writeResponse(res, withCorsHeaders(response, request))
  } catch (error) {
    const response = routeErrorResponse('api', error)
    await writeResponse(res, request ? withCorsHeaders(response, request) : response)
  }
}

const port = Number.parseInt(process.env.PORT ?? '', 10) || DEFAULT_PORT

server.listen(port, () => {
  console.log(`[api] listening on http://localhost:${port}`)
})

// Expired cutout previews are cleared on a timer as well as when one is
// written: otherwise the last previews of an afternoon would sit on disk until
// somebody used the feature again, which might be next week.
startPreviewSweeping()

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
