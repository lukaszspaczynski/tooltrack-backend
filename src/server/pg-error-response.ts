// One mapping from a thrown error to an HTTP answer, so that every route fails
// the same way and a saturated pool never reads as a client mistake.

export function isPgUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const code = (error as { code?: unknown }).code
  const message = (error as { message?: unknown }).message

  // 53300 too_many_connections, 57P03 cannot_connect_now, 08006/08001 failed
  // connection. ECONNREFUSED and the pool's own timeout message arrive without
  // a Postgres code at all.
  if (
    typeof code === 'string' &&
    ['08001', '08006', '53300', '57P03', 'ECONNREFUSED'].includes(code)
  ) {
    return true
  }

  return typeof message === 'string' && message.includes('timeout exceeded when trying to connect')
}

export function routeErrorResponse(scope: string, error: unknown): Response {
  if (isPgUnavailableError(error)) {
    console.error(`[${scope}] database unavailable`, error)
    // Retryable, and honest about it: the caller's request was fine.
    return Response.json({ error: 'Database unavailable' }, { status: 503 })
  }

  console.error(`[${scope}] unhandled error`, error)
  // The message stays out of the body. Whatever it says was written for us,
  // not for whoever is holding the phone.
  return Response.json({ error: 'Internal server error' }, { status: 500 })
}
