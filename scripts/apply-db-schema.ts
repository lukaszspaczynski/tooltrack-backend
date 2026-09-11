// Applies the raw schema DDL. This is the only way schema reaches a database:
// there are no migration files, because every statement in src/server/*-schema.ts
// is written to be re-runnable and the schema is small enough to read whole.
//
//   npm run db:schema:apply                 # everything
//   npm run db:schema:apply -- --only account
//   npm run db:schema:apply -- --dry-run
//
// Order matters: catalog.tool references account.user_account, so `account`
// is applied first.

import 'dotenv/config'

import pg from 'pg'

import { ACCOUNT_DDL } from '../src/server/account-schema'
import { CATALOG_DDL } from '../src/server/catalog-schema'
import { ORGANIZER_DDL } from '../src/server/organizer-schema'
import { PHOTO_DDL } from '../src/server/photo-schema'
import { CUTOUT_SETTINGS_DDL } from '../src/server/cutout-settings-schema'
import { SEARCH_SETTINGS_DDL } from '../src/server/search-settings-schema'

const BATCHES = [
  { ddl: ACCOUNT_DDL, name: 'account' },
  { ddl: CATALOG_DDL, name: 'catalog' },
  // After catalog: the photos hang off catalog.tool.
  { ddl: PHOTO_DDL, name: 'photos' },
  { ddl: ORGANIZER_DDL, name: 'organizer' },
  { ddl: SEARCH_SETTINGS_DDL, name: 'settings' },
  { ddl: CUTOUT_SETTINGS_DDL, name: 'cutout-settings' },
] as const

type BatchName = (typeof BATCHES)[number]['name']

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required')

  const only = argValue('--only') as null | BatchName
  if (only && !BATCHES.some((batch) => batch.name === only)) {
    throw new Error(`--only must be one of: ${BATCHES.map((batch) => batch.name).join(', ')}`)
  }

  const selected = only ? BATCHES.filter((batch) => batch.name === only) : BATCHES

  if (!isLocalDatabase(connectionString) && process.env.CONFIRM_REMOTE_SCHEMA !== 'true') {
    // A proxy on 127.0.0.1 can front a production instance, so "local" here is
    // a hint and not a guarantee. Anything that does not look local needs the
    // variable set on the command line, deliberately, by a person.
    throw new Error(
      'DATABASE_URL does not look local. Re-run with CONFIRM_REMOTE_SCHEMA=true if that is intended.',
    )
  }

  // A dry run says what would happen and connects to nothing: it is what you
  // run when you are not sure the URL in .env points where you think it does.
  if (process.argv.includes('--dry-run')) {
    for (const batch of selected) console.log(`[schema] would apply ${batch.name}`)
    console.log(`[schema] dry run against ${redact(connectionString)}`)
    return
  }

  const client = new pg.Client({ connectionString })
  await client.connect()

  try {
    for (const batch of selected) {
      console.log(`[schema] applying ${batch.name}`)
      await client.query(batch.ddl)
    }
  } finally {
    await client.end()
  }

  console.log('[schema] done')
}

function argValue(flag: string): null | string {
  const index = process.argv.indexOf(flag)
  if (index < 0) return null
  return process.argv[index + 1] ?? null
}

// The password never reaches a log line, not even a local one.
function redact(connectionString: string): string {
  try {
    const url = new URL(connectionString)
    if (url.password) url.password = '***'
    return url.toString()
  } catch {
    return '<unparseable DATABASE_URL>'
  }
}

function isLocalDatabase(connectionString: string): boolean {
  try {
    const { hostname } = new URL(connectionString)
    return ['127.0.0.1', '::1', 'localhost'].includes(hostname)
  } catch {
    return false
  }
}

main().catch((error) => {
  console.error('[schema] failed', error)
  process.exitCode = 1
})
