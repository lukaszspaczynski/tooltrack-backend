// GET /api/openapi.json — the contract, served by the API it describes.
//
// Public, like /healthz and /api/version, and for the same reason: a client
// generating itself against this document has not logged in yet, and asking it
// to authenticate before it can find out how to authenticate is a circle.
// Nothing here is a secret — the document says which routes exist and what
// they need, which is what the 404 body already says.
//
// The entity schemas are generated from the TypeScript types by
// `npm run openapi:build`, which writes docs/openapi.json. This reads that file
// once and answers with it: generating on every request would mean running the
// TypeScript compiler inside a request handler.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DOCUMENT_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/openapi.json')

// Read once in production, where the file cannot change without a redeploy,
// and every time in development, where it changes whenever somebody runs
// `npm run openapi:build` — which touches no TypeScript, so the watcher does
// not restart and a cached copy would go stale without saying so.
let document: null | string = null

export async function GET(): Promise<Response> {
  const body =
    process.env.NODE_ENV === 'production'
      ? (document ??= readFileSync(DOCUMENT_PATH, 'utf8'))
      : readFileSync(DOCUMENT_PATH, 'utf8')

  return new Response(body, {
    headers: {
      // The document changes when the server does, and a client fetching it is
      // about to generate code from it. An hour is long enough to be polite to
      // a proxy and short enough that nobody generates against yesterday.
      'cache-control': 'public, max-age=3600',
      'content-type': 'application/json; charset=utf-8',
    },
  })
}
