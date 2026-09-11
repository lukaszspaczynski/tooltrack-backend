// Imports the five Qbrick cases from the manufacturer's product pages.
//
//   npm run qbrick:cases                      # validate and report, writes nothing
//   npm run qbrick:cases -- --apply           # insert what is missing
//   npm run qbrick:cases -- --apply --actor ola@example.com
//
// Validation-only by default, like every importer here: the first run tells
// you what it would do, the second one does it.
//
// The manifest in scripts/data/qbrick-cases.json is frozen from the pages
// rather than fetched live. A catalog that changed because a shop restyled its
// spec table would be a catalog nobody could trust twice.

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import 'dotenv/config'

import pg from 'pg'

import { parseCaseCreate } from '../src/server/routes/cases-input'
import { createCase } from '../src/server/routes/cases-store'
import type { PgPool } from '../src/server/db'

type ManifestCase = {
  capacityL?: null | number
  diagonalMm?: null | number
  ean?: string
  innerHeightMm?: null | number
  innerLengthMm?: null | number
  innerWidthMm?: null | number
  loadKg?: null | number
  manufacturer: string
  name: string
  notes?: string
  outerHeightMm?: null | number
  outerLengthMm?: null | number
  outerWidthMm?: null | number
  sku?: string
  sourceUrl?: string
  system?: string
}

type Manifest = {
  cases: ManifestCase[]
  generatedAt: string
  note: string
  source: string
}

const MANIFEST_PATH = join(dirname(fileURLToPath(import.meta.url)), 'data/qbrick-cases.json')

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required')

  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as Manifest
  const problems = validate(manifest)
  if (problems.length > 0) {
    for (const problem of problems) console.error(`[qbrick] ${problem}`)
    throw new Error(`Manifest has ${problems.length} problem(s)`)
  }

  console.log(`[qbrick] ${manifest.cases.length} skrzynek w manifeście (${manifest.generatedAt})`)

  const apply = process.argv.includes('--apply')
  const client = new pg.Client({ connectionString })
  await client.connect()
  const pool = client as unknown as PgPool

  try {
    const actorId = await resolveActor(client, argValue('--actor'))
    const existing = await existingKeys(client)

    let inserted = 0
    let skipped = 0

    for (const entry of manifest.cases) {
      // Two identical cases on the shelf are a legitimate pair of rows, so the
      // EAN cannot be the key. The importer dedupes on what a person would
      // read as "the same card" instead: the maker and the name. Re-running it
      // must not produce a second copy of the whole shelf.
      const key = caseKey(entry)
      if (existing.has(key)) {
        skipped += 1
        continue
      }

      if (!apply) {
        console.log(`[qbrick] + ${entry.name}`)
        inserted += 1
        continue
      }

      // Through the same parser the API uses, so an import cannot write a case
      // that a PATCH would then refuse to edit.
      const parsed = parseCaseCreate(entry)
      if (!parsed.ok) throw new Error(`${entry.name}: ${parsed.error}`)

      await createCase(parsed.value, actorId, pool)
      existing.add(key)
      inserted += 1
      console.log(`[qbrick] dodano ${entry.name}`)
    }

    console.log(
      apply
        ? `[qbrick] gotowe: dodano ${inserted}, pominięto ${skipped} (już w katalogu)`
        : `[qbrick] próba: dodałoby ${inserted}, pominęłoby ${skipped}. Uruchom z --apply, żeby zapisać.`,
    )
  } finally {
    await client.end()
  }
}

function validate(manifest: Manifest): string[] {
  const problems: string[] = []
  const seen = new Set<string>()

  if (!Array.isArray(manifest.cases) || manifest.cases.length === 0) {
    return ['manifest zawiera zero skrzynek']
  }

  for (const [index, entry] of manifest.cases.entries()) {
    const where = `pozycja ${index + 1} (${entry.name || 'bez nazwy'})`

    // The parser is the rule, here as in the API: bounds, types and the two
    // required fields are its business, not a second list kept in this file.
    const parsed = parseCaseCreate(entry)
    if (!parsed.ok) problems.push(`${where}: ${parsed.error}`)

    // Internal dimensions that exceed the external ones mean a decimal point
    // moved while somebody was copying a table.
    const fits = fitsInside(entry)
    if (fits) problems.push(`${where}: ${fits}`)

    const key = caseKey(entry)
    if (seen.has(key)) problems.push(`${where}: duplikat w manifeście`)
    seen.add(key)
  }

  return problems
}

function fitsInside(entry: ManifestCase): null | string {
  const pairs: [string, null | number | undefined, null | number | undefined][] = [
    ['długość', entry.innerLengthMm, entry.outerLengthMm],
    ['szerokość', entry.innerWidthMm, entry.outerWidthMm],
    ['wysokość', entry.innerHeightMm, entry.outerHeightMm],
  ]

  for (const [label, inner, outer] of pairs) {
    if (typeof inner === 'number' && typeof outer === 'number' && inner > outer) {
      return `${label} wewnętrzna (${inner}) większa niż zewnętrzna (${outer})`
    }
  }

  return null
}

// The account the cards are recorded as created by. A named one with --actor,
// otherwise the oldest active admin — on a fresh install that is the person who
// ran `npm run user:admin`, which is who is doing this import.
async function resolveActor(client: pg.Client, email: null | string): Promise<number> {
  if (email) {
    const result = await client.query<{ id: string }>(
      `SELECT "id" FROM "account"."user_account" WHERE "email" = $1 AND "status" = 'active'`,
      [email.trim().toLowerCase()],
    )
    const id = result.rows[0]?.id
    if (!id) throw new Error(`Brak aktywnego konta ${email}`)
    return Number(id)
  }

  const result = await client.query<{ id: string }>(
    `SELECT "id" FROM "account"."user_account"
     WHERE "role" = 'admin' AND "status" = 'active'
     ORDER BY "id" ASC LIMIT 1`,
  )
  const id = result.rows[0]?.id
  if (!id) {
    throw new Error('Brak aktywnego administratora. Uruchom najpierw `npm run user:admin`.')
  }
  return Number(id)
}

async function existingKeys(client: pg.Client): Promise<Set<string>> {
  const result = await client.query<{ manufacturer: string; name: string }>(
    `SELECT "name", "manufacturer" FROM "catalog"."tool_case"`,
  )

  return new Set(result.rows.map(caseKey))
}

function caseKey(entry: { manufacturer: string; name: string }): string {
  return [entry.name, entry.manufacturer].map((part) => part.trim().toLowerCase()).join(' | ')
}

function argValue(flag: string): null | string {
  const index = process.argv.indexOf(flag)
  if (index < 0) return null
  return process.argv[index + 1] ?? null
}

main().catch((error) => {
  console.error('[qbrick] nie powiodło się:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
