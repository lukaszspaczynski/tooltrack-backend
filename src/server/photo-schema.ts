// DDL for photos. Applied by scripts/apply-db-schema.ts after `catalog`, which
// owns the tools and the cases these hang off.
//
// The bytes do not live here. The row records what the file is, where it came
// from and which storage key holds it; src/server/photo-storage.ts owns the
// file itself. A database that also carries a few hundred megabytes of JPEG is
// a database nobody wants to back up or replicate.
//
// A photo belongs to a tool, or to a case, or to nothing yet. Two columns
// rather than an owner_kind/owner_id pair: with real foreign keys, deleting a
// tool takes its photos with it and no application code has to remember to.

export const PHOTO_DDL = `
-- The table was called tool_photo when tools were the only thing with a
-- picture. Renamed rather than duplicated: a case photo is the same row with a
-- different owner. IF EXISTS makes this a no-op on every run after the first,
-- and on a database that never had the old name.
ALTER TABLE IF EXISTS "catalog"."tool_photo" RENAME TO "photo";
-- The primary key carries the old table's name with it, and a database created
-- this morning would call it photo_pkey. Same reasoning as the indexes below.
ALTER INDEX IF EXISTS "catalog"."tool_photo_pkey" RENAME TO "photo_pkey";

-- The indexes are dropped rather than renamed. Two of the predicates change
-- with cases, and a database that was migrated must not end up with different
-- rules from one created this morning. The CREATE statements below are the
-- single description of what is indexed.
DROP INDEX IF EXISTS "catalog"."catalog_tool_photo_tool_idx";
DROP INDEX IF EXISTS "catalog"."catalog_tool_photo_primary_idx";
DROP INDEX IF EXISTS "catalog"."catalog_tool_photo_checksum_idx";
DROP INDEX IF EXISTS "catalog"."catalog_tool_photo_unassigned_checksum_idx";

CREATE TABLE IF NOT EXISTS "catalog"."photo" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Whose picture this is. At most one of the two is set; both NULL means it
  -- is waiting in the library for somebody to decide.
  "tool_id" bigint REFERENCES "catalog"."tool"("id") ON DELETE CASCADE,
  "case_id" bigint REFERENCES "catalog"."tool_case"("id") ON DELETE CASCADE,
  -- Content addressed: the key is derived from the checksum, so the same image
  -- uploaded twice is one file on disk.
  "storage_key" text NOT NULL,
  "checksum" text NOT NULL,
  "content_type" text NOT NULL,
  "byte_size" bigint NOT NULL,
  "width" integer,
  "height" integer,
  -- Where it came from, which is the difference between "someone photographed
  -- this machine" and "someone picked a stock photo of the model". 'edit' is a
  -- cutout made from another row here.
  "source" text NOT NULL CHECK ("source" IN ('upload', 'url', 'search', 'edit')),
  "source_url" text NOT NULL DEFAULT '',
  -- Author and licence when a search result carried them. Kept because a photo
  -- taken from the web without its attribution is a photo nobody can defend.
  "attribution" text NOT NULL DEFAULT '',
  "is_primary" boolean NOT NULL DEFAULT false,
  "derived_from" bigint REFERENCES "catalog"."photo"("id") ON DELETE SET NULL,
  "created_by" bigint REFERENCES "account"."user_account"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Databases that predate cases: the column, then the rules that mention it.
ALTER TABLE "catalog"."photo"
  ADD COLUMN IF NOT EXISTS "case_id" bigint
  REFERENCES "catalog"."tool_case"("id") ON DELETE CASCADE;

ALTER TABLE "catalog"."photo" DROP CONSTRAINT IF EXISTS "tool_photo_source_check";
ALTER TABLE "catalog"."photo" DROP CONSTRAINT IF EXISTS "photo_source_check";
ALTER TABLE "catalog"."photo"
  ADD CONSTRAINT "photo_source_check"
  CHECK ("source" IN ('upload', 'url', 'search', 'edit'));

-- One owner at most. A photo on a tool and on the case it lives in would show
-- up twice on the same screen and be deleted once.
ALTER TABLE "catalog"."photo" DROP CONSTRAINT IF EXISTS "photo_single_owner";
ALTER TABLE "catalog"."photo"
  ADD CONSTRAINT "photo_single_owner"
  CHECK ("tool_id" IS NULL OR "case_id" IS NULL);

-- Unowned photos have nothing to be the main photo of. The partial indexes
-- below allow one primary per owner; this stops a row from claiming to be the
-- main photo of nothing.
ALTER TABLE "catalog"."photo" DROP CONSTRAINT IF EXISTS "tool_photo_primary_needs_tool";
ALTER TABLE "catalog"."photo" DROP CONSTRAINT IF EXISTS "photo_primary_needs_owner";
ALTER TABLE "catalog"."photo"
  ADD CONSTRAINT "photo_primary_needs_owner"
  CHECK (NOT "is_primary" OR "tool_id" IS NOT NULL OR "case_id" IS NOT NULL);

CREATE INDEX IF NOT EXISTS "catalog_photo_tool_idx" ON "catalog"."photo" ("tool_id");
CREATE INDEX IF NOT EXISTS "catalog_photo_case_idx" ON "catalog"."photo" ("case_id");

-- At most one main photo per owner, enforced by the database rather than by
-- whichever route happens to set the flag. Promoting a photo therefore has to
-- clear the old one in the same transaction, which is what the store does.
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_photo_tool_primary_idx"
  ON "catalog"."photo" ("tool_id")
  WHERE "is_primary" AND "tool_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_photo_case_primary_idx"
  ON "catalog"."photo" ("case_id")
  WHERE "is_primary" AND "case_id" IS NOT NULL;

-- The same image twice on the same card is a mistake, not two photos. On a
-- different card it is fine, and shares one file on disk.
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_photo_tool_checksum_idx"
  ON "catalog"."photo" ("tool_id", "checksum");
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_photo_case_checksum_idx"
  ON "catalog"."photo" ("case_id", "checksum");

-- Neither index above constrains an unowned row: in an index, two NULLs are
-- different values. Without this, the same picture could sit in the library a
-- hundred times.
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_photo_unassigned_checksum_idx"
  ON "catalog"."photo" ("checksum")
  WHERE "tool_id" IS NULL AND "case_id" IS NULL;

COMMENT ON TABLE "catalog"."photo" IS 'Photos. Attached to a tool, to a case, or to neither; bytes live in the media directory, keyed by checksum.';
COMMENT ON COLUMN "catalog"."photo"."tool_id" IS 'The tool this photo illustrates, or NULL.';
COMMENT ON COLUMN "catalog"."photo"."case_id" IS 'The case this photo illustrates, or NULL.';
COMMENT ON COLUMN "catalog"."photo"."derived_from" IS 'The photo this one was cut out from, when source = edit.';
`

export const PHOTO_DROP_DDL = `
DROP TABLE IF EXISTS "catalog"."photo";
DROP TABLE IF EXISTS "catalog"."tool_photo";
`
