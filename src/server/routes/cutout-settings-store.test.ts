import assert from 'node:assert/strict'
import test from 'node:test'

import type { PgPool, PgQueryResult } from '../db'
import { readCutoutConfig, readCutoutSettings, saveCutoutMethod } from './cutout-settings-store'

function fakePool(rows: unknown[] = []): {
  calls: { params: unknown[]; text: string }[]
  pool: PgPool
} {
  const calls: { params: unknown[]; text: string }[] = []
  const pool: PgPool = {
    query(text: string, params: unknown[] = []) {
      calls.push({ params, text })
      return Promise.resolve({ rowCount: rows.length, rows } as PgQueryResult<never>)
    },
  }
  return { calls, pool }
}

// Most tests only read, so they take the pool and ignore the recording.
function poolOf(rows: unknown[] = []): PgPool {
  return fakePool(rows).pool
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    gemini_api_key: '',
    gemini_enabled: true,
    local_enabled: true,
    remove_bg_api_key: '',
    removebg_enabled: true,
    threshold: 735,
    ...overrides,
  }
}

function withEnv(values: Record<string, string | undefined>, fn: () => Promise<void>) {
  const previous: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  return fn().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
}

const NO_ENV = {
  GEMINI_API_KEY: undefined,
  REMOVE_BG_API_KEY: undefined,
  TOOLTRACK_CUTOUT_THRESHOLD: undefined,
}

test('a fresh install offers the local method and nothing else', async () => {
  await withEnv(NO_ENV, async () => {
    const settings = await readCutoutSettings(poolOf())
    const byMethod = new Map(settings.methods.map((entry) => [entry.method, entry]))

    // It needs no key, so it works out of the box.
    assert.equal(byMethod.get('local')?.configured, true)
    // The services are listed — an admin has to see they exist — but cannot run.
    assert.equal(byMethod.get('removebg')?.configured, false)
    assert.equal(byMethod.get('gemini')?.configured, false)
    assert.equal(settings.usable, 1)
    assert.equal(settings.threshold, 735)

    assert.deepEqual((await readCutoutConfig(poolOf())).allowed, ['local'])
  })
})

test('a key makes a method usable, and the key never leaves the server', async () => {
  await withEnv(NO_ENV, async () => {
    const pool = poolOf([row({ remove_bg_api_key: 'db-key-1234' })])

    const settings = await readCutoutSettings(pool)
    const removebg = settings.methods.find((entry) => entry.method === 'removebg')

    assert.equal(removebg?.configured, true)
    assert.equal(removebg?.keySource, 'database')
    assert.equal(removebg?.keyHint, '••••1234')
    assert.ok(!JSON.stringify(settings).includes('db-key-1234'), 'klucz nie może wyciec')
  })
})

test('the environment is the bootstrap until something is saved', async () => {
  await withEnv(
    { ...NO_ENV, GEMINI_API_KEY: 'env-key', TOOLTRACK_CUTOUT_THRESHOLD: '700' },
    async () => {
      const settings = await readCutoutSettings(poolOf())
      const gemini = settings.methods.find((entry) => entry.method === 'gemini')

      assert.equal(gemini?.configured, true)
      assert.equal(gemini?.keySource, 'environment')
      assert.equal(settings.threshold, 700)
    },
  )
})

test('a saved threshold wins over the environment', async () => {
  await withEnv({ ...NO_ENV, TOOLTRACK_CUTOUT_THRESHOLD: '700' }, async () => {
    assert.equal((await readCutoutSettings(poolOf([row({ threshold: 690 })]))).threshold, 690)
  })
})

test('an unusable environment threshold falls back instead of breaking every cutout', async () => {
  // 900 is above pure white, where every pixel would be background.
  await withEnv({ ...NO_ENV, TOOLTRACK_CUTOUT_THRESHOLD: '900' }, async () => {
    assert.equal((await readCutoutSettings(poolOf())).threshold, 735)
  })
})

test('a switched-off method is not offered, key or no key', async () => {
  await withEnv(NO_ENV, async () => {
    const pool = poolOf([row({ local_enabled: false, remove_bg_api_key: 'k' })])

    const settings = await readCutoutSettings(pool)
    const local = settings.methods.find((entry) => entry.method === 'local')

    // Still configured — it needs nothing — but switched off for everyone.
    assert.equal(local?.configured, true)
    assert.equal(local?.enabled, false)
    assert.deepEqual((await readCutoutConfig(pool)).allowed, ['removebg'])
  })
})

test('everything off is how the feature is switched off', async () => {
  await withEnv(NO_ENV, async () => {
    const pool = poolOf([
      row({ gemini_enabled: false, local_enabled: false, removebg_enabled: false }),
    ])

    assert.equal((await readCutoutSettings(pool)).usable, 0)
    assert.deepEqual((await readCutoutConfig(pool)).allowed, [])
  })
})

test('a method with no key column writes no key parameter', async () => {
  // The local method has nothing to store a key in. A placeholder for one
  // would leave the statement with a parameter it never mentions, and Postgres
  // refuses the whole request: "could not determine data type of parameter $2".
  const { calls, pool } = fakePool()

  await saveCutoutMethod('local', { enabled: false }, 7, pool)

  const [{ params, text }] = calls
  assert.deepEqual(params, [false, 7])
  assert.doesNotMatch(text, /api_key/)
  assert.match(text, /"local_enabled"/)
})

test('a key is written only when one was sent', async () => {
  const { calls, pool } = fakePool()

  await saveCutoutMethod('removebg', { enabled: true }, 7, pool)
  // No key in the body: the stored one must not be touched.
  assert.deepEqual(calls[0].params, [true, 7])
  assert.doesNotMatch(calls[0].text, /remove_bg_api_key/)

  await saveCutoutMethod('removebg', { apiKey: 'nowy' }, 7, pool)
  assert.deepEqual(calls[1].params, [null, 'nowy', 7])
  assert.match(calls[1].text, /"remove_bg_api_key" = \$2/)
})
