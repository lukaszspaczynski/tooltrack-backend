// DDL for brands. Applied by scripts/apply-db-schema.ts after `catalog` and
// after `photos`, because it points at both.
//
// A brand is a maker: one row, many tools. The logo is a picture from the same
// library everything else uses, linked one-to-one through its own table rather
// than a column, so a photo carries no idea of what it is being used for.

export const BRAND_DDL = `
CREATE TABLE IF NOT EXISTS "catalog"."brand" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "name" text NOT NULL CHECK (btrim("name") <> ''),
  "notes" text NOT NULL DEFAULT '',
  "created_by" bigint REFERENCES "account"."user_account"("id") ON DELETE SET NULL,
  "updated_by" bigint REFERENCES "account"."user_account"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- One maker, one row. Case-insensitively, because "Bosch" and "BOSCH" typed on
-- two days are the same company and two rows would split its tools in half.
CREATE UNIQUE INDEX IF NOT EXISTS "brand_name_idx" ON "catalog"."brand" (lower("name"));

-- The logo, one to one in both directions: a brand has at most one, and a
-- picture is the logo of at most one brand. Its own table rather than a column
-- on either side — the same reasoning as the photo links, and it means
-- deleting the picture clears the logo instead of leaving a dangling id.
CREATE TABLE IF NOT EXISTS "catalog"."photo_brand" (
  "brand_id" bigint NOT NULL PRIMARY KEY REFERENCES "catalog"."brand"("id") ON DELETE CASCADE,
  "photo_id" bigint NOT NULL UNIQUE REFERENCES "catalog"."photo"("id") ON DELETE CASCADE,
  "created_by" bigint REFERENCES "account"."user_account"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- One brand, many tools. A column here rather than a link table, because the
-- relation is single-valued on the tool's side and nothing about it needs a row
-- of its own. ON DELETE SET NULL: removing a brand must not remove its tools.
ALTER TABLE "catalog"."tool"
  ADD COLUMN IF NOT EXISTS "brand_id" bigint
  REFERENCES "catalog"."brand"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "catalog_tool_brand_id_idx" ON "catalog"."tool" ("brand_id");

-- The catalog held its brands as free text long before this table existed, and
-- those strings are real data: every distinct one becomes a row, and every tool
-- is pointed at its own. Both statements are idempotent, so a second run adds
-- nothing and repoints nothing.
INSERT INTO "catalog"."brand" ("name", "created_by")
SELECT DISTINCT ON (lower(btrim("brand"))) btrim("brand"), NULL
FROM "catalog"."tool"
WHERE btrim("brand") <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "catalog"."brand" AS "b" WHERE lower("b"."name") = lower(btrim("catalog"."tool"."brand"))
  )
ORDER BY lower(btrim("brand")), "brand";

UPDATE "catalog"."tool" AS "t"
SET "brand_id" = "b"."id"
FROM "catalog"."brand" AS "b"
WHERE "t"."brand_id" IS NULL
  AND btrim("t"."brand") <> ''
  AND lower("b"."name") = lower(btrim("t"."brand"));

COMMENT ON TABLE "catalog"."brand" IS 'One row per maker. Tools point at it; the logo is linked through photo_brand.';
COMMENT ON TABLE "catalog"."photo_brand" IS 'The logo of a brand. One to one in both directions.';
COMMENT ON COLUMN "catalog"."tool"."brand_id" IS 'The maker. The free-text brand column is kept in step by the API.';
`

export const BRAND_DROP_DDL = `
ALTER TABLE IF EXISTS "catalog"."tool" DROP COLUMN IF EXISTS "brand_id";
DROP TABLE IF EXISTS "catalog"."photo_brand";
DROP TABLE IF EXISTS "catalog"."brand";
`
