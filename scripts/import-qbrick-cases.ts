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
import { addAttribute, listAttributes } from '../src/server/routes/attributes-store'
import { brandIdForImportedName } from '../src/server/routes/brands-store'
import { createCase, updateCase } from '../src/server/routes/cases-store'
import type { PgPool } from '../src/server/db'

type ManifestCase = {
  // Everything the page states about the box, in the order somebody reads one
  // in. These were eleven typed fields until a box stopped being eleven
  // columns; the unit travels in the value, as it does for every parameter.
  attributes?: { name: string; value: string }[]
  manufacturer: string
  name: string
  notes?: string
  sourceUrl?: string
  model?: string
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
    const existing = await existingCases(client)

    let inserted = 0
    let skipped = 0
    let written = 0
    let rewritten = 0
    let linked = 0

    for (const entry of manifest.cases) {
      // Two identical cases on the shelf are a legitimate pair of rows, so the
      // EAN cannot be the key. The importer dedupes on what a person would
      // read as "the same card" instead: the maker and the name. Re-running it
      // must not produce a second copy of the whole shelf.
      const key = caseKey(entry)
      const already = existing.get(key)

      if (already !== undefined) {
        // The case is there; its spec sheet may not be. Topping it up is what
        // makes a second run worth anything, and it is why this adds the rows
        // that are missing rather than replacing the sheet: somebody may have
        // typed a parameter of their own, and a seeder has no business
        // deciding that a page knows better.
        written += await topUpAttributes(pool, already, entry, actorId, apply)
        rewritten += await refreshNotes(client, pool, already, entry, actorId, apply)
        linked += await refreshReference(client, pool, already, entry, actorId, apply)
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
      // `sourceUrl` is what the manifest calls it and `referenceUrl` is what a
      // case calls it. One name for the page a row was read from would be
      // nicer, but the manifest is frozen data and renaming a key in it is a
      // rewrite of the file rather than of the code.
      const parsed = parseCaseCreate({
        ...entry,
        brandId: await brandIdForImportedName(entry.manufacturer, actorId, pool),
        referenceUrl: entry.sourceUrl ?? '',
      })
      if (!parsed.ok) throw new Error(`${entry.name}: ${parsed.error}`)

      const created = await createCase(parsed.value, actorId, pool)
      written += await topUpAttributes(pool, created.id, entry, actorId, apply)
      existing.set(key, created.id)
      inserted += 1
      console.log(`[qbrick] dodano ${entry.name}`)
    }

    console.log(
      apply
        ? `[qbrick] gotowe: dodano ${inserted}, pominięto ${skipped} (już w katalogu), parametrów zapisano ${written}, opisów poprawiono ${rewritten}, adresów uzupełniono ${linked}`
        : `[qbrick] próba: dodałoby ${inserted}, pominęłoby ${skipped}, zapisałoby ${written} parametrów, ${rewritten} opisów i ${linked} adresów. Uruchom z --apply, żeby zapisać.`,
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

// A decimal point that moved while somebody was copying a table. The check
// survives the move to parameters by reading them back: frozen data nobody
// re-derives is exactly the data worth checking.
function fitsInside(entry: ManifestCase): null | string {
  const mm = (name: string) => {
    const raw = entry.attributes?.find((one) => one.name === name)?.value
    const parsed = Number((raw ?? '').replace(' mm', '').replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }

  for (const axis of ['Długość', 'Szerokość', 'Wysokość']) {
    const inner = mm(`${axis} wewnętrzna`)
    const outer = mm(`${axis} zewnętrzna`)
    if (inner !== null && outer !== null && inner > outer) {
      return `${axis.toLowerCase()} wewnętrzna (${inner}) większa niż zewnętrzna (${outer})`
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

async function existingCases(client: pg.Client): Promise<Map<string, number>> {
  // The maker is a row the box points at, so "the same case" is read through
  // the join. COALESCE keeps a box with no maker comparable with a manifest
  // entry that names none.
  const result = await client.query<{ id: string; manufacturer: string; name: string }>(
    `
      SELECT "c"."id", "c"."name", coalesce("b"."name", '') AS "manufacturer"
      FROM "catalog"."tool_case" AS "c"
      LEFT JOIN "catalog"."brand" AS "b" ON "b"."id" = "c"."brand_id"
    `,
  )

  return new Map(result.rows.map((row) => [caseKey(row), Number(row.id)]))
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

// The parameters a case is missing, added without touching the ones it has.
//
// `replaceAttributes` would be wrong here. It is what the live import uses,
// where the page is the source of truth and a parameter the maker dropped
// should leave the card — but this is a seeder, run again months later, and
// what it must not do is delete a line somebody typed themselves.
async function topUpAttributes(
  pool: PgPool,
  caseId: number,
  entry: ManifestCase,
  actorId: number,
  apply: boolean,
): Promise<number> {
  const wanted = entry.attributes ?? []
  if (wanted.length === 0) return 0

  const present = new Set(
    (await listAttributes('tool_case', caseId, pool)).map((attribute) =>
      attribute.name.trim().toLowerCase(),
    ),
  )

  const missing = wanted.filter((attribute) => !present.has(attribute.name.trim().toLowerCase()))
  if (missing.length === 0) return 0

  if (!apply) {
    for (const attribute of missing) {
      console.log(`[qbrick]   + ${entry.name}: ${attribute.name} = ${attribute.value}`)
    }
    return missing.length
  }

  for (const attribute of missing) {
    await addAttribute('tool_case', caseId, attribute, actorId, pool)
  }

  console.log(`[qbrick] ${entry.name}: zapisano ${missing.length} parametrów`)

  return missing.length
}

// The note, brought back in line with the manifest.
//
// This one does overwrite, unlike the parameters, because the note is a
// sentence the manifest owns rather than a list somebody adds to — and it has
// to, now that the address and the weight have left it for parameters of their
// own. A case whose note already matches is left alone, so a second run is
// silent.
async function refreshNotes(
  client: pg.Client,
  pool: PgPool,
  caseId: number,
  entry: ManifestCase,
  actorId: number,
  apply: boolean,
): Promise<number> {
  const wanted = (entry.notes ?? '').trim()

  const current = await client.query<{ notes: string }>(
    `SELECT "notes" FROM "catalog"."tool_case" WHERE "id" = $1`,
    [caseId],
  )

  if ((current.rows[0]?.notes ?? '').trim() === wanted) return 0

  if (!apply) {
    console.log(`[qbrick]   ~ ${entry.name}: opis → ${wanted || '(pusty)'}`)
    return 1
  }

  await updateCase(caseId, { notes: wanted }, actorId, pool)
  console.log(`[qbrick] ${entry.name}: poprawiono opis`)

  return 1
}

// The address the manifest read the numbers from, as the case's own field.
//
// It was a parameter called Referencja until it became a column, and this is
// the same kind of write refreshNotes is rather than the kind topUpAttributes
// is: the manifest owns it, so a case pointing somewhere else is corrected. A
// case already pointing there is left alone, which is what keeps a second run
// silent.
async function refreshReference(
  client: pg.Client,
  pool: PgPool,
  caseId: number,
  entry: ManifestCase,
  actorId: number,
  apply: boolean,
): Promise<number> {
  const wanted = (entry.sourceUrl ?? '').trim()
  if (!wanted) return 0

  const current = await client.query<{ reference_url: string }>(
    `SELECT "reference_url" FROM "catalog"."tool_case" WHERE "id" = $1`,
    [caseId],
  )

  if ((current.rows[0]?.reference_url ?? '').trim() === wanted) return 0

  if (!apply) {
    console.log(`[qbrick]   ~ ${entry.name}: adres → ${wanted}`)
    return 1
  }

  await updateCase(caseId, { referenceUrl: wanted }, actorId, pool)
  console.log(`[qbrick] ${entry.name}: zapisano adres`)

  return 1
}
