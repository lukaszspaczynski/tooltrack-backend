// Cross-origin access for the ToolTrack web and mobile clients, which are
// served from their own origin and log in with a cookie.
//
// Credentialed CORS cannot use `*`: the browser refuses a wildcard together
// with credentials. So the allowlist is explicit and an origin that is not on
// it simply gets no CORS headers back — the request still runs, the browser
// just will not show the answer to a page that was not invited.

const DEFAULT_DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']

export function allowedOrigins(): string[] {
  const configured = process.env.TOOLTRACK_ALLOWED_ORIGINS
  if (configured === undefined) {
    return process.env.NODE_ENV === 'production' ? [] : [...DEFAULT_DEV_ORIGINS]
  }

  return configured
    .split(',')
    .map((entry) => entry.trim().replace(/\/$/, ''))
    .filter((entry) => entry.length > 0)
}

export function corsHeaders(request: Request): Headers {
  const headers = new Headers()
  const origin = request.headers.get('origin')
  if (!origin || !allowedOrigins().includes(origin)) return headers

  headers.set('access-control-allow-origin', origin)
  headers.set('access-control-allow-credentials', 'true')
  // Caches keyed on the URL alone would serve one origin's answer to another.
  headers.set('vary', 'origin')
  return headers
}

export function preflightResponse(request: Request): null | Response {
  if (request.method !== 'OPTIONS') return null

  const headers = corsHeaders(request)
  headers.set('access-control-allow-methods', 'DELETE, GET, OPTIONS, PATCH, POST')
  headers.set(
    'access-control-allow-headers',
    request.headers.get('access-control-request-headers') ?? 'content-type',
  )
  headers.set('access-control-max-age', '600')

  return new Response(null, { headers, status: 204 })
}

export function withCorsHeaders(response: Response, request: Request): Response {
  const extra = corsHeaders(request)
  if ([...extra.keys()].length === 0) return response

  const headers = new Headers(response.headers)
  extra.forEach((value, key) => headers.set(key, value))

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  })
}
