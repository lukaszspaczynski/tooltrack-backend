// DDL for tool photos. Applied by scripts/apply-db-schema.ts after `catalog`,
// which owns the tool this hangs off.
//
// The bytes do not live here. The row records what the file is, where it came
// from and which storage key holds it; src/server/photo-storage.ts owns the
// file itself. A database that also carries a few hundred megabytes of JPEG is
// a database nobody wants to back up or replicate.

export const PHOTO_DDL = `
CREATE TABLE IF NOT EXISTS "catalog"."tool_photo" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tool_id" bigint NOT NULL REFERENCES "catalog"."tool"("id") ON DELETE CASCADE,
  -- Content addressed: the key is derived from the checksum, so the same image
  -- uploaded twice is one file on disk.
  "storage_key" text NOT NULL,
  "checksum" text NOT NULL,
  "content_type" text NOT NULL,
  "byte_size" bigint NOT NULL,
  "width" integer,
  "height" integer,
  -- Where it came from, which is the difference between "someone photographed
  -- this machine" and "someone picked a stock photo of the model".
  "source" text NOT NULL CHECK ("source" IN ('upload', 'url', 'search')),
  "source_url" text NOT NULL DEFAULT '',
  -- Author and licence when a search result carried them. Kept because a photo
  -- taken from the web without its attribution is a photo nobody can defend.
  "attribution" text NOT NULL DEFAULT '',
  "is_primary" boolean NOT NULL DEFAULT false,
  "created_by" bigint REFERENCES "account"."user_account"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "catalog_tool_photo_tool_idx" ON "catalog"."tool_photo" ("tool_id");

-- At most one main photo per tool, enforced by the database rather than by
-- whichever route happens to set the flag. Promoting a photo therefore has to
-- clear the old one in the same transaction, which is what the store does.
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_tool_photo_primary_idx"
  ON "catalog"."tool_photo" ("tool_id")
  WHERE "is_primary";

-- The same image twice on the same card is a mistake, not two photos. Across
-- different tools it is fine, and shares one file on disk.
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_tool_photo_checksum_idx"
  ON "catalog"."tool_photo" ("tool_id", "checksum");

-- An AI cutout is a fourth kind of photo, and it remembers what it was made
-- from: the original is kept, so a bad cutout is one delete away from being
-- undone. Written as drop-and-recreate because the constraint already exists
-- on deployed databases with only three values in it.
ALTER TABLE "catalog"."tool_photo" DROP CONSTRAINT IF EXISTS "tool_photo_source_check";
ALTER TABLE "catalog"."tool_photo"
  ADD CONSTRAINT "tool_photo_source_check"
  CHECK ("source" IN ('upload', 'url', 'search', 'edit'));

ALTER TABLE "catalog"."tool_photo"
  ADD COLUMN IF NOT EXISTS "derived_from" bigint
  REFERENCES "catalog"."tool_photo"("id") ON DELETE SET NULL;

-- A photo may belong to no tool. Pictures arrive before anyone decides what
-- they are: a batch off a phone at the end of a day, something found while
-- looking for something else. Forcing a tool at that moment is how photos end
-- up on the wrong card.
ALTER TABLE "catalog"."tool_photo" ALTER COLUMN "tool_id" DROP NOT NULL;

-- Unattached photos have no tool to be the main photo of. The partial unique
-- index below already allows only one primary per tool; this stops a row from
-- claiming to be the main photo of nothing.
ALTER TABLE "catalog"."tool_photo" DROP CONSTRAINT IF EXISTS "tool_photo_primary_needs_tool";
ALTER TABLE "catalog"."tool_photo"
  ADD CONSTRAINT "tool_photo_primary_needs_tool"
  CHECK (NOT "is_primary" OR "tool_id" IS NOT NULL);

-- The unique index on (tool_id, checksum) does not constrain unattached rows:
-- in an index, two NULLs are different values. Without this, the same picture
-- could sit in the library a hundred times.
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_tool_photo_unassigned_checksum_idx"
  ON "catalog"."tool_photo" ("checksum")
  WHERE "tool_id" IS NULL;

COMMENT ON TABLE "catalog"."tool_photo" IS 'Photos. Attached to a tool or not; bytes live in the media directory, keyed by checksum.';
COMMENT ON COLUMN "catalog"."tool_photo"."tool_id" IS 'The tool this photo illustrates, or NULL while it is unassigned.';
COMMENT ON COLUMN "catalog"."tool_photo"."derived_from" IS 'The photo this one was cut out from, when source = edit.';
`

export const PHOTO_DROP_DDL = `
DROP TABLE IF EXISTS "catalog"."tool_photo";
`
