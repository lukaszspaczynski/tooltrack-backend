// Every path this server answers, in one list.
//
// It is a module of its own rather than a const inside index.ts for two
// reasons: the 404 body quotes it, and so does the OpenAPI coverage test —
// and a test that had to import index.ts to read it would start a server
// listening on a port to find out what the routes are.
//
// Adding a line here is not what makes a route reachable; matchRoute in
// index.ts is. What this list does is make the surface readable in one place,
// and give the spec something to be checked against.

export const ROUTES = [
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
  'POST /api/tools/:id/import',
  'GET /api/tools/:id/manuals',
  'POST /api/tools/:id/manuals',
  'POST /api/tools/:id/manuals/from-page',
  'PATCH /api/tools/:id/manuals/:manualId',
  'DELETE /api/tools/:id/manuals/:manualId',
  'GET /api/manuals/:id/file',
  'GET /api/manuals',
  'PATCH /api/manuals/:id',
  'POST /api/manuals/delete',
  'POST /api/tools/:id/manuals/attach',
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
  'GET /api/cases/import/sources',
  'POST /api/cases/import',
  'POST /api/cases/:id/import',
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
  'GET /api/openapi.json',
  'GET /api/docs',
  'GET /api/docs/:asset',
] as const

// A concrete path the router and the policy will both accept.
//
// Their patterns are stricter than "any value": an id is digits, a preview
// checksum is sixty-four hex characters, and a provider or a cutout method is a
// word. A sample that merely looks plausible is classified as unreachable, and
// anything comparing the two tables would then be comparing nothing — which is
// how this function came to exist, twice, before it was moved here.
export function sampleOf(path: string): string {
  return path
    .replace(/:checksum/g, 'a'.repeat(64))
    .replace(/:([A-Za-z]\w*)/g, (_, name: string) => (/^id$|Id$/.test(name) ? '1' : 'x'))
}

// A route template as a pattern, with the names of the parameters in it.
//
// This is the only place a path becomes a regular expression. Before, every
// parameterised route existed twice — once as a line in ROUTES and once as a
// `const TOOL_DETAIL_PATTERN = /^\/api\/tools\/(\d+)$/` beside the router —
// and the two could describe different paths with nothing to say so.
//
// The segment types are the ones this API has, and they are deliberately
// narrow: an id that admits anything is an id that lets `/api/tools/../..`
// reach a handler.
const SEGMENT: Record<string, string> = {
  // A file name, never a path: no slash, so nothing here can walk out of the
  // directory it is served from.
  asset: '[A-Za-z0-9._-]+',
  checksum: '[0-9a-f]{64}',
  method: '[a-z]+',
  provider: '[a-z]+',
}

export type CompiledRoute = {
  names: string[]
  pattern: RegExp
}

export function compileRoute(path: string): CompiledRoute {
  const names: string[] = []

  const source = path.replace(/:([A-Za-z]\w*)/g, (_, name: string) => {
    names.push(name)
    return `(${SEGMENT[name] ?? '\\d+'})`
  })

  return { names, pattern: new RegExp(`^${source.replace(/\//g, '\\/')}$`) }
}

// A trailing slash is the same route. Nothing else is normalised — not casing,
// not encoded segments — because a router that normalises more than the policy
// does is a router the policy can be walked around.
export function normalizePath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}
