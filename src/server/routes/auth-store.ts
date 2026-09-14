// Accounts and sessions: everything that touches `account.user_account` and
// `account.session`. The route modules above it do no SQL of their own.
//
// The login model is deliberately boring — an opaque random token in an
// HttpOnly cookie, its SHA-256 stored server side. No JWT: revoking a session
// has to mean the session stops working, and that is a DELETE here rather than
// a token that keeps being valid until it expires.

import crypto from 'node:crypto'
import type { ErrorCode } from '../error-codes'

import {
  DEFAULT_ROLE,
  isRole,
  normalizeEmail,
  type AccountStatus,
  type Role,
  type User,
} from '../../access/roles'
import { db, type PgPool } from '../db'
import { DEFAULT_LANG, isLang, t, type Lang } from '../i18n'

export const SESSION_COOKIE = 'tooltrack_session'

const PBKDF2_ITERATIONS = 210_000
const PBKDF2_KEY_BYTES = 32
const PBKDF2_DIGEST = 'sha512'
const SALT_BYTES = 16
const TOKEN_BYTES = 32
// A label on a list, not a field anybody reads twice. Long enough for "Pixel 8
// — magazyn", short enough that a client cannot use it as storage.
export const MAX_DEVICE_LENGTH = 120

// Every account column except the two password ones. Written once so a new
// column cannot be added to one query and forgotten in the other four. The
// alias is for the queries that read the account through a join.
const USER_COLUMN_NAMES = [
  'id',
  'email',
  'display_name',
  'role',
  'status',
  'language',
  'created_at',
]

function userColumns(alias?: string): string {
  const prefix = alias ? `"${alias}".` : ''
  return USER_COLUMN_NAMES.map((name) => `${prefix}"${name}"`).join(', ')
}

type UserRow = {
  created_at: Date | string
  display_name: string
  email: string
  id: number | string
  language: string
  role: string
  status: string
}

type CredentialRow = UserRow & {
  password_hash: string
  password_salt: string
}

export type Session = {
  cookie: string
  expiresAt: string
  // The token itself, which only the caller that asked for one ever sees: it
  // is never stored — the table holds its SHA-256 — and never read back out of
  // anything. `POST /api/auth/token` answers with it; `POST /api/auth/login`
  // puts it in the cookie and drops it, which is what keeps the web client's
  // session out of reach of any script running on the page.
  token: string
  user: User
}

// One row of "where am I signed in", for the list somebody revokes a lost
// phone from.
export type SessionSummary = {
  createdAt: string
  current: boolean
  device: string
  expiresAt: string
  id: number
  lastSeenAt: string
}

export class EmailTakenError extends Error {
  readonly code: ErrorCode

  constructor() {
    super(t('Konto z tym adresem już istnieje'))
    this.name = 'EmailTakenError'
    this.code = 'EMAIL_TAKEN'
  }
}

export async function createUser(
  input: { displayName: string; email: string; password: string },
  pool: PgPool = db(),
): Promise<User> {
  const email = normalizeEmail(input.email)
  const { hash, salt } = await hashPassword(input.password)

  try {
    const result = await pool.query<UserRow>(
      `
        INSERT INTO "account"."user_account"
          ("email", "display_name", "password_hash", "password_salt", "role")
        VALUES ($1, $2, $3, $4, $5)
        RETURNING ${userColumns()}
      `,
      [email, input.displayName.trim(), hash, salt, DEFAULT_ROLE],
    )

    return toUser(result.rows[0])
  } catch (error) {
    // 23505 unique_violation is the only expected failure here, and it is a
    // 409 rather than a 500. Anything else is rethrown untouched.
    if ((error as { code?: string }).code === '23505') throw new EmailTakenError()
    throw error
  }
}

export async function findCredentialsByEmail(
  email: string,
  pool: PgPool = db(),
): Promise<null | CredentialRow> {
  const result = await pool.query<CredentialRow>(
    `
      SELECT ${userColumns()}, "password_hash", "password_salt"
      FROM "account"."user_account"
      WHERE "email" = $1
    `,
    [normalizeEmail(email)],
  )

  return result.rows[0] ?? null
}

export async function verifyPassword(password: string, row: CredentialRow): Promise<boolean> {
  const candidate = await pbkdf2(password, row.password_salt)
  const stored = Buffer.from(row.password_hash, 'hex')

  // Lengths differ only if the stored hash was written by another scheme;
  // timingSafeEqual throws on a length mismatch, so it is checked first.
  if (candidate.length !== stored.length) return false
  return crypto.timingSafeEqual(candidate, stored)
}

export async function issueSession(
  userId: number,
  device = '',
  pool: PgPool = db(),
): Promise<Session> {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url')
  const expiresAt = new Date(Date.now() + sessionTtlDays() * 24 * 60 * 60 * 1000)

  const result = await pool.query<UserRow>(
    `
      WITH "new_session" AS (
        INSERT INTO "account"."session" ("user_id", "token_hash", "expires_at", "device")
        VALUES ($1, $2, $3, $4)
        RETURNING "user_id"
      )
      SELECT ${userColumns()}
      FROM "account"."user_account"
      WHERE "id" = (SELECT "user_id" FROM "new_session")
    `,
    [userId, hashToken(token), expiresAt.toISOString(), device.slice(0, MAX_DEVICE_LENGTH)],
  )

  return {
    cookie: sessionCookie(token, expiresAt),
    expiresAt: expiresAt.toISOString(),
    token,
    user: toUser(result.rows[0]),
  }
}

// Returns the account behind the request's cookie, or null. A disabled account
// resolves to a User with status 'disabled' rather than to null: the guard
// refuses it (roles.ts isActiveUser), and /api/auth/me can say why instead of
// pretending the session vanished.
export async function authenticateRequest(
  request: Request,
  pool: PgPool = db(),
): Promise<null | User> {
  const token = sessionTokenOf(request)
  if (!token) return null

  // One statement: it touches the session (last_seen_at, which is what tells
  // an admin a login is still in use) and reads the account behind it. An
  // expired row is simply not matched, so an old token reads as no session
  // rather than as a session belonging to nobody.
  //
  // It also **slides** the expiry, and that is free: this UPDATE was already
  // happening on every authenticated request, so moving a second column in the
  // same SET costs nothing. Without it a session ends a fixed thirty days after
  // it was issued however much it is used, which on a phone is a login screen
  // every month for no reason anybody can see.
  //
  // LEAST caps it against the row's own birthday. A session that renewed itself
  // for ever would mean a token taken silently is good for ever, as long as
  // whoever took it keeps using it — so the sliding window can carry a session
  // a long way, but not past the absolute one.
  const result = await pool.query<UserRow>(
    `
      UPDATE "account"."session" AS "s"
      SET "last_seen_at" = now(),
          "expires_at" = LEAST(
            now() + ($2 || ' days')::interval,
            "s"."created_at" + ($3 || ' days')::interval
          )
      FROM "account"."user_account" AS "a"
      WHERE "s"."token_hash" = $1 AND "s"."expires_at" > now() AND "a"."id" = "s"."user_id"
      RETURNING ${userColumns('a')}
    `,
    [hashToken(token), String(sessionTtlDays()), String(sessionAbsoluteTtlDays())],
  )

  const row = result.rows[0]
  return row ? toUser(row) : null
}

// The token, however this caller carries it.
//
// A browser sends the cookie, which it cannot be talked out of and which no
// script on the page can read. A native client has no cookie jar worth relying
// on and sends `Authorization: Bearer`. One session store either way — the same
// row, the same hash, the same expiry — so revoking, disabling an account and
// changing a password all reach both without knowing there are two.
//
// The header wins when both are present. A client that has been given a token
// means to use it; a stale cookie from the same host should not quietly
// authenticate as somebody else.
export function sessionTokenOf(request: Request): null | string {
  const authorization = request.headers.get('authorization') ?? ''
  const bearer = /^Bearer[ \t]+(\S+)$/i.exec(authorization)

  return bearer ? bearer[1] : readCookie(request.headers.get('cookie'), SESSION_COOKIE)
}

export async function revokeSession(request: Request, pool: PgPool = db()): Promise<void> {
  const token = sessionTokenOf(request)
  if (!token) return

  await pool.query(`DELETE FROM "account"."session" WHERE "token_hash" = $1`, [hashToken(token)])
}

// Where this account is signed in, newest first, with the session asking
// marked. Expired rows are left out rather than shown as dead: the question
// this answers is "what is open right now", and a list of things that already
// closed is noise in front of the one row somebody came here to revoke.
export async function listSessions(
  request: Request,
  userId: number,
  pool: PgPool = db(),
): Promise<SessionSummary[]> {
  const token = sessionTokenOf(request)

  const result = await pool.query<{
    created_at: Date | string
    current: boolean
    device: string
    expires_at: Date | string
    id: string
    last_seen_at: Date | string
  }>(
    `
      SELECT "id", "device", "created_at", "last_seen_at", "expires_at",
             ("token_hash" = $2) AS "current"
      FROM "account"."session"
      WHERE "user_id" = $1 AND "expires_at" > now()
      ORDER BY "last_seen_at" DESC
    `,
    [userId, token ? hashToken(token) : ''],
  )

  return result.rows.map((row) => ({
    createdAt: toIso(row.created_at),
    current: row.current,
    device: row.device,
    expiresAt: toIso(row.expires_at),
    id: Number(row.id),
    lastSeenAt: toIso(row.last_seen_at),
  }))
}

// Scoped by user as well as by id, which is the whole safety of this route: an
// id from somewhere else must not end somebody else's session, and a number is
// easy to guess. False when it matched nothing, which the route answers 404 —
// the same answer a session that never existed gets, so the two cannot be told
// apart by trying.
export async function revokeSessionById(
  userId: number,
  sessionId: number,
  pool: PgPool = db(),
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM "account"."session" WHERE "user_id" = $1 AND "id" = $2`,
    [userId, sessionId],
  )

  return (result.rowCount ?? 0) > 0
}

// Called when a password changes or an account is disabled. Signing in again
// is the point: whoever knew the old password must not keep an open session.
export async function revokeAllSessions(userId: number, pool: PgPool = db()): Promise<void> {
  await pool.query(`DELETE FROM "account"."session" WHERE "user_id" = $1`, [userId])
}

export async function findUserById(id: number, pool: PgPool = db()): Promise<null | User> {
  const result = await pool.query<UserRow>(
    `SELECT ${userColumns()} FROM "account"."user_account" WHERE "id" = $1`,
    [id],
  )

  const row = result.rows[0]
  return row ? toUser(row) : null
}

export async function findCredentialsById(
  id: number,
  pool: PgPool = db(),
): Promise<null | CredentialRow> {
  const result = await pool.query<CredentialRow>(
    `
      SELECT ${userColumns()}, "password_hash", "password_salt"
      FROM "account"."user_account"
      WHERE "id" = $1
    `,
    [id],
  )

  return result.rows[0] ?? null
}

export async function listUsers(pool: PgPool = db()): Promise<User[]> {
  const result = await pool.query<UserRow>(
    `SELECT ${userColumns()} FROM "account"."user_account" ORDER BY "email" ASC`,
  )

  return result.rows.map(toUser)
}

export async function updateUser(
  id: number,
  changes: { displayName?: string; role?: Role; status?: AccountStatus },
  pool: PgPool = db(),
): Promise<null | User> {
  const result = await pool.query<UserRow>(
    `
      UPDATE "account"."user_account"
      SET
        "display_name" = COALESCE($2, "display_name"),
        "role" = COALESCE($3, "role"),
        "status" = COALESCE($4, "status"),
        "updated_at" = now()
      WHERE "id" = $1
      RETURNING ${userColumns()}
    `,
    [id, changes.displayName ?? null, changes.role ?? null, changes.status ?? null],
  )

  const row = result.rows[0]
  if (!row) return null

  // A disabled account keeps no open sessions, or disabling it would only take
  // effect whenever the phone in someone's pocket next logged in.
  if (changes.status === 'disabled') await revokeAllSessions(id, pool)

  return toUser(row)
}

export async function deleteUser(id: number, pool: PgPool = db()): Promise<boolean> {
  const result = await pool.query(`DELETE FROM "account"."user_account" WHERE "id" = $1`, [id])
  return (result.rowCount ?? 0) > 0
}

export async function setPassword(
  id: number,
  password: string,
  pool: PgPool = db(),
): Promise<void> {
  const { hash, salt } = await hashPassword(password)
  await pool.query(
    `
      UPDATE "account"."user_account"
      SET "password_hash" = $2, "password_salt" = $3, "updated_at" = now()
      WHERE "id" = $1
    `,
    [id, hash, salt],
  )
  await revokeAllSessions(id, pool)
}

// Which language this account reads the interface in. The value is checked by
// the column as well, so a list that drifts is a 500 here rather than a row
// nobody can make sense of later.
export async function setLanguage(id: number, language: Lang, pool: PgPool = db()): Promise<User> {
  const result = await pool.query<UserRow>(
    `
      UPDATE "account"."user_account"
      SET "language" = $2, "updated_at" = now()
      WHERE "id" = $1
      RETURNING ${userColumns()}
    `,
    [id, language],
  )

  return toUser(result.rows[0])
}

export async function countAdmins(pool: PgPool = db()): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS "count" FROM "account"."user_account"
     WHERE "role" = 'admin' AND "status" = 'active'`,
  )

  return Number(result.rows[0]?.count ?? '0')
}

export function clearedSessionCookie(): string {
  return cookieParts(SESSION_COOKIE, '', new Date(0)).join('; ')
}

function sessionCookie(token: string, expiresAt: Date): string {
  return cookieParts(SESSION_COOKIE, token, expiresAt).join('; ')
}

function cookieParts(name: string, value: string, expiresAt: Date): string[] {
  const parts = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    // Lax, not Strict: the app is opened from links and shortcuts, and a
    // session that disappears when you arrive from a message is a session
    // people stop trusting. Nothing here is a state-changing GET.
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
  ]

  // Secure would make the cookie unusable over plain http://localhost, so it
  // follows the environment rather than being hardcoded either way.
  if (process.env.NODE_ENV === 'production') parts.push('Secure')

  return parts
}

export function readCookie(header: null | string, name: string): null | string {
  if (!header) return null

  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim() !== name) continue
    return decodeURIComponent(part.slice(separator + 1).trim())
  }

  return null
}

// How far a session can be carried from the day it was issued, however much it
// is used. The sliding window above renews a session on every request; this is
// what stops that meaning "for ever" — a year, which for somebody using the app
// daily is one password prompt a year.
function sessionAbsoluteTtlDays(): number {
  return positiveIntEnv(process.env.SESSION_ABSOLUTE_TTL_DAYS, 365)
}

function sessionTtlDays(): number {
  return positiveIntEnv(process.env.SESSION_TTL_DAYS, 30)
}

// Unset, blank and nonsense all mean the default. A session length read as NaN
// would be a session that expires in the past, which is every login failing
// with nothing to say why.
function positiveIntEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return parsed
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.randomBytes(SALT_BYTES).toString('hex')
  const hash = (await pbkdf2(password, salt)).toString('hex')
  return { hash, salt }
}

function pbkdf2(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(
      password,
      salt,
      PBKDF2_ITERATIONS,
      PBKDF2_KEY_BYTES,
      PBKDF2_DIGEST,
      (error, derived) => {
        if (error) reject(error)
        else resolve(derived)
      },
    )
  })
}

function toUser(row: UserRow): User {
  return {
    createdAt: toIsoString(row.created_at),
    displayName: row.display_name,
    email: row.email,
    id: Number(row.id),
    // The CHECK constraint on the column already guarantees this, so a value
    // that fails isRole means the two lists drifted apart. Falling back to the
    // least privileged role is the safe way to be wrong.
    // Same reasoning as the role below: the CHECK constraint already promises
    // this, so anything else means the column and i18n/lang.ts drifted apart,
    // and Polish is what this interface says when nobody has said otherwise.
    language: isLang(row.language) ? row.language : DEFAULT_LANG,
    role: isRole(row.role) ? row.role : DEFAULT_ROLE,
    status: row.status === 'disabled' ? 'disabled' : 'active',
  }
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
