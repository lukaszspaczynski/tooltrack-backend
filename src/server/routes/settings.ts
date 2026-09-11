// Search engine settings.
//
//   GET   /api/settings/search-engines          tools.write
//   PATCH /api/settings/search-engines/:name    users.manage   (global: keys, on/off)
//   PATCH /api/me/search-engines/:name          tools.write    (this account only)
//
// Two owners, deliberately split. The credentials are one installation's
// property and only an admin may change them; which of the configured engines
// a given person searches with is their own business, and costs nobody
// anything to get wrong.
//
// The GET is the same for everybody, because the screen has to show a
// non-admin what is available and why the search button is grey. It never
// carries a key — only whether one is set, and its last four characters.

import { isSearchProvider } from '../search-engines'
import type { RouteContext } from '../route-context'
import { parseGlobalEngineInput, parseUserEngineInput } from './settings-input'
import { listEngineSettings, saveGlobalEngine, saveUserEngine } from './search-settings-store'

export async function enginesGET(_request: Request, context: RouteContext): Promise<Response> {
  const actorId = context.user?.id
  if (!actorId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  return Response.json(await enginesResponse(actorId), {
    headers: { 'cache-control': 'no-store' },
  })
}

export async function engineGlobalPATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const actorId = context.user?.id
  if (!actorId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const provider = context.params.provider
  if (!isSearchProvider(provider)) return notFound()

  const parsed = parseGlobalEngineInput(await readJson(request))
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  await saveGlobalEngine(provider, parsed.value, actorId)

  // The saved list comes back, so the screen shows the new state — including
  // the masked hint — without asking again.
  return Response.json(await enginesResponse(actorId))
}

export async function engineMinePATCH(request: Request, context: RouteContext): Promise<Response> {
  const actorId = context.user?.id
  if (!actorId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const provider = context.params.provider
  if (!isSearchProvider(provider)) return notFound()

  const parsed = parseUserEngineInput(await readJson(request))
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  await saveUserEngine(actorId, provider, parsed.value.enabled)

  return Response.json(await enginesResponse(actorId))
}

// One shape for every answer on this surface: the list, plus the number the
// client needs to decide whether the search button works. Deriving that rule
// from three flags in the browser would be a second place to get it wrong.
async function enginesResponse(actorId: number) {
  const engines = await listEngineSettings(actorId)

  return {
    engines,
    usable: engines.filter(
      (engine) => engine.configured && engine.globallyEnabled && engine.usedByMe,
    ).length,
  }
}

function notFound(): Response {
  return Response.json({ error: 'Nie ma takiej wyszukiwarki' }, { status: 404 })
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}
