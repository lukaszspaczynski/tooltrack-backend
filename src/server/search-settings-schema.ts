// DDL for search engine configuration: the global one an admin owns, and the
// per-account switches every user owns for themselves.
//
// The list of providers is interpolated from the registry rather than written
// out here. It was written out once, and adding a fourth engine left a CHECK
// that refused it — the table and the code have to agree, so only one of them
// gets to say.

import { MAX_RESULT_LIMIT, SEARCH_PROVIDERS } from './search-engines'

const PROVIDER_LIST = SEARCH_PROVIDERS.map((provider) => `'${provider}'`).join(', ')

export const SEARCH_SETTINGS_DDL = `
CREATE TABLE IF NOT EXISTS "account"."search_engine" (
  "provider" text PRIMARY KEY CHECK ("provider" IN (${PROVIDER_LIST})),
  -- The global switch. An admin turning an engine off here stops it for
  -- everyone, whatever each account prefers — that is how you stop spending
  -- money on a provider without deleting its key.
  "enabled" boolean NOT NULL DEFAULT true,
  -- Credentials live here rather than only in the environment so they can be
  -- changed without a deploy. They are never sent back to a client.
  "api_key" text NOT NULL DEFAULT '',
  "api_secret" text NOT NULL DEFAULT '',
  -- How many pictures this engine may contribute to one search. Per engine
  -- rather than one number for all of them: an index that found ten plausible
  -- pictures has said what it has to say, while a shop's product card holds
  -- twenty photographs of the one right machine.
  "result_limit" integer NOT NULL DEFAULT 10
    CHECK ("result_limit" BETWEEN 1 AND ${MAX_RESULT_LIMIT}),
  "updated_by" bigint REFERENCES "account"."user_account"("id") ON DELETE SET NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- One row per account per engine, and only for the ones that account has an
-- opinion about: no row means "use it", so a new engine is on for everybody
-- the moment an admin configures it.
CREATE TABLE IF NOT EXISTS "account"."user_search_engine" (
  "user_id" bigint NOT NULL REFERENCES "account"."user_account"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "enabled" boolean NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "provider")
);

-- Databases that predate the fourth engine, and the per-engine limit.
ALTER TABLE "account"."search_engine" DROP CONSTRAINT IF EXISTS "search_engine_provider_check";
ALTER TABLE "account"."search_engine"
  ADD CONSTRAINT "search_engine_provider_check" CHECK ("provider" IN (${PROVIDER_LIST}));
ALTER TABLE "account"."search_engine"
  ADD COLUMN IF NOT EXISTS "result_limit" integer NOT NULL DEFAULT 10;
ALTER TABLE "account"."search_engine" DROP CONSTRAINT IF EXISTS "search_engine_result_limit_check";
ALTER TABLE "account"."search_engine"
  ADD CONSTRAINT "search_engine_result_limit_check"
  CHECK ("result_limit" BETWEEN 1 AND ${MAX_RESULT_LIMIT});

COMMENT ON TABLE "account"."search_engine" IS 'Global image-search configuration. Credentials never leave the server.';
COMMENT ON COLUMN "account"."search_engine"."result_limit" IS 'How many pictures this engine may contribute to one search.';
COMMENT ON TABLE "account"."user_search_engine" IS 'Per-account opt-outs. A missing row means the engine is used.';
`

export const SEARCH_SETTINGS_DROP_DDL = `
DROP TABLE IF EXISTS "account"."user_search_engine";
DROP TABLE IF EXISTS "account"."search_engine";
`
