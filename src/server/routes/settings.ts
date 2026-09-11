// Search engine settings.
//
//   GET   /api/settings/search-engines          catalog.write
//   PATCH /api/settings/search-engines/:name    users.manage   (global: keys, on/off)
//   PATCH /api/me/search-engines/:name          catalog.write    (this account only)
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
import { readCutoutSettings, saveCutoutMethod, saveCutoutThreshold } from './cutout-settings-store'
import { isCutoutMethod } from '../cutout-methods'
import {
  parseCutoutMethodInput,
  parseCutoutThresholdInput,
  parseGlobalEngineInput,
  parseUserEngineInput,
} from './settings-input'
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

// GET /api/settings/cutout — readable by anyone who may read the catalog, for
// the same reason the engine list is: whoever presses the wand should be able
// to see which methods exist and why one is missing. No credential in it, only
// whether a key is set.
export async function cutoutGET(): Promise<Response> {
  return Response.json(await readCutoutSettings(), { headers: { 'cache-control': 'no-store' } })
}

// PATCH /api/settings/cutout/:method — users.manage. One method's switch and
// key, exactly like a search engine's.
//
// There is nothing per-account here, unlike the engines: which methods exist
// decides what the installation spends, and that is not an individual
// preference. Which of them runs on a given photo is chosen on the cutout
// screen.
export async function cutoutMethodPATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const actorId = context.user?.id
  if (!actorId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const method = context.params.method
  if (!isCutoutMethod(method)) return notFound()

  const parsed = parseCutoutMethodInput(await readJson(request))
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  // The local method has no key to set; accepting one would store a value
  // nothing reads.
  if (parsed.value.apiKey !== undefined && method === 'local') {
    return Response.json({ error: 'Lokalna metoda nie używa klucza' }, { status: 400 })
  }

  await saveCutoutMethod(method, parsed.value, actorId)

  return Response.json(await readCutoutSettings())
}

// PATCH /api/settings/cutout — users.manage. The one setting that is not a
// method: the local method's threshold, which the cutout screen offers as a
// starting point.
export async function cutoutPATCH(request: Request, context: RouteContext): Promise<Response> {
  const actorId = context.user?.id
  if (!actorId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = parseCutoutThresholdInput(await readJson(request))
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  await saveCutoutThreshold(parsed.value.threshold, actorId)

  return Response.json(await readCutoutSettings())
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
