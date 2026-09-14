import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { ERROR_CODES, errorResponse } from './error-codes'

const SERVER = dirname(fileURLToPath(import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return []
    return [path]
  })
}

test('every failure is built through errorResponse, so none can lack a code', () => {
  // Read as text rather than exercised, because the alternative is calling a
  // hundred handlers with a database behind them. What this catches is the one
  // thing that actually goes wrong: somebody adding a route next year and
  // writing `Response.json({ error: … }, { status: 4xx })` out of habit, which
  // compiles, works, and quietly gives a client nothing to branch on.
  const offenders: string[] = []

  for (const path of sourceFiles(SERVER)) {
    const source = readFileSync(path, 'utf8')

    for (const [index, line] of source.split('\n').entries()) {
      // `failed.push({ error, url })` is a per-item record inside a successful
      // answer, not a failure of the request, and has no code of its own.
      if (/failed\.push/.test(line)) continue
      if (/\{ error: /.test(line) && /Response\.json\(/.test(line)) {
        offenders.push(`${path.slice(SERVER.length + 1)}:${index + 1}`)
      }
    }
  }

  assert.deepEqual(offenders, [])
})

test('a code is a name, not a sentence', () => {
  // SCREAMING_SNAKE, because it is an identifier a client writes in a switch.
  for (const code of Object.keys(ERROR_CODES)) {
    assert.match(code, /^[A-Z][A-Z0-9_]*$/, `${code} is not a code`)
  }
})

test('every code says what it means', () => {
  for (const [code, what] of Object.entries(ERROR_CODES)) {
    assert.ok(what.length > 10, `${code} has no useful description`)
  }
})

test('the body carries the code beside the prose', async () => {
  const response = errorResponse(409, 'SERIAL_NUMBER_TAKEN', 'Ten numer już jest')

  assert.equal(response.status, 409)
  assert.deepEqual(await response.json(), {
    code: 'SERIAL_NUMBER_TAKEN',
    error: 'Ten numer już jest',
  })
})

test('extra fields sit beside the code rather than replacing it', async () => {
  // The routes that report what happened to each of several things: a photo
  // import says which addresses failed, and still says what went wrong overall.
  const response = errorResponse(422, 'DOWNLOAD_FAILED', 'Nie udało się', {
    extra: { failed: [{ error: 'timeout', url: 'https://example.test/a.jpg' }] },
  })

  const body = (await response.json()) as Record<string, unknown>
  assert.equal(body.code, 'DOWNLOAD_FAILED')
  assert.ok(Array.isArray(body.failed))
})

test('a 405 carries the header that says what the path does allow', () => {
  const response = errorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed', {
    headers: { allow: 'GET, POST' },
  })

  assert.equal(response.headers.get('allow'), 'GET, POST')
})
