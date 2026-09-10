// Reads a request body into memory with a cap, before anything parses it.
//
// The server buffers bodies rather than streaming them because every write in
// this API is a small JSON document. The cap is what keeps that choice safe:
// an oversized upload is refused as 413 while it is still arriving, instead of
// being collected into the heap first.

import type { IncomingMessage } from 'node:http'

import { maxPhotoBytes } from './image-fetch'

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024

// Photo uploads arrive as the raw file in the body, so they cannot live under
// the JSON cap. Which paths those are is decided here rather than in the route,
// because the cap has to be applied while the bytes are still arriving.
const PHOTO_UPLOAD_PATTERN = /^\/api\/tools\/\d+\/photos\/?$/

export type BodyResult =
  { body: undefined | Uint8Array; ok: true } | { ok: false; response: Response }

export function maxRequestBodyBytes(): number {
  const raw = process.env.MAX_REQUEST_BODY_BYTES
  if (raw === undefined || raw.trim() === '') return DEFAULT_MAX_BODY_BYTES

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_MAX_BODY_BYTES
  return parsed
}

export function requestUrl(req: IncomingMessage, fallbackHost: string): URL {
  const host = req.headers.host ?? fallbackHost
  // The protocol is only here to make the string a legal URL; nothing reads it.
  return new URL(req.url ?? '/', `http://${host}`)
}

export function bodyLimitFor(pathname: string): number {
  return PHOTO_UPLOAD_PATTERN.test(pathname) ? maxPhotoBytes() : maxRequestBodyBytes()
}

export async function readRequestBody(req: IncomingMessage, pathname: string): Promise<BodyResult> {
  if (req.method === 'GET' || req.method === 'HEAD') return { body: undefined, ok: true }

  const limit = bodyLimitFor(pathname)
  const declared = Number(req.headers['content-length'] ?? '')
  if (Number.isFinite(declared) && declared > limit) return { ok: false, response: tooLarge(limit) }

  const chunks: Uint8Array[] = []
  let received = 0

  for await (const chunk of req) {
    const bytes = chunk as Uint8Array
    received += bytes.byteLength
    if (received > limit) {
      // Stop reading. The socket is left to the caller to close by answering.
      req.destroy()
      return { ok: false, response: tooLarge(limit) }
    }
    chunks.push(bytes)
  }

  if (received === 0) return { body: undefined, ok: true }

  return { body: Buffer.concat(chunks), ok: true }
}

function tooLarge(limit: number): Response {
  return Response.json({ error: `Request body exceeds ${limit} bytes` }, { status: 413 })
}
