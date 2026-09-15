// Which path reaches which handler.
//
// A module of its own rather than part of index.ts, because a test that had to
// import index.ts to ask what a path resolves to would start a server
// listening on a port to find out. router.test.ts is that test, and it is what
// keeps this table and route-list.ts from describing different servers.
//
// The paths themselves are not written here. They are in ROUTES, compiled once
// by `compileRoute`, and this module only says what answers them — so a route
// exists as one line rather than as a line in the list and again as a regular
// expression beside the router, which is how it was.

import type { RouteHandler } from './route-context'
import * as auth from './routes/auth'
import * as addresses from './routes/addresses'
import * as brands from './routes/brands'
import * as caseImport from './routes/case-import'
import * as cases from './routes/cases'
import * as labels from './routes/labels'
import * as docs from './routes/docs'
import * as manuals from './routes/manuals'
import * as media from './routes/media'
import * as openapi from './routes/openapi'
import * as organizers from './routes/organizers'
import * as photos from './routes/photos'
import * as settings from './routes/settings'
import * as itemImport from './routes/item-import'
import * as items from './routes/items'
import * as users from './routes/users'
import * as version from './routes/version'
import { compileRoute, normalizePath, ROUTES } from './route-list'

type Method = 'DELETE' | 'GET' | 'OPTIONS' | 'PATCH' | 'POST' | 'PUT'

export type RouteMatch = {
  // The methods this path implements, for the Allow header of a 405.
  allow: string[]
  // null when the path exists but not with this method.
  handler: null | RouteHandler
  params: Record<string, string>
}

// A handler, or a handler plus the parameters the path cannot supply.
//
// The photo routes are the only ones that need the second form. `/api/items/…`
// and `/api/cases/…` reach one module — a case carries pictures on exactly the
// same terms as an item — and which of the two it is has to arrive as a
// parameter, because the path says it in a segment the pattern does not
// capture. Writing it here rather than deriving it from the path keeps the
// matcher from having to know anything about photographs.
type Entry = RouteHandler | { handler: RouteHandler; params: Record<string, string> }

// Keyed by the route exactly as route-list.ts writes it. A key that is not a
// route, or a route with no key, fails router.test.ts.
const HANDLERS: Partial<Record<(typeof ROUTES)[number], Entry>> = {
  'GET /healthz': healthz,
  'GET /api/version': version.GET,
  'POST /api/auth/register': auth.register,
  'POST /api/auth/login': auth.login,
  'POST /api/auth/token': auth.token,
  'POST /api/auth/logout': auth.logout,
  'GET /api/auth/sessions': auth.sessions,
  'DELETE /api/auth/sessions/:id': auth.revokeSessionRoute,
  'GET /api/auth/me': auth.me,
  'PATCH /api/auth/password': auth.changePassword,
  'PATCH /api/auth/language': auth.changeLanguage,
  'GET /api/items': items.GET,
  'POST /api/items': items.POST,
  'GET /api/items/categories': items.categoriesGET,
  'GET /api/items/attributes': items.attributeNamesGET,
  'GET /api/items/import/sources': itemImport.sourcesGET,
  'POST /api/items/import': itemImport.POST,
  'POST /api/items/:id/import': itemImport.refreshPOST,
  'GET /api/items/:id/manuals': manuals.listGET,
  'POST /api/items/:id/manuals': manuals.POST,
  'POST /api/items/:id/manuals/from-page': manuals.fromPagePOST,
  'PATCH /api/items/:id/manuals/:manualId': manuals.detailPATCH,
  'DELETE /api/items/:id/manuals/:manualId': manuals.detailDELETE,
  'GET /api/manuals/:id/file': manuals.fileGET,
  'GET /api/manuals': manuals.libraryGET,
  'PATCH /api/manuals/:id': manuals.libraryPATCH,
  'POST /api/manuals/delete': manuals.libraryDeletePOST,
  'POST /api/items/:id/manuals/attach': manuals.attachPOST,
  'POST /api/items/:id/attributes': items.attributePOST,
  'PATCH /api/items/:id/attributes/:attributeId': items.attributePATCH,
  'DELETE /api/items/:id/attributes/:attributeId': items.attributeDELETE,
  'GET /api/items/:id': items.detailGET,
  'PATCH /api/items/:id': items.detailPATCH,
  'DELETE /api/items/:id': items.detailDELETE,
  'POST /api/items/:id/duplicate': items.duplicatePOST,
  'GET /api/items/:id/photos': { handler: photos.listGET, params: { owner: 'items' } },
  'POST /api/items/:id/photos': { handler: photos.POST, params: { owner: 'items' } },
  'POST /api/items/:id/photos/attach': { handler: photos.attachPOST, params: { owner: 'items' } },
  'GET /api/items/:id/photos/:photoId/file': {
    handler: photos.fileGET,
    params: { owner: 'items' },
  },
  'PATCH /api/items/:id/photos/:photoId': {
    handler: photos.detailPATCH,
    params: { owner: 'items' },
  },
  'DELETE /api/items/:id/photos/:photoId': {
    handler: photos.detailDELETE,
    params: { owner: 'items' },
  },
  'POST /api/items/:id/photos/:photoId/cutout': {
    handler: photos.cutoutPOST,
    params: { owner: 'items' },
  },
  'POST /api/items/:id/photos/:photoId/cutout/preview': {
    handler: photos.cutoutPreviewPOST,
    params: { owner: 'items' },
  },
  'GET /api/items/:id/photos/:photoId/cutout/preview/:checksum': {
    handler: photos.cutoutPreviewGET,
    params: { owner: 'items' },
  },
  'POST /api/items/:id/photos/:photoId/cutout/commit': {
    handler: photos.cutoutCommitPOST,
    params: { owner: 'items' },
  },
  'GET /api/items/:id/photo-suggestions': {
    handler: photos.suggestionsGET,
    params: { owner: 'items' },
  },
  'GET /api/cases': cases.GET,
  'POST /api/cases': cases.POST,
  'GET /api/cases/systems': cases.systemsGET,
  'GET /api/cases/attributes': cases.attributeNamesGET,
  'GET /api/cases/import/sources': caseImport.sourcesGET,
  'POST /api/cases/import': caseImport.POST,
  'POST /api/cases/:id/import': caseImport.refreshPOST,
  'GET /api/cases/:id': cases.detailGET,
  'PATCH /api/cases/:id': cases.detailPATCH,
  'DELETE /api/cases/:id': cases.detailDELETE,
  'POST /api/cases/:id/attributes': cases.attributePOST,
  'PATCH /api/cases/:id/attributes/:attributeId': cases.attributePATCH,
  'DELETE /api/cases/:id/attributes/:attributeId': cases.attributeDELETE,
  'POST /api/cases/:id/label-slots': cases.labelSlotPOST,
  'DELETE /api/cases/:id/label-slots/:slotId': cases.labelSlotDELETE,
  'GET /api/cases/:id/photos': { handler: photos.listGET, params: { owner: 'cases' } },
  'POST /api/cases/:id/photos': { handler: photos.POST, params: { owner: 'cases' } },
  'POST /api/cases/:id/photos/attach': { handler: photos.attachPOST, params: { owner: 'cases' } },
  'GET /api/cases/:id/photos/:photoId/file': {
    handler: photos.fileGET,
    params: { owner: 'cases' },
  },
  'PATCH /api/cases/:id/photos/:photoId': {
    handler: photos.detailPATCH,
    params: { owner: 'cases' },
  },
  'DELETE /api/cases/:id/photos/:photoId': {
    handler: photos.detailDELETE,
    params: { owner: 'cases' },
  },
  'POST /api/cases/:id/photos/:photoId/cutout': {
    handler: photos.cutoutPOST,
    params: { owner: 'cases' },
  },
  'POST /api/cases/:id/photos/:photoId/cutout/preview': {
    handler: photos.cutoutPreviewPOST,
    params: { owner: 'cases' },
  },
  'GET /api/cases/:id/photos/:photoId/cutout/preview/:checksum': {
    handler: photos.cutoutPreviewGET,
    params: { owner: 'cases' },
  },
  'POST /api/cases/:id/photos/:photoId/cutout/commit': {
    handler: photos.cutoutCommitPOST,
    params: { owner: 'cases' },
  },
  'GET /api/cases/:id/photo-suggestions': {
    handler: photos.suggestionsGET,
    params: { owner: 'cases' },
  },
  'GET /api/addresses': addresses.GET,
  'POST /api/addresses': addresses.POST,
  'GET /api/addresses/:id': addresses.detailGET,
  'PATCH /api/addresses/:id': addresses.detailPATCH,
  'DELETE /api/addresses/:id': addresses.detailDELETE,

  'GET /api/brands': brands.GET,
  'POST /api/brands': brands.POST,
  'GET /api/brands/:id': brands.detailGET,
  'PATCH /api/brands/:id': brands.detailPATCH,
  'DELETE /api/brands/:id': brands.detailDELETE,
  'PUT /api/brands/:id/logo': brands.logoPUT,
  'DELETE /api/brands/:id/logo': brands.logoDELETE,
  'GET /api/organizers': organizers.GET,
  'POST /api/organizers': organizers.POST,
  'GET /api/organizers/:id': organizers.detailGET,
  'PATCH /api/organizers/:id': organizers.detailPATCH,
  'DELETE /api/organizers/:id': organizers.detailDELETE,
  'POST /api/organizers/:id/items': organizers.itemsPOST,
  'DELETE /api/organizers/:id/items/:itemId': organizers.itemDELETE,
  'GET /api/organizers/:id/label-slots': organizers.labelSlotsGET,
  'POST /api/organizers/:id/labels': organizers.labelPOST,
  'POST /api/organizers/:id/labels/refresh': organizers.labelRefreshPOST,
  'GET /api/organizers/:id/labels/:labelId/file': organizers.labelFileGET,
  'GET /api/organizers/:id/labels/:labelId/preview': organizers.labelPreviewGET,
  'DELETE /api/organizers/:id/labels/:labelId': organizers.labelDELETE,
  'GET /api/labels': labels.GET,
  'GET /api/labels/sheet': labels.sheetGET,
  'POST /api/labels/refresh': labels.refreshPOST,
  'GET /api/settings/search-engines': settings.enginesGET,
  'PATCH /api/settings/search-engines/:provider': settings.engineGlobalPATCH,
  'PATCH /api/me/search-engines/:provider': settings.engineMinePATCH,
  'GET /api/settings/cutout': settings.cutoutGET,
  'PATCH /api/settings/cutout': settings.cutoutPATCH,
  'PATCH /api/settings/cutout/:method': settings.cutoutMethodPATCH,
  'GET /api/photos': media.GET,
  'POST /api/photos': media.uploadPOST,
  'GET /api/photos/:id/file': media.fileGET,
  'POST /api/photos/delete': media.deletePOST,
  'GET /api/users': users.GET,
  'PATCH /api/users/:id': users.detailPATCH,
  'DELETE /api/users/:id': users.detailDELETE,
  'GET /api/openapi.json': openapi.GET,
  'GET /api/docs': docs.GET,
  'GET /api/docs/:asset': docs.assetGET,
}

// Compiled once at load, in the order ROUTES lists them. Order decides only
// where two patterns could both match, and none of them can: an id is digits,
// so "categories" cannot be read as one. The list is grouped for a reader.
const COMPILED = ROUTES.map((route) => {
  const [method, path] = route.split(' ')

  const entry = HANDLERS[route]
  const handler = typeof entry === 'function' ? entry : (entry?.handler ?? null)
  const fixed = typeof entry === 'function' ? {} : (entry?.params ?? {})

  return { ...compileRoute(path), fixed, handler, method }
})

export function matchRoute(pathname: string, method: string): null | RouteMatch {
  const path = normalizePath(pathname)
  const wanted = method.toUpperCase()

  const allow: string[] = []
  let handler: null | RouteHandler = null
  let params: Record<string, string> = {}

  for (const route of COMPILED) {
    const found = route.pattern.exec(path)
    if (!found) continue

    // Every method this path implements, because a 405 has to say which.
    allow.push(route.method)
    if (route.method !== wanted) continue

    handler = route.handler
    params = {
      ...route.fixed,
      ...Object.fromEntries(route.names.map((name, index) => [name, found[index + 1]])),
    }
  }

  // Nothing matched at all: the path does not exist, rather than existing
  // without this method.
  if (allow.length === 0) return null

  return { allow: [...new Set(allow)].sort(), handler, params }
}

// Liveness only. It answers without touching Postgres, because a probe that
// fails when the database is briefly unreachable restarts a container that was
// about to recover on its own. Database trouble is reported per request, as a
// 503 from pg-error-response.ts.
function healthz(): Response {
  return Response.json({ ok: true })
}
