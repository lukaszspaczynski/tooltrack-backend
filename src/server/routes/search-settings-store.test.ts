import assert from 'node:assert/strict'
import test from 'node:test'

import type { PgPool, PgQueryResult } from '../db'
import {
  credentialsForSearch,
  listEngineSettings,
  resolveProvidersFor,
} from './search-settings-store'

type Call = { params: unknown[]; text: string }

// The store makes two reads per call — the global rows, then this account's
// switches — so the fake answers in that order.
function fakePool(globals: unknown[] = [], mine: unknown[] = []): { calls: Call[]; pool: PgPool } {
  const calls: Call[] = []
  const pool: PgPool = {
    query(text: string, params: unknown[] = []) {
      calls.push({ params, text })
      const rows = text.includes('user_search_engine') ? mine : globals
      return Promise.resolve({ rowCount: rows.length, rows } as PgQueryResult<never>)
    },
  }
  return { calls, pool }
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
  BRAVE_SEARCH_API_KEY: undefined,
  GOOGLE_SEARCH_API_KEY: undefined,
  GOOGLE_SEARCH_CX: undefined,
}

test('a fresh install has the engines that need no key, and only those', async () => {
  await withEnv(NO_ENV, async () => {
    const { pool } = fakePool()

    const engines = await listEngineSettings(1, pool)
    const byProvider = new Map(engines.map((engine) => [engine.provider, engine]))

    // No key needed, so they work out of the box.
    assert.equal(byProvider.get('openverse')?.configured, true)
    assert.equal(byProvider.get('mistama')?.configured, true)
    // Keyed engines are listed but not usable until someone configures them.
    assert.equal(byProvider.get('google')?.configured, false)
    assert.equal(byProvider.get('brave')?.configured, false)
    // Nobody has switched anything off yet.
    assert.ok(engines.every((engine) => engine.globallyEnabled && engine.usedByMe))

    assert.deepEqual(await resolveProvidersFor(1, pool), ['mistama', 'openverse'])
  })
})

test('an environment variable configures an engine until the database does', async () => {
  await withEnv(
    { ...NO_ENV, GOOGLE_SEARCH_API_KEY: 'env-key', GOOGLE_SEARCH_CX: 'env-cx' },
    async () => {
      const { pool } = fakePool()

      const google = (await listEngineSettings(1, pool)).find((e) => e.provider === 'google')

      assert.equal(google?.configured, true)
      assert.equal(google?.keySource, 'environment')
      // Never the key itself — only that it is set, and its last four characters.
      assert.equal(google?.keyHint, '••••-key')
    },
  )
})

test('a key saved in the database wins over the environment', async () => {
  await withEnv(
    { ...NO_ENV, GOOGLE_SEARCH_API_KEY: 'env-key', GOOGLE_SEARCH_CX: 'env-cx' },
    async () => {
      const { pool } = fakePool([
        { api_key: 'db-key-1234', api_secret: 'db-cx', enabled: true, provider: 'google' },
      ])

      const google = (await listEngineSettings(1, pool)).find((e) => e.provider === 'google')

      assert.equal(google?.keySource, 'database')
      assert.equal(google?.keyHint, '••••1234')
    },
  )
})

test('a half-configured engine is not usable', async () => {
  await withEnv(NO_ENV, async () => {
    // Google needs both a key and a search engine id; one without the other
    // only produces a 400 from the provider.
    const { pool } = fakePool([
      { api_key: 'only-the-key', api_secret: '', enabled: true, provider: 'google' },
    ])

    const google = (await listEngineSettings(1, pool)).find((e) => e.provider === 'google')

    assert.equal(google?.configured, false)
    assert.deepEqual(await resolveProvidersFor(1, pool), ['mistama', 'openverse'])
  })
})

test('the global switch beats the account switch', async () => {
  await withEnv(NO_ENV, async () => {
    const { pool } = fakePool([
      { api_key: '', api_secret: '', enabled: false, provider: 'openverse' },
    ])

    const openverse = (await listEngineSettings(1, pool)).find((e) => e.provider === 'openverse')

    // Still configured — it needs no key — but switched off for everyone.
    assert.equal(openverse?.configured, true)
    assert.equal(openverse?.globallyEnabled, false)
    // The other keyless engine is untouched by that switch.
    assert.deepEqual(await resolveProvidersFor(1, pool), ['mistama'])
  })
})

test('an account can opt out of an engine that is on for everyone else', async () => {
  await withEnv({ ...NO_ENV, BRAVE_SEARCH_API_KEY: 'brave-key' }, async () => {
    const { pool } = fakePool([], [{ enabled: false, provider: 'openverse' }])

    const engines = await listEngineSettings(7, pool)

    assert.equal(engines.find((e) => e.provider === 'openverse')?.usedByMe, false)
    assert.equal(engines.find((e) => e.provider === 'brave')?.usedByMe, true)
    assert.deepEqual(await resolveProvidersFor(7, pool), ['brave', 'mistama'])
  })
})

test('credentials are fetched separately from the list that goes to a browser', async () => {
  await withEnv(NO_ENV, async () => {
    const { pool } = fakePool([
      { api_key: 'secret-key', api_secret: 'secret-cx', enabled: true, provider: 'google' },
    ])

    const credentials = await credentialsForSearch(['google', 'openverse'], pool)

    assert.deepEqual(credentials.get('google'), { key: 'secret-key', secret: 'secret-cx' })
    assert.deepEqual(credentials.get('openverse'), { key: '', secret: '' })

    // And the list really does not carry them.
    const listed = JSON.stringify(await listEngineSettings(1, pool))
    assert.ok(!listed.includes('secret-key'), 'klucz nie może wyciec na listę')
  })
})
