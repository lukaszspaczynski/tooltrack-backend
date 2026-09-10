// Imports the tool list from the Qbrick labelling project into the catalog.
//
//   npm run qbrick:import                      # validate and report, writes nothing
//   npm run qbrick:import -- --apply           # insert what is missing
//   npm run qbrick:import -- --apply --actor ola@example.com
//
// Validation-only by default, like every importer here: the first run tells
// you what it would do, the second one does it.
//
// The manifest in scripts/data/qbrick-tools.json is frozen from the source
// project (see its `source` field) rather than read from it live. That project
// is a PDF label generator with its own release cycle; a catalog import must
// not change because someone re-numbered a sticker.
//
// One manifest entry is one physical tool, not one box. Boxes 01 and 11 hold
// two tools, 14 and 15 hold three, so fifteen boxes import as twenty-one cards.

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import 'dotenv/config'

import pg from 'pg'

import { TOOL_CONDITIONS, type ToolCondition } from '../src/server/routes/tools-input'
import { createTool } from '../src/server/routes/tools-store'
import type { PgPool } from '../src/server/db'

type ManifestTool = {
  box: string
  brand: string
  category: string
  condition: string
  model: string
  name: string
  notes: string
  serialNumber: string
}

type Manifest = {
  generatedAt: string
  note: string
  source: string
  tools: ManifestTool[]
}

const MANIFEST_PATH = join(dirname(fileURLToPath(import.meta.url)), 'data/qbrick-tools.json')

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required')

  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as Manifest
  const problems = validate(manifest)
  if (problems.length > 0) {
    for (const problem of problems) console.error(`[qbrick] ${problem}`)
    throw new Error(`Manifest has ${problems.length} problem(s)`)
  }

  console.log(`[qbrick] ${manifest.tools.length} narzędzi w manifeście (${manifest.generatedAt})`)

  const apply = process.argv.includes('--apply')
  const client = new pg.Client({ connectionString })
  await client.connect()
  const pool = client as unknown as PgPool

  try {
    const actorId = await resolveActor(client, argValue('--actor'))
    const existing = await existingKeys(client)

    let inserted = 0
    let skipped = 0

    for (const entry of manifest.tools) {
      // The catalog has no unique key for a tool without a serial number, and
      // none of these have one, so the importer dedupes on what a person would
      // read as "the same card": brand, model and name. Re-running it must not
      // produce a second copy of the whole shed.
      const key = toolKey(entry)
      if (existing.has(key)) {
        skipped += 1
        continue
      }

      if (!apply) {
        console.log(`[qbrick] + ${label(entry)}`)
        inserted += 1
        continue
      }

      await createTool(
        {
          brand: entry.brand,
          category: entry.category,
          condition: entry.condition as ToolCondition,
          model: entry.model,
          name: entry.name,
          notes: entry.notes,
          serialNumber: entry.serialNumber,
        },
        actorId,
        pool,
      )
      existing.add(key)
      inserted += 1
      console.log(`[qbrick] dodano ${label(entry)}`)
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

  if (!Array.isArray(manifest.tools) || manifest.tools.length === 0) {
    return ['manifest zawiera zero narzędzi']
  }

  for (const [index, entry] of manifest.tools.entries()) {
    const where = `pozycja ${index + 1} (${entry.name || 'bez nazwy'})`

    if (!entry.name?.trim()) problems.push(`${where}: brak nazwy`)
    if (!TOOL_CONDITIONS.includes(entry.condition as ToolCondition)) {
      problems.push(`${where}: nieznany stan "${entry.condition}"`)
    }
    if (!entry.box?.trim()) problems.push(`${where}: brak numeru skrzynki`)

    const key = toolKey(entry)
    if (seen.has(key)) problems.push(`${where}: duplikat w manifeście`)
    seen.add(key)
  }

  return problems
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
  const result = await client.query<{ brand: string; model: string; name: string }>(
    `SELECT "name", "brand", "model" FROM "catalog"."tool"`,
  )

  return new Set(result.rows.map(toolKey))
}

function toolKey(entry: { brand: string; model: string; name: string }): string {
  return [entry.name, entry.brand, entry.model].map((part) => part.trim().toLowerCase()).join(' | ')
}

function label(entry: ManifestTool): string {
  const model = entry.model ? ` ${entry.model}` : ''
  return `${entry.name} — ${entry.brand}${model} (skrzynka ${entry.box})`
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
