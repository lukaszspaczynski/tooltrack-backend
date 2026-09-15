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
  -- The maker's leading colour, as #rrggbb. Stored in one canonical form so
  -- that CSS can use it directly and two spellings of the same colour cannot
  -- both exist; the API accepts an "r g b" triple and normalises it here.
  -- Empty means nobody has said, which is not the same as black.
  "color" text NOT NULL DEFAULT ''
    CHECK ("color" = '' OR "color" ~ '^#[0-9a-f]{6}$'),
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
ALTER TABLE "catalog"."item"
  ADD COLUMN IF NOT EXISTS "brand_id" bigint
  REFERENCES "catalog"."brand"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "catalog_item_brand_id_idx" ON "catalog"."item" ("brand_id");

-- A case names its maker too, and named it as free text for the same reason a
-- card did: the table came later. The same repair, and the same ending — one
-- pointer, and the string gone rather than kept in step with it.
ALTER TABLE "catalog"."tool_case"
  ADD COLUMN IF NOT EXISTS "brand_id" bigint
  REFERENCES "catalog"."brand"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "catalog_tool_case_brand_id_idx"
  ON "catalog"."tool_case" ("brand_id");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'catalog' AND table_name = 'tool_case' AND column_name = 'manufacturer'
  ) THEN
    INSERT INTO "catalog"."brand" ("name", "created_by")
    SELECT DISTINCT ON (lower(btrim("manufacturer"))) btrim("manufacturer"), NULL
    FROM "catalog"."tool_case"
    WHERE btrim("manufacturer") <> ''
      AND NOT EXISTS (
        SELECT 1 FROM "catalog"."brand" AS "b"
        WHERE lower("b"."name") = lower(btrim("catalog"."tool_case"."manufacturer"))
      )
    ORDER BY lower(btrim("manufacturer")), "manufacturer";

    UPDATE "catalog"."tool_case" AS "c"
    SET "brand_id" = "b"."id"
    FROM "catalog"."brand" AS "b"
    WHERE "c"."brand_id" IS NULL
      AND btrim("c"."manufacturer") <> ''
      AND lower("b"."name") = lower(btrim("c"."manufacturer"));

    ALTER TABLE "catalog"."tool_case" DROP COLUMN "manufacturer";
  END IF;
END
$$;

COMMENT ON COLUMN "catalog"."tool_case"."brand_id" IS 'Who makes this box. The only place a case records one.';

-- Databases that predate the colour.
ALTER TABLE "catalog"."brand" ADD COLUMN IF NOT EXISTS "color" text NOT NULL DEFAULT '';
ALTER TABLE "catalog"."brand" DROP CONSTRAINT IF EXISTS "brand_color_check";
ALTER TABLE "catalog"."brand"
  ADD CONSTRAINT "brand_color_check"
  CHECK ("color" = '' OR "color" ~ '^#[0-9a-f]{6}$');

-- The catalog held its brands as free text long before this table existed, and
-- those strings were real data: every distinct one became a row, and every card
-- was pointed at its own.
--
-- That column is gone now, so this is a one-time repair that runs only on a
-- database old enough to still have it. A card carried its maker twice — as a
-- row it pointed at and as a string beside it — and keeping the two in step
-- took three separate mechanisms: matching a typed name back to a row on every
-- write, rewriting the string on every card when a brand was renamed, and this
-- backfill quietly repairing whatever the first two missed. One column needs
-- none of them.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'catalog' AND table_name = 'item' AND column_name = 'brand'
  ) THEN
    INSERT INTO "catalog"."brand" ("name", "created_by")
    SELECT DISTINCT ON (lower(btrim("brand"))) btrim("brand"), NULL
    FROM "catalog"."item"
    WHERE btrim("brand") <> ''
      AND NOT EXISTS (
        SELECT 1 FROM "catalog"."brand" AS "b"
        WHERE lower("b"."name") = lower(btrim("catalog"."item"."brand"))
      )
    ORDER BY lower(btrim("brand")), "brand";

    UPDATE "catalog"."item" AS "t"
    SET "brand_id" = "b"."id"
    FROM "catalog"."brand" AS "b"
    WHERE "t"."brand_id" IS NULL
      AND btrim("t"."brand") <> ''
      AND lower("b"."name") = lower(btrim("t"."brand"));

    ALTER TABLE "catalog"."item" DROP COLUMN "brand";
  END IF;
END
$$;

COMMENT ON TABLE "catalog"."brand" IS 'One row per maker. Tools point at it; the logo is linked through photo_brand.';
COMMENT ON TABLE "catalog"."photo_brand" IS 'The logo of a brand. One to one in both directions.';
COMMENT ON COLUMN "catalog"."item"."brand_id" IS 'The maker. The only place a card records one.';
`

export const BRAND_DROP_DDL = `
ALTER TABLE IF EXISTS "catalog"."item" DROP COLUMN IF EXISTS "brand_id";
DROP TABLE IF EXISTS "catalog"."photo_brand";
DROP TABLE IF EXISTS "catalog"."brand";
`
