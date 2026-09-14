import assert from 'node:assert/strict'
import test from 'node:test'

import type { PgPool, PgQueryResult } from '../db'
import {
  EmailTakenError,
  SESSION_COOKIE,
  authenticateRequest,
  clearedSessionCookie,
  createUser,
  issueSession,
  listSessions,
  readCookie,
  revokeSession,
  revokeSessionById,
  sessionTokenOf,
  setLanguage,
  updateUser,
  verifyPassword,
} from './auth-store'

type Call = { params: unknown[]; text: string }

function fakePool(rows: unknown[] = [], error?: unknown): { calls: Call[]; pool: PgPool } {
  const calls: Call[] = []
  const pool: PgPool = {
    query(text: string, params: unknown[] = []) {
      calls.push({ params, text })
      if (error) return Promise.reject(error)
      return Promise.resolve({ rowCount: rows.length, rows } as PgQueryResult<never>)
    },
  }
  return { calls, pool }
}

function userRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    created_at: '2026-01-01T00:00:00.000Z',
    display_name: 'Ola',
    email: 'ola@example.com',
    id: '4',
    language: 'pl',
    role: 'viewer',
    status: 'active',
    ...overrides,
  }
}

test('a registration is stored lowercased and always as a viewer', async () => {
  const { calls, pool } = fakePool([userRow()])

  await createUser(
    { displayName: ' Ola ', email: '  Ola@Example.COM ', password: 'sekret1234' },
    pool,
  )

  const [{ params }] = calls
  assert.equal(params[0], 'ola@example.com')
  assert.equal(params[1], 'Ola')
  assert.equal(params[4], 'viewer')
})

test('the password never reaches the database', async () => {
  const { calls, pool } = fakePool([userRow()])

  await createUser({ displayName: 'Ola', email: 'ola@example.com', password: 'sekret1234' }, pool)

  const [{ params }] = calls
  const stored = params.map(String)
  assert.ok(!stored.includes('sekret1234'))
  // PBKDF2 hash and its salt, both hex.
  assert.match(String(params[2]), /^[0-9a-f]{64}$/)
  assert.match(String(params[3]), /^[0-9a-f]{32}$/)
})

test('two accounts with the same email is a named error', async () => {
  const { pool } = fakePool([], Object.assign(new Error('duplicate key'), { code: '23505' }))

  await assert.rejects(
    () =>
      createUser({ displayName: 'Ola', email: 'ola@example.com', password: 'sekret1234' }, pool),
    EmailTakenError,
  )
})

test('a stored password verifies against itself and nothing else', async () => {
  const { calls, pool } = fakePool([userRow()])
  await createUser({ displayName: 'Ola', email: 'ola@example.com', password: 'sekret1234' }, pool)

  const credentials = {
    ...userRow(),
    password_hash: String(calls[0].params[2]),
    password_salt: String(calls[0].params[3]),
  } as Parameters<typeof verifyPassword>[1]

  assert.equal(await verifyPassword('sekret1234', credentials), true)
  assert.equal(await verifyPassword('sekret1235', credentials), false)
  assert.equal(await verifyPassword('', credentials), false)
})

test('a hash written by another scheme fails instead of throwing', async () => {
  const credentials = {
    ...userRow(),
    password_hash: 'aa',
    password_salt: 'bb',
  } as Parameters<typeof verifyPassword>[1]

  assert.equal(await verifyPassword('sekret1234', credentials), false)
})

test('only the hash of a session token is stored', async () => {
  const { calls, pool } = fakePool([userRow()])

  const session = await issueSession(4, '', pool)

  const token = readCookie(session.cookie.replaceAll('; ', '; '), SESSION_COOKIE)
  assert.ok(token)
  assert.match(String(calls[0].params[1]), /^[0-9a-f]{64}$/)
  assert.notEqual(calls[0].params[1], token)
})

test('the session cookie is HttpOnly and Lax, and Secure only in production', async (t) => {
  t.after(() => {
    delete process.env.NODE_ENV
  })

  const { pool } = fakePool([userRow()])

  const local = await issueSession(4, '', pool)
  assert.match(local.cookie, /HttpOnly/)
  assert.match(local.cookie, /SameSite=Lax/)
  assert.match(local.cookie, /Path=\//)
  // Secure would make the cookie unusable over http://localhost.
  assert.doesNotMatch(local.cookie, /Secure/)

  process.env.NODE_ENV = 'production'
  const deployed = await issueSession(4, '', pool)
  assert.match(deployed.cookie, /Secure/)
})

test('the cleared cookie expires in the past and carries no token', () => {
  const cookie = clearedSessionCookie()

  assert.match(cookie, new RegExp(`^${SESSION_COOKIE}=;`))
  assert.match(cookie, /Expires=Thu, 01 Jan 1970/)
})

test('a request without our cookie never reaches the database', async () => {
  const { calls, pool } = fakePool([userRow()])

  const anonymous = new Request('http://localhost/api/tools')
  assert.equal(await authenticateRequest(anonymous, pool), null)

  const other = new Request('http://localhost/api/tools', { headers: { cookie: 'other=1' } })
  assert.equal(await authenticateRequest(other, pool), null)

  await revokeSession(anonymous, pool)
  assert.deepEqual(calls, [])
})

test('an expired or unknown session reads as no session', async () => {
  const { pool } = fakePool([])

  const request = new Request('http://localhost/api/tools', {
    headers: { cookie: `${SESSION_COOKIE}=whatever` },
  })

  assert.equal(await authenticateRequest(request, pool), null)
})

test('a resolved session answers the account behind it', async () => {
  const { calls, pool } = fakePool([userRow({ role: 'editor' })])

  const request = new Request('http://localhost/api/tools', {
    headers: { cookie: `a=1; ${SESSION_COOKIE}=token-value; b=2` },
  })

  const user = await authenticateRequest(request, pool)

  assert.deepEqual(user, {
    createdAt: '2026-01-01T00:00:00.000Z',
    displayName: 'Ola',
    email: 'ola@example.com',
    id: 4,
    language: 'pl',
    role: 'editor',
    status: 'active',
  })
  // last_seen_at is what tells an admin the login is still in use.
  assert.match(calls[0].text, /SET "last_seen_at" = now\(\)/)
})

test('a role the application does not know reads as the least privileged one', async () => {
  const { pool } = fakePool([userRow({ role: 'owner' })])

  const request = new Request('http://localhost/api/tools', {
    headers: { cookie: `${SESSION_COOKIE}=token-value` },
  })

  assert.equal((await authenticateRequest(request, pool))?.role, 'viewer')
})

test('disabling an account also ends its open sessions', async () => {
  const { calls, pool } = fakePool([userRow({ status: 'disabled' })])

  await updateUser(4, { status: 'disabled' }, pool)

  assert.equal(calls.length, 2)
  assert.match(calls[1].text, /DELETE FROM "account"."session" WHERE "user_id" = \$1/)
  assert.deepEqual(calls[1].params, [4])
})

test('a role change leaves the sessions alone', async () => {
  const { calls, pool } = fakePool([userRow({ role: 'editor' })])

  await updateUser(4, { role: 'editor' }, pool)

  assert.equal(calls.length, 1)
  // COALESCE: an unsent field keeps its stored value rather than being nulled.
  assert.deepEqual(calls[0].params, [4, null, 'editor', null])
})

test('readCookie takes the named cookie and decodes it', () => {
  assert.equal(readCookie('a=1; tooltrack_session=abc%20def; b=2', SESSION_COOKIE), 'abc def')
  assert.equal(readCookie('tooltrack_session_other=abc', SESSION_COOKIE), null)
  assert.equal(readCookie(null, SESSION_COOKIE), null)
  assert.equal(readCookie('malformed', SESSION_COOKIE), null)
})

test('the language a row carries travels with the account', async () => {
  const { pool } = fakePool([userRow({ language: 'en' })])

  const request = new Request('http://localhost/api/tools', {
    headers: { cookie: `${SESSION_COOKIE}=token-value` },
  })

  assert.equal((await authenticateRequest(request, pool))?.language, 'en')
})

test('a language the application does not know reads as Polish', async () => {
  // The CHECK constraint on the column already refuses this, so a value that
  // gets here means the column and i18n/lang.ts drifted apart. Answering in the
  // language this interface was written in is the safe way to be wrong.
  const { pool } = fakePool([userRow({ language: 'kaszubski' })])

  const request = new Request('http://localhost/api/tools', {
    headers: { cookie: `${SESSION_COOKIE}=token-value` },
  })

  assert.equal((await authenticateRequest(request, pool))?.language, 'pl')
})

test('choosing a language writes one column and leaves the sessions alone', async () => {
  // Unlike a password change: reading the interface in English is not a
  // security event, and being signed out for it would be a strange answer.
  const { calls, pool } = fakePool([userRow({ language: 'en' })])

  const user = await setLanguage(4, 'en', pool)

  assert.equal(user.language, 'en')
  assert.equal(calls.length, 1)
  assert.match(calls[0].text, /SET "language" = \$2/)
  assert.deepEqual(calls[0].params, [4, 'en'])
})

test('a bearer token is read from the header, and beats a stale cookie', () => {
  // A client that has been given a token means to use it. A cookie left over
  // from the same host must not quietly authenticate as somebody else.
  const withBoth = new Request('http://x/api/tools', {
    headers: { authorization: 'Bearer abc123', cookie: `${SESSION_COOKIE}=stary` },
  })
  assert.equal(sessionTokenOf(withBoth), 'abc123')

  const cookieOnly = new Request('http://x/api/tools', {
    headers: { cookie: `${SESSION_COOKIE}=zciasteczka` },
  })
  assert.equal(sessionTokenOf(cookieOnly), 'zciasteczka')

  assert.equal(sessionTokenOf(new Request('http://x/api/tools')), null)
})

test('the scheme is matched loosely enough to be usable and not more', () => {
  const of = (authorization: string) =>
    sessionTokenOf(new Request('http://x/', { headers: { authorization } }))

  // Case does not matter — the RFC says so, and clients differ.
  assert.equal(of('bearer abc'), 'abc')
  assert.equal(of('BEARER abc'), 'abc')
  // Anything that is not this scheme is not a token. Basic auth carries a
  // password, and reading it as a session token would be nonsense with a hash
  // put through it.
  assert.equal(of('Basic abc'), null)
  assert.equal(of('Bearer'), null)
  assert.equal(of('Bearer a b'), null)
})

test('using a session slides its expiry, and the slide is capped', async () => {
  // The UPDATE was already happening for last_seen_at, so this costs nothing —
  // which is the whole reason a fixed thirty days was worth changing.
  const { calls, pool } = fakePool([userRow()])

  await authenticateRequest(
    new Request('http://x/api/tools', { headers: { authorization: 'Bearer abc' } }),
    pool,
  )

  assert.match(calls[0].text, /SET "last_seen_at" = now\(\)/)
  assert.match(calls[0].text, /"expires_at" = LEAST/)
  // Against the row's own birthday, or a token taken silently would be good
  // for ever as long as whoever took it kept using it.
  assert.match(calls[0].text, /"s"\."created_at" \+ \(\$3 \|\| ' days'\)::interval/)
  assert.equal(calls[0].params[1], '30')
  assert.equal(calls[0].params[2], '365')
})

test('a session is revoked by id only for the account that owns it', async () => {
  // The id in the path came from somewhere, and a number is easy to guess.
  const { calls, pool } = fakePool([])

  const revoked = await revokeSessionById(4, 12, pool)

  assert.equal(revoked, false)
  assert.match(calls[0].text, /WHERE "user_id" = \$1 AND "id" = \$2/)
  assert.deepEqual(calls[0].params, [4, 12])
})

test('the session list marks the one asking and leaves out the dead', async () => {
  const { calls, pool } = fakePool([])

  await listSessions(
    new Request('http://x/', { headers: { authorization: 'Bearer abc' } }),
    4,
    pool,
  )

  assert.match(calls[0].text, /\("token_hash" = \$2\) AS "current"/)
  assert.match(calls[0].text, /"expires_at" > now\(\)/)
  // Compared as a hash, like everything else: the table holds no tokens.
  assert.match(String(calls[0].params[1]), /^[0-9a-f]{64}$/)
})

test('the device label is stored but cannot be used as storage', async () => {
  const { calls, pool } = fakePool([userRow()])

  await issueSession(4, 'x'.repeat(500), pool)

  assert.equal(String(calls[0].params[3]).length, 120)
})
