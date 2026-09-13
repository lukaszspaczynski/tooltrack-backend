import assert from 'node:assert/strict'
import test from 'node:test'

import type { PgClient, PgPool, PgQueryResult } from '../db'
import { isPdf, titleFromFileName } from '../manual-storage'
import { contentDisposition } from './manuals'
import {
  exclusiveManualIds,
  insertManual,
  linkManual,
  ManualAlreadyOnCardError,
  renameManual,
  unlinkManual,
} from './manuals-store'

type Call = { params: unknown[]; text: string }

function fakePool(results: unknown[][] = []): { calls: Call[]; pool: PgPool } {
  const calls: Call[] = []
  let index = 0

  const query = (text: string, params: unknown[] = []) => {
    calls.push({ params, text })
    const rows = results[index++] ?? []
    return Promise.resolve({ rowCount: rows.length, rows } as PgQueryResult<never>)
  }

  const pool = {
    connect: () => Promise.resolve({ query, release: () => {} } as unknown as PgClient),
    query,
  } as unknown as PgPool

  return { calls, pool }
}

function manualRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    byte_size: '812345',
    checksum: 'a'.repeat(64),
    created_at: '2026-09-13T00:00:00.000Z',
    created_by: '3',
    id: '5',
    source: 'import',
    source_url: 'https://www.bosch-diy.com/storage/pl-pl/citymower.pdf',
    storage_key: 'aa/aaa.pdf',
    title: 'Instrukcja obsługi',
    ...overrides,
  }
}

test('the same document twice is one row, not a second copy', async () => {
  // A manual describes a model. The same PDF uploaded from a laptop and
  // fetched from the maker's site is one file with one title.
  const { calls, pool } = fakePool([[], [manualRow()]])

  const manual = await insertManual(
    {
      source: 'upload',
      stored: { byteSize: 812345, checksum: 'a'.repeat(64), storageKey: 'aa/aaa.pdf' },
      title: 'Instrukcja obsługi',
    },
    3,
    pool,
  )

  assert.equal(manual.id, 5)
  assert.match(calls[0].text, /ON CONFLICT \("checksum"\) DO NOTHING/)
  // The insert found nothing to return, so the existing row is read.
  assert.match(calls[1].text, /WHERE "checksum" = \$1/)
})

test('a manual carries the address it is served from', async () => {
  const { pool } = fakePool([[manualRow()]])

  const manual = await insertManual(
    {
      source: 'import',
      stored: { byteSize: 1, checksum: 'b'.repeat(64), storageKey: 'bb/bbb.pdf' },
      title: 'Instrukcja',
    },
    3,
    pool,
  )

  assert.equal(manual.url, '/api/manuals/5/file')
  assert.equal(manual.source, 'import')
})

test('putting the same manual on one card twice is refused, not duplicated', async () => {
  const { pool } = fakePool([[]])

  await assert.rejects(() => linkManual(7, 5, 3, pool), ManualAlreadyOnCardError)
})

test('renaming is scoped to the card that asked', async () => {
  // The id in the path came from somewhere, but not necessarily from a card
  // this person was looking at.
  const { calls, pool } = fakePool([[manualRow({ title: 'Schemat części' })]])

  const manual = await renameManual(7, 5, 'Schemat części', pool)

  assert.equal(manual?.title, 'Schemat części')
  assert.match(calls[0].text, /FROM "catalog"\."manual_tool"[\s\S]*"tool_id" = \$1/)
  assert.deepEqual(calls[0].params, [7, 5, 'Schemat części'])
})

test('taking a manual off its last card deletes the document', async () => {
  // A bin on a card means the file is gone, not that it moved to a shelf
  // nobody asked to fill.
  const { calls, pool } = fakePool([
    [], // BEGIN
    [{}], // the link, removed
    [{ storage_key: 'aa/aaa.pdf' }], // no card keeps it any more
    [], // nothing else points at the file
  ])

  assert.equal(await unlinkManual(7, 5, pool), true)
  assert.match(calls[2].text, /DELETE FROM "catalog"\."manual"/)
  assert.match(calls[2].text, /NOT EXISTS \(SELECT 1 FROM "catalog"\."manual_tool"/)
})

test('a manual another card keeps survives being taken off this one', async () => {
  const { calls, pool } = fakePool([[], [{}], []])

  assert.equal(await unlinkManual(7, 5, pool), true)
  // The conditional delete matched nothing, so no file is unlinked.
  assert.equal(calls.filter((call) => /DELETE FROM "catalog"\."manual" /.test(call.text)).length, 1)
})

test('what a card is the only keeper of is asked before it is deleted', async () => {
  const { calls, pool } = fakePool([[{ manual_id: '5' }]])

  assert.deepEqual(await exclusiveManualIds(7, pool), [5])
  assert.match(calls[0].text, /"other"\."tool_id" <> \$1/)
})

test('the bytes decide whether a file is a PDF', () => {
  // A shop answering with an HTML error page under a `.pdf` address is the
  // common case; the header and the extension both say PDF and both are wrong.
  assert.equal(isPdf(new TextEncoder().encode('%PDF-1.7\nrest of it')), true)
  assert.equal(isPdf(new TextEncoder().encode('<!DOCTYPE html><title>404</title>')), false)
  assert.equal(isPdf(new Uint8Array()), false)
  // Some generators put junk before the header.
  assert.equal(isPdf(new TextEncoder().encode(`${' '.repeat(200)}%PDF-1.4`)), true)
})

test('a file name is a poor title, and better than none', () => {
  assert.equal(titleFromFileName('instrukcja_obslugi_pl.pdf'), 'instrukcja obslugi pl')
  // A hyphen is not an underscore: "185-LI" is a model number, and a title
  // reading "185 LI" names a tool that does not exist.
  assert.equal(titleFromFileName('/tmp/GSB 185-LI.PDF'), 'GSB 185-LI')
  assert.equal(
    titleFromFileName('sao-hg-citymower-original-pdf.pdf'),
    'sao-hg-citymower-original-pdf',
  )
  assert.equal(titleFromFileName(''), '')
})

test('a Polish title survives the trip to somebody’s disk', () => {
  // A header is bytes: "obsługi" cannot be written in one at all. So two
  // names — an ASCII one every client can read, and the real one for the
  // clients that can read it.
  const header = contentDisposition('Instrukcja obsługi')

  assert.match(header, /^inline; filename="Instrukcja obsugi\.pdf"/)
  assert.match(header, /filename\*=UTF-8''Instrukcja%20obs%C5%82ugi\.pdf$/)
  // Nothing in it can be encoded: the plain name still has to be something.
  assert.match(contentDisposition('Инструкция'), /filename="instrukcja\.pdf"/)
  assert.match(contentDisposition(''), /filename="instrukcja\.pdf"/)
})
