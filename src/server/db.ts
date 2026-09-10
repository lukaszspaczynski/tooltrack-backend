// The single Postgres pool, created the first time something asks for it.
//
// There is no ORM and no query builder here on purpose: the schema is small
// enough to read, and every statement in this repo is the statement that runs.
// Stores take a pool as an argument where they can, so their tests can hand in
// a recording fake instead of reaching a database.

import pg from 'pg'
import type { Pool as NodePgPool, QueryResultRow } from 'pg'

export type PgQueryResult<T extends QueryResultRow = QueryResultRow> = {
  rowCount: null | number
  rows: T[]
}

export type PgPool = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<PgQueryResult<T>>
}

export type PgClient = PgPool & {
  release(): void
}

export type PgPoolWithConnect = PgPool & {
  connect(): Promise<PgClient>
  end(): Promise<void>
}

let pool: null | NodePgPool = null

export function db(): PgPoolWithConnect {
  if (pool) return pool as unknown as PgPoolWithConnect

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for Postgres access')
  }

  pool = new pg.Pool({
    connectionString,
    // Small bounds on purpose. This API serves a catalog, not a fan-out job,
    // and a container that opens thirty connections under a burst is how a
    // shared Postgres runs out of them.
    connectionTimeoutMillis: numberFromEnv('PG_CONNECTION_TIMEOUT_MS', 2000),
    idle_in_transaction_session_timeout: numberFromEnv('PG_IDLE_IN_TRANSACTION_TIMEOUT_MS', 10000),
    max: numberFromEnv('PG_POOL_MAX', 5),
    statement_timeout: numberFromEnv('PG_STATEMENT_TIMEOUT_MS', 10000),
  })

  // An idle client that errors is re-emitted on the pool, and an 'error' event
  // with no listener takes the process down.
  pool.on('error', (error) => {
    console.error('[db] idle client error', error)
  })

  return pool as unknown as PgPoolWithConnect
}

// Runs fn on one connection inside a transaction. `pool.query('BEGIN')` is not
// a transaction: the pool hands the connection back after every statement, so
// BEGIN and COMMIT can land on different connections and leave one idle inside
// an open transaction. A pool without `connect` (a test fake) runs the callback
// against the pool itself, which is what its recording is meant to show.
export async function withTransaction<T>(
  target: PgPool,
  fn: (client: PgClient) => Promise<T>,
): Promise<T> {
  const connect = (target as Partial<PgPoolWithConnect>).connect
  if (typeof connect !== 'function') return fn(asClient(target))

  const client = await connect.call(target)
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

function asClient(target: PgPool): PgClient {
  return {
    query(text, params) {
      return target.query(text, params)
    },
    release() {
      // A fake pool has no connection to give back.
    },
  }
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback

  const parsed = Number(raw)
  // Refused by name rather than silently replaced by the default: a typo in a
  // deploy variable should be visible at boot, not two weeks later in a
  // latency graph.
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a whole number of milliseconds, got ${JSON.stringify(raw)}`)
  }
  return parsed
}
