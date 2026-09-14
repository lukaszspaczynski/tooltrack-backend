// GET /api/docs — the contract, to read rather than to parse.
//
// Swagger UI pointed at /api/openapi.json, served from this API rather than
// from a CDN. Vendored for the same reason the label fonts and the one CA
// certificate are: a page that needs the public internet to render is a page
// that does not render on a site with no internet, and an authenticated screen
// pulling a megabyte of JavaScript from somebody else's host is a supply chain
// nobody chose.
//
// Public, like /healthz and /api/openapi.json, and for the same reason: a
// person opening the documentation has not logged in yet, and it shows nothing
// the document itself does not.
//
// **Try it out works.** The page is served from the API's own origin, so the
// session cookie is first-party and the browser attaches it — which is what
// `withCredentials` below asks Swagger UI to do. Log in through the app in
// another tab and the calls on this page are that session's. That is also why
// this is a route rather than a separate static site: a site on its own origin
// would be a CORS and cookie problem for the one feature worth having.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { errorResponse } from '../error-codes'
import type { RouteContext } from '../route-context'

const require = createRequire(import.meta.url)
const DIST = join(require.resolve('swagger-ui-dist/package.json'), '..')

// An allowlist rather than a path joined from the request. `:asset` cannot
// contain a slash, but the rule that decides which files leave this server
// should be a list of files and not the absence of a character.
const ASSETS: Record<string, { file: string; type: string }> = {
  'swagger-ui-bundle.js': { file: 'swagger-ui-bundle.js', type: 'application/javascript' },
  'swagger-ui.css': { file: 'swagger-ui.css', type: 'text/css' },
}

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ToolTrack API</title>
    <link rel="stylesheet" href="/api/docs/swagger-ui.css" />
    <style>
      body { margin: 0 }
      .swagger-ui .topbar { display: none }
    </style>
  </head>
  <body>
    <div id="ui"></div>
    <script src="/api/docs/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        dom_id: '#ui',
        url: '/api/openapi.json',
        // The session cookie is httpOnly and first-party here, so the browser
        // attaches it and "Try it out" runs as whoever is logged in.
        withCredentials: true,
        docExpansion: 'none',
        defaultModelsExpandDepth: 0,
        tryItOutEnabled: true,
      })
    </script>
  </body>
</html>
`

export async function GET(): Promise<Response> {
  return new Response(PAGE, {
    headers: { 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8' },
  })
}

export async function assetGET(_request: Request, context: RouteContext): Promise<Response> {
  const asset = ASSETS[context.params.asset ?? '']
  if (!asset) return errorResponse(404, 'NOT_FOUND', 'No such asset')

  return new Response(readFileSync(join(DIST, asset.file)), {
    headers: {
      // The files change only when the dependency does, and the dependency is
      // pinned. A day is long enough to be worth having and short enough that
      // an upgrade is visible without anybody clearing a cache.
      'cache-control': 'public, max-age=86400',
      'content-type': asset.type,
    },
  })
}
