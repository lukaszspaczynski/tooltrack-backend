// Creates or repairs one admin account.
//
//   npm run user:admin -- --email ola@example.com --password 'sekret1234'
//
// This exists because every registration is a viewer (src/access/roles.ts), so
// a fresh database has nobody who can promote anyone. Run it once, sign in,
// and manage the rest from /api/users. It is idempotent: an existing account
// is promoted to an active admin, and its password is only replaced when
// --password is given.

import 'dotenv/config'

import pg from 'pg'

import { normalizeEmail } from '../src/access/roles'
import { createUser, setPassword, updateUser } from '../src/server/routes/auth-store'
import type { PgPool } from '../src/server/db'

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required')

  const email = normalizeEmail(argValue('--email') ?? process.env.ADMIN_EMAIL ?? '')
  const password = argValue('--password') ?? process.env.ADMIN_PASSWORD ?? ''
  if (!email) throw new Error('--email is required')

  const client = new pg.Client({ connectionString })
  await client.connect()
  const pool = client as unknown as PgPool

  try {
    const existing = await client.query<{ id: string }>(
      `SELECT "id" FROM "account"."user_account" WHERE "email" = $1`,
      [email],
    )

    if (existing.rows.length === 0) {
      if (!password) throw new Error('--password is required to create a new account')

      const created = await createUser({ displayName: email.split('@')[0], email, password }, pool)
      await updateUser(created.id, { role: 'admin', status: 'active' }, pool)
      console.log(`[admin] created ${email} as admin`)
      return
    }

    const id = Number(existing.rows[0].id)
    await updateUser(id, { role: 'admin', status: 'active' }, pool)
    if (password) {
      // Also ends every open session for that account, which is the point when
      // this is being used to recover one.
      await setPassword(id, password, pool)
      console.log(`[admin] promoted ${email} and reset its password`)
      return
    }

    console.log(`[admin] promoted ${email} to admin`)
  } finally {
    await client.end()
  }
}

function argValue(flag: string): null | string {
  const index = process.argv.indexOf(flag)
  if (index < 0) return null
  return process.argv[index + 1] ?? null
}

main().catch((error) => {
  console.error('[admin] failed', error)
  process.exitCode = 1
})
