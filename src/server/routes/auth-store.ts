// Accounts and sessions: everything that touches `account.user_account` and
// `account.session`. The route modules above it do no SQL of their own.
//
// The login model is deliberately boring — an opaque random token in an
// HttpOnly cookie, its SHA-256 stored server side. No JWT: revoking a session
// has to mean the session stops working, and that is a DELETE here rather than
// a token that keeps being valid until it expires.

import crypto from 'node:crypto'

import {
  DEFAULT_ROLE,
  isRole,
  normalizeEmail,
  type AccountStatus,
  type Role,
  type User,
} from '../../access/roles'
import { db, type PgPool } from '../db'
import { t } from '../i18n'

export const SESSION_COOKIE = 'tooltrack_session'

const PBKDF2_ITERATIONS = 210_000
const PBKDF2_KEY_BYTES = 32
const PBKDF2_DIGEST = 'sha512'
const SALT_BYTES = 16
const TOKEN_BYTES = 32

// Every account column except the two password ones. Written once so a new
// column cannot be added to one query and forgotten in the other four. The
// alias is for the queries that read the account through a join.
const USER_COLUMN_NAMES = ['id', 'email', 'display_name', 'role', 'status', 'created_at']

function userColumns(alias?: string): string {
  const prefix = alias ? `"${alias}".` : ''
  return USER_COLUMN_NAMES.map((name) => `${prefix}"${name}"`).join(', ')
}

type UserRow = {
  created_at: Date | string
  display_name: string
  email: string
  id: number | string
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
  user: User
}

export class EmailTakenError extends Error {
  constructor() {
    super(t('Konto z tym adresem już istnieje'))
    this.name = 'EmailTakenError'
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

export async function issueSession(userId: number, pool: PgPool = db()): Promise<Session> {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url')
  const expiresAt = new Date(Date.now() + sessionTtlDays() * 24 * 60 * 60 * 1000)

  const result = await pool.query<UserRow>(
    `
      WITH "new_session" AS (
        INSERT INTO "account"."session" ("user_id", "token_hash", "expires_at")
        VALUES ($1, $2, $3)
        RETURNING "user_id"
      )
      SELECT ${userColumns()}
      FROM "account"."user_account"
      WHERE "id" = (SELECT "user_id" FROM "new_session")
    `,
    [userId, hashToken(token), expiresAt.toISOString()],
  )

  return {
    cookie: sessionCookie(token, expiresAt),
    expiresAt: expiresAt.toISOString(),
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
  const token = readCookie(request.headers.get('cookie'), SESSION_COOKIE)
  if (!token) return null

  // One statement: it touches the session (last_seen_at, which is what tells
  // an admin a login is still in use) and reads the account behind it. An
  // expired row is simply not matched, so an old cookie reads as no session
  // rather than as a session belonging to nobody.
  const result = await pool.query<UserRow>(
    `
      UPDATE "account"."session" AS "s"
      SET "last_seen_at" = now()
      FROM "account"."user_account" AS "a"
      WHERE "s"."token_hash" = $1 AND "s"."expires_at" > now() AND "a"."id" = "s"."user_id"
      RETURNING ${userColumns('a')}
    `,
    [hashToken(token)],
  )

  const row = result.rows[0]
  return row ? toUser(row) : null
}

export async function revokeSession(request: Request, pool: PgPool = db()): Promise<void> {
  const token = readCookie(request.headers.get('cookie'), SESSION_COOKIE)
  if (!token) return

  await pool.query(`DELETE FROM "account"."session" WHERE "token_hash" = $1`, [hashToken(token)])
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

function sessionTtlDays(): number {
  const raw = process.env.SESSION_TTL_DAYS
  if (raw === undefined || raw.trim() === '') return 30

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) return 30
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
    role: isRole(row.role) ? row.role : DEFAULT_ROLE,
    status: row.status === 'disabled' ? 'disabled' : 'active',
  }
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
