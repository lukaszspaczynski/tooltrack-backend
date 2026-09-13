// The ToolTrack API process: a plain node:http server that adapts each request
// to a web Request, matches it against the table in matchRoute, runs it past
// the access guard, and writes the handler's Response back out.
//
// There is no framework. Route modules export functions from Request to
// Response, which means every handler can be called directly from a test with
// a Request built by hand, and the whole routing surface is one readable list
// rather than an assembly of middleware whose order decides the behaviour.

import { createServer, type ServerResponse } from 'node:http'
import type { IncomingMessage } from 'node:http'

import 'dotenv/config'

import { preflightResponse, withCorsHeaders } from './cors'
import { routeErrorResponse } from './pg-error-response'
import { startPreviewSweeping } from './photo-storage'
import { readRequestBody, requestUrl } from './request-body-limit'
import { parseAcceptLanguage, withLanguage } from './i18n'
import { enforceRoutePolicy } from './route-guard'
import type { RouteHandler } from './route-context'
import * as auth from './routes/auth'
import * as brands from './routes/brands'
import * as cases from './routes/cases'
import * as labels from './routes/labels'
import * as media from './routes/media'
import * as organizers from './routes/organizers'
import * as photos from './routes/photos'
import * as settings from './routes/settings'
import * as toolImport from './routes/tool-import'
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
const TOOL_DUPLICATE_PATTERN = /^\/api\/tools\/(\d+)\/duplicate$/
const TOOL_ATTRIBUTES_PATTERN = /^\/api\/tools\/(\d+)\/attributes$/
const TOOL_ATTRIBUTE_PATTERN = /^\/api\/tools\/(\d+)\/attributes\/(\d+)$/
const BRAND_DETAIL_PATTERN = /^\/api\/brands\/(\d+)$/
const BRAND_LOGO_PATTERN = /^\/api\/brands\/(\d+)\/logo$/
const ORGANIZER_DETAIL_PATTERN = /^\/api\/organizers\/(\d+)$/
const ORGANIZER_LABEL_SLOTS_PATTERN = /^\/api\/organizers\/(\d+)\/label-slots$/
const ORGANIZER_LABELS_PATTERN = /^\/api\/organizers\/(\d+)\/labels$/
const ORGANIZER_LABEL_REFRESH_PATTERN = /^\/api\/organizers\/(\d+)\/labels\/refresh$/
const ORGANIZER_LABEL_FILE_PATTERN = /^\/api\/organizers\/(\d+)\/labels\/(\d+)\/file$/
const ORGANIZER_LABEL_PREVIEW_PATTERN = /^\/api\/organizers\/(\d+)\/labels\/(\d+)\/preview$/
const ORGANIZER_LABEL_PATTERN = /^\/api\/organizers\/(\d+)\/labels\/(\d+)$/
const ORGANIZER_TOOLS_PATTERN = /^\/api\/organizers\/(\d+)\/tools$/
const ORGANIZER_TOOL_PATTERN = /^\/api\/organizers\/(\d+)\/tools\/(\d+)$/
const CASE_DETAIL_PATTERN = /^\/api\/cases\/(\d+)$/
const CASE_LABEL_SLOTS_PATTERN = /^\/api\/cases\/(\d+)\/label-slots$/
const CASE_LABEL_SLOT_PATTERN = /^\/api\/cases\/(\d+)\/label-slots\/(\d+)$/

// Photos belong to a tool or to a case on identical terms, so one set of
// patterns serves both. Group 1 is the segment — "tools" or "cases" — which
// routes/photo-owner.ts reads back into an owner; nothing downstream branches
// on it again.
const OWNER = '(tools|cases)'
const PHOTOS_PATTERN = new RegExp(`^/api/${OWNER}/(\\d+)/photos$`)
const PHOTO_PATTERN = new RegExp(`^/api/${OWNER}/(\\d+)/photos/(\\d+)$`)
const PHOTO_FILE_PATTERN = new RegExp(`^/api/${OWNER}/(\\d+)/photos/(\\d+)/file$`)
const PHOTO_ATTACH_PATTERN = new RegExp(`^/api/${OWNER}/(\\d+)/photos/attach$`)
const PHOTO_CUTOUT_PATTERN = new RegExp(`^/api/${OWNER}/(\\d+)/photos/(\\d+)/cutout$`)
const CUTOUT_PREVIEW_PATTERN = new RegExp(`^/api/${OWNER}/(\\d+)/photos/(\\d+)/cutout/preview$`)
const CUTOUT_PREVIEW_FILE_PATTERN = new RegExp(
  `^/api/${OWNER}/(\\d+)/photos/(\\d+)/cutout/preview/([0-9a-f]{64})$`,
)
const CUTOUT_COMMIT_PATTERN = new RegExp(`^/api/${OWNER}/(\\d+)/photos/(\\d+)/cutout/commit$`)
const SUGGESTIONS_PATTERN = new RegExp(`^/api/${OWNER}/(\\d+)/photo-suggestions$`)
// A photo by its own id, which is the only way to reach one with no owner.
const LIBRARY_FILE_PATTERN = /^\/api\/photos\/(\d+)\/file$/
const GLOBAL_ENGINE_PATTERN = /^\/api\/settings\/search-engines\/([a-z]+)$/
const MY_ENGINE_PATTERN = /^\/api\/me\/search-engines\/([a-z]+)$/
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
  'PATCH /api/auth/language',
  'GET /api/tools',
  'POST /api/tools',
  'GET /api/tools/categories',
  'GET /api/tools/attributes',
  'GET /api/tools/import/sources',
  'POST /api/tools/import',
  'POST /api/tools/:id/attributes',
  'PATCH /api/tools/:id/attributes/:attributeId',
  'DELETE /api/tools/:id/attributes/:attributeId',
  'GET /api/tools/:id',
  'PATCH /api/tools/:id',
  'DELETE /api/tools/:id',
  'POST /api/tools/:id/duplicate',
  'GET /api/tools/:id/photos',
  'POST /api/tools/:id/photos',
  'POST /api/tools/:id/photos/attach',
  'GET /api/tools/:id/photos/:photoId/file',
  'PATCH /api/tools/:id/photos/:photoId',
  'DELETE /api/tools/:id/photos/:photoId',
  'POST /api/tools/:id/photos/:photoId/cutout',
  'POST /api/tools/:id/photos/:photoId/cutout/preview',
  'GET /api/tools/:id/photos/:photoId/cutout/preview/:checksum',
  'POST /api/tools/:id/photos/:photoId/cutout/commit',
  'GET /api/tools/:id/photo-suggestions',
  'GET /api/cases',
  'POST /api/cases',
  'GET /api/cases/systems',
  'GET /api/cases/:id',
  'PATCH /api/cases/:id',
  'DELETE /api/cases/:id',
  'POST /api/cases/:id/label-slots',
  'DELETE /api/cases/:id/label-slots/:slotId',
  'GET /api/cases/:id/photos',
  'POST /api/cases/:id/photos',
  'POST /api/cases/:id/photos/attach',
  'GET /api/cases/:id/photos/:photoId/file',
  'PATCH /api/cases/:id/photos/:photoId',
  'DELETE /api/cases/:id/photos/:photoId',
  'POST /api/cases/:id/photos/:photoId/cutout',
  'POST /api/cases/:id/photos/:photoId/cutout/preview',
  'GET /api/cases/:id/photos/:photoId/cutout/preview/:checksum',
  'POST /api/cases/:id/photos/:photoId/cutout/commit',
  'GET /api/cases/:id/photo-suggestions',
  'GET /api/brands',
  'POST /api/brands',
  'GET /api/brands/:id',
  'PATCH /api/brands/:id',
  'DELETE /api/brands/:id',
  'PUT /api/brands/:id/logo',
  'DELETE /api/brands/:id/logo',
  'GET /api/organizers',
  'POST /api/organizers',
  'GET /api/organizers/:id',
  'PATCH /api/organizers/:id',
  'DELETE /api/organizers/:id',
  'POST /api/organizers/:id/tools',
  'DELETE /api/organizers/:id/tools/:toolId',
  'GET /api/organizers/:id/label-slots',
  'POST /api/organizers/:id/labels',
  'POST /api/organizers/:id/labels/refresh',
  'GET /api/organizers/:id/labels/:labelId/file',
  'GET /api/organizers/:id/labels/:labelId/preview',
  'DELETE /api/organizers/:id/labels/:labelId',
  'GET /api/labels',
  'GET /api/labels/sheet',
  'POST /api/labels/refresh',
  'GET /api/settings/search-engines',
  'PATCH /api/settings/search-engines/:provider',
  'PATCH /api/me/search-engines/:provider',
  'GET /api/settings/cutout',
  'PATCH /api/settings/cutout',
  'PATCH /api/settings/cutout/:method',
  'GET /api/photos',
  'POST /api/photos',
  'GET /api/photos/:id/file',
  'POST /api/photos/delete',
  'GET /api/users',
  'PATCH /api/users/:id',
  'DELETE /api/users/:id',
] as const

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
}

const port = Number.parseInt(process.env.PORT ?? '', 10) || DEFAULT_PORT

server.listen(port, () => {
  console.log(`[api] listening on http://localhost:${port}`)
})

// Expired cutout previews are cleared on a timer as well as when one is
// written: otherwise the last previews of an afternoon would sit on disk until
// somebody used the feature again, which might be next week.
startPreviewSweeping()

function matchRoute(pathname: string, method: string): null | RouteMatch {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname

  if (path === '/healthz') return methodHandler(method, { GET: healthz })
  if (path === '/api/version') return methodHandler(method, { GET: version.GET })

  if (path === '/api/auth/register') return methodHandler(method, { POST: auth.register })
  if (path === '/api/auth/login') return methodHandler(method, { POST: auth.login })
  if (path === '/api/auth/logout') return methodHandler(method, { POST: auth.logout })
  if (path === '/api/auth/me') return methodHandler(method, { GET: auth.me })
  if (path === '/api/auth/password') return methodHandler(method, { PATCH: auth.changePassword })
  if (path === '/api/auth/language') return methodHandler(method, { PATCH: auth.changeLanguage })

  // Above the :id route on purpose: the id pattern is digits only, so
  // "categories" could not be mistaken for one, but the reading order should
  // match the routing order anyway.
  if (path === '/api/tools/categories') return methodHandler(method, { GET: tools.categoriesGET })
  if (path === '/api/tools/attributes') {
    return methodHandler(method, { GET: tools.attributeNamesGET })
  }
  // Both above /api/tools/:id, which would otherwise read "import" as an id.
  if (path === '/api/tools/import/sources') {
    return methodHandler(method, { GET: toolImport.sourcesGET })
  }
  if (path === '/api/tools/import') return methodHandler(method, { POST: toolImport.POST })
  if (path === '/api/tools') return methodHandler(method, { GET: tools.GET, POST: tools.POST })

  // Same ordering rule as categories above: the list of systems before the
  // pattern that would read "systems" as the name of a case.
  if (path === '/api/brands') {
    return methodHandler(method, { GET: brands.GET, POST: brands.POST })
  }

  // Longest first, as everywhere in this table.
  const brandLogo = BRAND_LOGO_PATTERN.exec(path)
  if (brandLogo) {
    return methodHandler(
      method,
      { DELETE: brands.logoDELETE, PUT: brands.logoPUT },
      { id: brandLogo[1] },
    )
  }

  const brandDetail = BRAND_DETAIL_PATTERN.exec(path)
  if (brandDetail) {
    return methodHandler(
      method,
      { DELETE: brands.detailDELETE, GET: brands.detailGET, PATCH: brands.detailPATCH },
      { id: brandDetail[1] },
    )
  }

  if (path === '/api/organizers') {
    return methodHandler(method, { GET: organizers.GET, POST: organizers.POST })
  }

  // Every label there is, whichever organizer made it. Above the per-organizer
  // label paths only for readability: neither can match the other's path.
  if (path === '/api/labels/refresh') {
    return methodHandler(method, { POST: labels.refreshPOST })
  }

  if (path === '/api/labels/sheet') return methodHandler(method, { GET: labels.sheetGET })

  if (path === '/api/labels') return methodHandler(method, { GET: labels.GET })

  // Longest first, as everywhere in this table. `refresh` sits above the
  // :labelId patterns, though those only match digits, so it could not be
  // mistaken for a label anyway.
  const labelRefresh = ORGANIZER_LABEL_REFRESH_PATTERN.exec(path)
  if (labelRefresh) {
    return methodHandler(method, { POST: organizers.labelRefreshPOST }, { id: labelRefresh[1] })
  }

  const labelFile = ORGANIZER_LABEL_FILE_PATTERN.exec(path)
  if (labelFile) {
    return methodHandler(
      method,
      { GET: organizers.labelFileGET },
      { id: labelFile[1], labelId: labelFile[2] },
    )
  }

  const labelPreview = ORGANIZER_LABEL_PREVIEW_PATTERN.exec(path)
  if (labelPreview) {
    return methodHandler(
      method,
      { GET: organizers.labelPreviewGET },
      { id: labelPreview[1], labelId: labelPreview[2] },
    )
  }

  const organizerLabel = ORGANIZER_LABEL_PATTERN.exec(path)
  if (organizerLabel) {
    return methodHandler(
      method,
      { DELETE: organizers.labelDELETE },
      { id: organizerLabel[1], labelId: organizerLabel[2] },
    )
  }

  const organizerLabels = ORGANIZER_LABELS_PATTERN.exec(path)
  if (organizerLabels) {
    return methodHandler(method, { POST: organizers.labelPOST }, { id: organizerLabels[1] })
  }

  const organizerLabelSlots = ORGANIZER_LABEL_SLOTS_PATTERN.exec(path)
  if (organizerLabelSlots) {
    return methodHandler(method, { GET: organizers.labelSlotsGET }, { id: organizerLabelSlots[1] })
  }

  const organizerTool = ORGANIZER_TOOL_PATTERN.exec(path)
  if (organizerTool) {
    return methodHandler(
      method,
      { DELETE: organizers.toolDELETE },
      { id: organizerTool[1], toolId: organizerTool[2] },
    )
  }

  const organizerTools = ORGANIZER_TOOLS_PATTERN.exec(path)
  if (organizerTools) {
    return methodHandler(method, { POST: organizers.toolsPOST }, { id: organizerTools[1] })
  }

  const organizerDetail = ORGANIZER_DETAIL_PATTERN.exec(path)
  if (organizerDetail) {
    return methodHandler(
      method,
      {
        DELETE: organizers.detailDELETE,
        GET: organizers.detailGET,
        PATCH: organizers.detailPATCH,
      },
      { id: organizerDetail[1] },
    )
  }

  if (path === '/api/cases/systems') return methodHandler(method, { GET: cases.systemsGET })
  if (path === '/api/cases') return methodHandler(method, { GET: cases.GET, POST: cases.POST })

  // Longest first: /photos/7/file must not be read as the photo detail route.
  const photoFile = PHOTO_FILE_PATTERN.exec(path)
  if (photoFile) {
    return methodHandler(
      method,
      { GET: photos.fileGET },
      { id: photoFile[2], owner: photoFile[1], photoId: photoFile[3] },
    )
  }

  // Longest first, as everywhere in this table.
  const previewFile = CUTOUT_PREVIEW_FILE_PATTERN.exec(path)
  if (previewFile) {
    return methodHandler(
      method,
      { GET: photos.cutoutPreviewGET },
      {
        checksum: previewFile[4],
        id: previewFile[2],
        owner: previewFile[1],
        photoId: previewFile[3],
      },
    )
  }

  const preview = CUTOUT_PREVIEW_PATTERN.exec(path)
  if (preview) {
    return methodHandler(
      method,
      { POST: photos.cutoutPreviewPOST },
      { id: preview[2], owner: preview[1], photoId: preview[3] },
    )
  }

  const commit = CUTOUT_COMMIT_PATTERN.exec(path)
  if (commit) {
    return methodHandler(
      method,
      { POST: photos.cutoutCommitPOST },
      { id: commit[2], owner: commit[1], photoId: commit[3] },
    )
  }

  const cutout = PHOTO_CUTOUT_PATTERN.exec(path)
  if (cutout) {
    return methodHandler(
      method,
      { POST: photos.cutoutPOST },
      { id: cutout[2], owner: cutout[1], photoId: cutout[3] },
    )
  }

  const photoDetail = PHOTO_PATTERN.exec(path)
  if (photoDetail) {
    return methodHandler(
      method,
      { DELETE: photos.detailDELETE, PATCH: photos.detailPATCH },
      { id: photoDetail[2], owner: photoDetail[1], photoId: photoDetail[3] },
    )
  }

  const attach = PHOTO_ATTACH_PATTERN.exec(path)
  if (attach) {
    return methodHandler(method, { POST: photos.attachPOST }, { id: attach[2], owner: attach[1] })
  }

  const cardPhotos = PHOTOS_PATTERN.exec(path)
  if (cardPhotos) {
    return methodHandler(
      method,
      { GET: photos.listGET, POST: photos.POST },
      { id: cardPhotos[2], owner: cardPhotos[1] },
    )
  }

  const suggestions = SUGGESTIONS_PATTERN.exec(path)
  if (suggestions) {
    return methodHandler(
      method,
      { GET: photos.suggestionsGET },
      { id: suggestions[2], owner: suggestions[1] },
    )
  }

  // Longest first: the parameter's own path would otherwise be read as the
  // list's with a stray segment.
  const attribute = TOOL_ATTRIBUTE_PATTERN.exec(path)
  if (attribute) {
    return methodHandler(
      method,
      { DELETE: tools.attributeDELETE, PATCH: tools.attributePATCH },
      { attributeId: attribute[2], id: attribute[1] },
    )
  }

  const attributes = TOOL_ATTRIBUTES_PATTERN.exec(path)
  if (attributes) {
    return methodHandler(method, { POST: tools.attributePOST }, { id: attributes[1] })
  }

  const duplicate = TOOL_DUPLICATE_PATTERN.exec(path)
  if (duplicate) {
    return methodHandler(method, { POST: tools.duplicatePOST }, { id: duplicate[1] })
  }

  const toolDetail = TOOL_DETAIL_PATTERN.exec(path)
  if (toolDetail) {
    return methodHandler(
      method,
      { DELETE: tools.detailDELETE, GET: tools.detailGET, PATCH: tools.detailPATCH },
      { id: toolDetail[1] },
    )
  }

  // Longest first, as everywhere in this table.
  const labelSlot = CASE_LABEL_SLOT_PATTERN.exec(path)
  if (labelSlot) {
    return methodHandler(
      method,
      { DELETE: cases.labelSlotDELETE },
      { id: labelSlot[1], slotId: labelSlot[2] },
    )
  }

  const labelSlots = CASE_LABEL_SLOTS_PATTERN.exec(path)
  if (labelSlots) {
    return methodHandler(method, { POST: cases.labelSlotPOST }, { id: labelSlots[1] })
  }

  const caseDetail = CASE_DETAIL_PATTERN.exec(path)
  if (caseDetail) {
    return methodHandler(
      method,
      { DELETE: cases.detailDELETE, GET: cases.detailGET, PATCH: cases.detailPATCH },
      { id: caseDetail[1] },
    )
  }

  if (path === '/api/settings/search-engines') {
    return methodHandler(method, { GET: settings.enginesGET })
  }

  if (path === '/api/settings/cutout') {
    return methodHandler(method, { GET: settings.cutoutGET, PATCH: settings.cutoutPATCH })
  }

  const cutoutMethodPath = /^\/api\/settings\/cutout\/([a-z]+)$/.exec(path)
  if (cutoutMethodPath) {
    return methodHandler(
      method,
      { PATCH: settings.cutoutMethodPATCH },
      { method: cutoutMethodPath[1] },
    )
  }

  const globalEngine = GLOBAL_ENGINE_PATTERN.exec(path)
  if (globalEngine) {
    return methodHandler(
      method,
      { PATCH: settings.engineGlobalPATCH },
      { provider: globalEngine[1] },
    )
  }

  const myEngine = MY_ENGINE_PATTERN.exec(path)
  if (myEngine) {
    return methodHandler(method, { PATCH: settings.engineMinePATCH }, { provider: myEngine[1] })
  }

  // The library sits above /api/tools/… in the file only because it reads as
  // its own surface; the paths cannot collide.
  if (path === '/api/photos') {
    return methodHandler(method, { GET: media.GET, POST: media.uploadPOST })
  }

  const libraryFile = LIBRARY_FILE_PATTERN.exec(path)
  if (libraryFile) {
    return methodHandler(method, { GET: media.fileGET }, { id: libraryFile[1] })
  }
  if (path === '/api/photos/delete') return methodHandler(method, { POST: media.deletePOST })

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
