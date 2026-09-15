// DDL for photos. Applied by scripts/apply-db-schema.ts after `catalog`, which
// owns the tools and the cases these illustrate.
//
// The bytes do not live here. The row records what the file is, where it came
// from and which storage key holds it; src/server/photo-storage.ts owns the
// file itself. A database that also carried a few hundred megabytes of PNG is
// a database nobody wants to back up or replicate.
//
// A photo row is one **picture**, once. Which cards show it is a separate
// question, answered by two link tables — the same picture legitimately
// illustrates several tools, several cases, and a tool together with the case
// it lives in. Carrying the owner on the photo row instead would mean copying
// the row per card, and with it the attribution, the source and the cutout
// lineage, which then drift apart.

export const PHOTO_DDL = `
-- The cards are items now rather than tools, so the link table that names them
-- is too. Guarded and run before anything below refers to the new name.
DO $$
BEGIN
  IF to_regclass('"catalog"."photo_tool"') IS NOT NULL
     AND to_regclass('"catalog"."photo_item"') IS NULL THEN
    ALTER TABLE "catalog"."photo_tool" RENAME TO "photo_item";
    ALTER TABLE "catalog"."photo_item" RENAME COLUMN "tool_id" TO "item_id";
  END IF;

  -- The indexes keep the names they were born with, and the CREATE statements
  -- below name the new ones: left alone, a migrated database pays for two of
  -- each on every write.
  IF to_regclass('"catalog"."photo_tool_primary_idx"') IS NOT NULL
     AND to_regclass('"catalog"."photo_item_primary_idx"') IS NULL THEN
    ALTER INDEX "catalog"."photo_tool_primary_idx" RENAME TO "photo_item_primary_idx";
  END IF;

  IF to_regclass('"catalog"."photo_tool_photo_idx"') IS NOT NULL
     AND to_regclass('"catalog"."photo_item_photo_idx"') IS NULL THEN
    ALTER INDEX "catalog"."photo_tool_photo_idx" RENAME TO "photo_item_photo_idx";
  END IF;
END
$$;

-- The table was called tool_photo when tools were the only thing with a
-- picture. Renamed rather than duplicated, idempotently: IF EXISTS makes this
-- a no-op on every run after the first, and on a database that never had the
-- old name.
ALTER TABLE IF EXISTS "catalog"."tool_photo" RENAME TO "photo";
ALTER INDEX IF EXISTS "catalog"."tool_photo_pkey" RENAME TO "photo_pkey";

-- Indexes are dropped rather than renamed: their predicates changed when
-- ownership moved to the link tables, and a migrated database must not end up
-- with different rules from one created this morning.
DROP INDEX IF EXISTS "catalog"."catalog_tool_photo_tool_idx";
DROP INDEX IF EXISTS "catalog"."catalog_tool_photo_primary_idx";
DROP INDEX IF EXISTS "catalog"."catalog_tool_photo_checksum_idx";
DROP INDEX IF EXISTS "catalog"."catalog_tool_photo_unassigned_checksum_idx";
DROP INDEX IF EXISTS "catalog"."catalog_photo_tool_idx";
DROP INDEX IF EXISTS "catalog"."catalog_photo_case_idx";
DROP INDEX IF EXISTS "catalog"."catalog_photo_tool_primary_idx";
DROP INDEX IF EXISTS "catalog"."catalog_photo_case_primary_idx";
DROP INDEX IF EXISTS "catalog"."catalog_photo_tool_checksum_idx";
DROP INDEX IF EXISTS "catalog"."catalog_photo_case_checksum_idx";
DROP INDEX IF EXISTS "catalog"."catalog_photo_unassigned_checksum_idx";

CREATE TABLE IF NOT EXISTS "catalog"."photo" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Content addressed: the key is derived from the checksum, so the same image
  -- uploaded twice is one file on disk — and now also one row.
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
  -- The picture this one was cut out from. A fact about the picture, not about
  -- any card showing it, so it stays here.
  "derived_from" bigint REFERENCES "catalog"."photo"("id") ON DELETE SET NULL,
  "created_by" bigint REFERENCES "account"."user_account"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Which cards show which picture. Two tables rather than one polymorphic
-- (owner_kind, owner_id): a real foreign key is what makes deleting a tool
-- take its links with it, without a line of application code.
--
-- The primary key is the pair, so the same picture cannot be attached to one
-- card twice — the rule the per-card checksum index used to carry.
CREATE TABLE IF NOT EXISTS "catalog"."photo_item" (
  "item_id" bigint NOT NULL REFERENCES "catalog"."item"("id") ON DELETE CASCADE,
  "photo_id" bigint NOT NULL REFERENCES "catalog"."photo"("id") ON DELETE CASCADE,
  -- Being the main photo is a property of the pairing, not of the picture: the
  -- same photograph can head one card and sit fourth on another.
  "is_primary" boolean NOT NULL DEFAULT false,
  "created_by" bigint REFERENCES "account"."user_account"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("item_id", "photo_id")
);

CREATE TABLE IF NOT EXISTS "catalog"."photo_case" (
  "case_id" bigint NOT NULL REFERENCES "catalog"."tool_case"("id") ON DELETE CASCADE,
  "photo_id" bigint NOT NULL REFERENCES "catalog"."photo"("id") ON DELETE CASCADE,
  "is_primary" boolean NOT NULL DEFAULT false,
  "created_by" bigint REFERENCES "account"."user_account"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("case_id", "photo_id")
);

-- Databases that carried the owner on the photo row: move those pairings into
-- the link tables before the columns go. Guarded by the column's existence, so
-- this is a no-op on a fresh database and on every run after the first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'catalog' AND table_name = 'photo' AND column_name = 'tool_id'
  ) THEN
    EXECUTE $sql$
      INSERT INTO "catalog"."photo_item" ("item_id", "photo_id", "is_primary", "created_by", "created_at")
      SELECT "tool_id", "id", "is_primary", "created_by", "created_at"
      FROM "catalog"."photo" WHERE "tool_id" IS NOT NULL
      ON CONFLICT DO NOTHING
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'catalog' AND table_name = 'photo' AND column_name = 'case_id'
  ) THEN
    EXECUTE $sql$
      INSERT INTO "catalog"."photo_case" ("case_id", "photo_id", "is_primary", "created_by", "created_at")
      SELECT "case_id", "id", "is_primary", "created_by", "created_at"
      FROM "catalog"."photo" WHERE "case_id" IS NOT NULL
      ON CONFLICT DO NOTHING
    $sql$;
  END IF;
END $$;

-- The old model stored one row per card, so the same picture could be several
-- rows. One row per picture from here on: the links are repointed at the
-- oldest of each group and the rest of the rows go. Nothing on disk is
-- touched — they all pointed at the same file already.
WITH "duplicates" AS (
  SELECT "id", first_value("id") OVER (PARTITION BY "checksum" ORDER BY "id") AS "keep"
  FROM "catalog"."photo"
)
UPDATE "catalog"."photo_item" AS "l"
SET "photo_id" = "d"."keep"
FROM "duplicates" AS "d"
WHERE "l"."photo_id" = "d"."id" AND "d"."id" <> "d"."keep"
  AND NOT EXISTS (
    SELECT 1 FROM "catalog"."photo_item" AS "x"
    WHERE "x"."item_id" = "l"."item_id" AND "x"."photo_id" = "d"."keep"
  );

WITH "duplicates" AS (
  SELECT "id", first_value("id") OVER (PARTITION BY "checksum" ORDER BY "id") AS "keep"
  FROM "catalog"."photo"
)
UPDATE "catalog"."photo_case" AS "l"
SET "photo_id" = "d"."keep"
FROM "duplicates" AS "d"
WHERE "l"."photo_id" = "d"."id" AND "d"."id" <> "d"."keep"
  AND NOT EXISTS (
    SELECT 1 FROM "catalog"."photo_case" AS "x"
    WHERE "x"."case_id" = "l"."case_id" AND "x"."photo_id" = "d"."keep"
  );

-- A cutout pointing at a row that is about to go points at the survivor.
WITH "duplicates" AS (
  SELECT "id", first_value("id") OVER (PARTITION BY "checksum" ORDER BY "id") AS "keep"
  FROM "catalog"."photo"
)
UPDATE "catalog"."photo" AS "p"
SET "derived_from" = "d"."keep"
FROM "duplicates" AS "d"
WHERE "p"."derived_from" = "d"."id" AND "d"."id" <> "d"."keep";

DELETE FROM "catalog"."photo" AS "p"
WHERE EXISTS (
  SELECT 1 FROM "catalog"."photo" AS "older"
  WHERE "older"."checksum" = "p"."checksum" AND "older"."id" < "p"."id"
);

ALTER TABLE "catalog"."photo" DROP CONSTRAINT IF EXISTS "photo_single_owner";
ALTER TABLE "catalog"."photo" DROP CONSTRAINT IF EXISTS "photo_primary_needs_owner";
ALTER TABLE "catalog"."photo" DROP CONSTRAINT IF EXISTS "tool_photo_primary_needs_tool";
ALTER TABLE "catalog"."photo" DROP COLUMN IF EXISTS "tool_id";
ALTER TABLE "catalog"."photo" DROP COLUMN IF EXISTS "case_id";
ALTER TABLE "catalog"."photo" DROP COLUMN IF EXISTS "is_primary";

ALTER TABLE "catalog"."photo" DROP CONSTRAINT IF EXISTS "tool_photo_source_check";
ALTER TABLE "catalog"."photo" DROP CONSTRAINT IF EXISTS "photo_source_check";
ALTER TABLE "catalog"."photo"
  ADD CONSTRAINT "photo_source_check"
  CHECK ("source" IN ('upload', 'url', 'search', 'edit'));

-- One row per picture, enforced rather than hoped for. This is what makes an
-- import that fetches the same address twice cost one row and one file.
CREATE UNIQUE INDEX IF NOT EXISTS "photo_checksum_idx" ON "catalog"."photo" ("checksum");

-- At most one main photo per card, enforced by the database rather than by
-- whichever route happens to set the flag. Promoting therefore has to clear
-- the old one in the same transaction, which is what the store does.
CREATE UNIQUE INDEX IF NOT EXISTS "photo_item_primary_idx"
  ON "catalog"."photo_item" ("item_id") WHERE "is_primary";
CREATE UNIQUE INDEX IF NOT EXISTS "photo_case_primary_idx"
  ON "catalog"."photo_case" ("case_id") WHERE "is_primary";

-- The primary keys index (card, photo); these index the other direction, for
-- "which cards show this picture" and for the library's join.
CREATE INDEX IF NOT EXISTS "photo_item_photo_idx" ON "catalog"."photo_item" ("photo_id");
CREATE INDEX IF NOT EXISTS "photo_case_photo_idx" ON "catalog"."photo_case" ("photo_id");

COMMENT ON TABLE "catalog"."photo" IS 'One row per picture. Bytes live in the media directory, keyed by checksum.';
COMMENT ON TABLE "catalog"."photo_item" IS 'Which items show which pictures, and which picture heads each card.';
COMMENT ON TABLE "catalog"."photo_case" IS 'Which cases show which pictures, and which picture heads each case.';
COMMENT ON COLUMN "catalog"."photo"."derived_from" IS 'The picture this one was cut out from, when source = edit.';
`

export const PHOTO_DROP_DDL = `
DROP TABLE IF EXISTS "catalog"."photo_item";
DROP TABLE IF EXISTS "catalog"."photo_case";
DROP TABLE IF EXISTS "catalog"."photo";
DROP TABLE IF EXISTS "catalog"."tool_photo";
`
