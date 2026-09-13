// DDL for the `account` schema: who can sign in, and what a signed-in session
// is. Applied by scripts/apply-db-schema.ts.
//
// Every statement is written to be re-runnable. The script is the only way
// schema reaches a database, and it will be run again against a database that
// already has some of this.

export const ACCOUNT_DDL = `
CREATE SCHEMA IF NOT EXISTS "account";

CREATE TABLE IF NOT EXISTS "account"."user_account" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Stored already lowercased and trimmed (src/access/roles.ts
  -- normalizeEmail), so a plain unique constraint is the whole story and
  -- nobody can register the same address twice in different casing.
  "email" text NOT NULL UNIQUE,
  "display_name" text NOT NULL DEFAULT '',
  -- PBKDF2-SHA512, hash and salt as hex. See src/server/routes/auth-store.ts.
  "password_hash" text NOT NULL,
  "password_salt" text NOT NULL,
  -- The role list is repeated from src/access/roles.ts on purpose: the
  -- database refuses a value the application would not understand, whatever
  -- wrote it. Both have to change together.
  "role" text NOT NULL DEFAULT 'viewer' CHECK ("role" IN ('viewer', 'editor', 'admin')),
  "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'disabled')),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Added after the table existed, so it arrives as an ALTER for a database that
-- already has accounts in it. The list is repeated from src/server/i18n/lang.ts
-- for the same reason the role list is repeated from roles.ts: the database
-- refuses a value the application would not understand, whatever wrote it.
ALTER TABLE "account"."user_account"
  ADD COLUMN IF NOT EXISTS "language" text NOT NULL DEFAULT 'pl';
ALTER TABLE "account"."user_account" DROP CONSTRAINT IF EXISTS "user_account_language_check";
ALTER TABLE "account"."user_account"
  ADD CONSTRAINT "user_account_language_check" CHECK ("language" IN ('pl', 'en'));

CREATE TABLE IF NOT EXISTS "account"."session" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "user_id" bigint NOT NULL REFERENCES "account"."user_account"("id") ON DELETE CASCADE,
  -- Only the SHA-256 of the opaque token. A dump of this table cannot be used
  -- to sign in as anyone.
  "token_hash" text NOT NULL UNIQUE,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_seen_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "account_session_user_idx" ON "account"."session" ("user_id");
CREATE INDEX IF NOT EXISTS "account_session_expires_idx" ON "account"."session" ("expires_at");

COMMENT ON SCHEMA "account" IS 'ToolTrack accounts and login sessions.';
COMMENT ON COLUMN "account"."user_account"."language" IS 'Which language this account reads the interface in.';
COMMENT ON TABLE "account"."session" IS 'Opaque login sessions. Tokens are stored only as SHA-256 hashes.';
`

export const ACCOUNT_DROP_DDL = `
DROP SCHEMA IF EXISTS "account" CASCADE;
`
