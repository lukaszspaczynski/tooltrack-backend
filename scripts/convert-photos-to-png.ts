// Converts photos stored before PNG became the only stored format.
//
//   npm run photos:png              # report what would change
//   npm run photos:png -- --apply
//
// Everything new goes through src/server/image-convert.ts on the way in, so
// this is a one-off for rows that predate it. Idempotent: a row already
// holding a PNG is left alone, so a second run reports zero.

import 'dotenv/config'

import pg from 'pg'

import { toStoredPng } from '../src/server/image-convert'
import { readPhotoBytes, savePhotoBytes } from '../src/server/photo-storage'

type Row = {
  content_type: string
  id: string
  storage_key: string
  tool_id: string
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required')

  const apply = process.argv.includes('--apply')
  const client = new pg.Client({ connectionString })
  await client.connect()

  try {
    const result = await client.query<Row>(
      `SELECT "id", "tool_id", "storage_key", "content_type"
       FROM "catalog"."tool_photo"
       WHERE "content_type" <> 'image/png'
       ORDER BY "id"`,
    )

    if (result.rows.length === 0) {
      console.log('[png] wszystkie zdjęcia są już w PNG')
      return
    }

    console.log(`[png] do konwersji: ${result.rows.length}`)

    for (const row of result.rows) {
      const bytes = await readPhotoBytes(row.storage_key)
      if (!bytes) {
        // A row whose file is gone is a broken photo; converting it is not
        // this script's job to fix.
        console.warn(`[png] ${row.id}: brak pliku ${row.storage_key} — pomijam`)
        continue
      }

      const converted = await toStoredPng(bytes)
      const label = `${row.id} (${row.content_type} ${bytes.byteLength}B -> png ${converted.bytes.byteLength}B)`

      if (!apply) {
        console.log(`[png] zmieniłbym ${label}`)
        continue
      }

      const stored = await savePhotoBytes(converted.bytes, converted.metadata.contentType)
      // The old file is left on disk: it may still be shared with another row
      // that has not been converted yet, and an orphaned file costs bytes
      // while a missing one costs a photo.
      await client.query(
        `UPDATE "catalog"."tool_photo"
         SET "storage_key" = $2, "checksum" = $3, "content_type" = $4, "byte_size" = $5,
             "width" = $6, "height" = $7
         WHERE "id" = $1`,
        [
          row.id,
          stored.storageKey,
          stored.checksum,
          converted.metadata.contentType,
          stored.byteSize,
          converted.metadata.width,
          converted.metadata.height,
        ],
      )
      console.log(`[png] przekonwertowano ${label}`)
    }

    console.log(apply ? '[png] gotowe' : '[png] próba — uruchom z --apply, żeby zapisać')
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error('[png] nie powiodło się:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
