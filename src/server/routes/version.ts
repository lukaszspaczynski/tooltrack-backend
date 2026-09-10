import { buildInfo } from '../../version'

// GET /api/version — the endpoint you curl to find out what is actually
// running. Unauthenticated on purpose: it is reached from outside to confirm a
// release landed, before anyone has a session.
//
// It must not grow into a status page. No environment names, no database
// checks, no configuration. /healthz is the liveness probe and stays separate.
export function GET(): Response {
  return Response.json(buildInfo(), { headers: { 'cache-control': 'no-store' } })
}
