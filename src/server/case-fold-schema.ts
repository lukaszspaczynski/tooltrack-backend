// Folding the boxes into the cards.
//
// Its own batch because of what it needs to already exist: catalog.brand for
// the maker a box named as text, catalog.photo_item for its pictures, and
// catalog.organizer for the arrangements that stand in it. All three are
// created by batches that run after catalog-schema.ts, so this cannot live
// there — and running last is exactly the order it needs.

export const CASE_FOLD_DDL = `
-- A case names its maker too, and named it as free text for the same reason a
-- card did: the table came later. The same repair, and the same ending — one
-- pointer, and the string gone rather than kept in step with it.
DO $$
BEGIN
  -- Nothing to repair once the boxes are cards: they carry the card's own
  -- brand_id, and this whole block is about the column they had before.
  IF to_regclass('"catalog"."tool_case"') IS NULL THEN RETURN; END IF;

  ALTER TABLE "catalog"."tool_case"
    ADD COLUMN IF NOT EXISTS "brand_id" bigint
    REFERENCES "catalog"."brand"("id") ON DELETE SET NULL;

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


-- A box becomes a card.
--
-- It already was one in everything but the table it sat in: a name, a maker, a
-- model, a note, the page it was read from, and a spec sheet. The kind column
-- has had 'case' in its CHECK since the day it was added, waiting for this.
--
-- The ids cannot simply be kept. tool_case and item are separate sequences, so
-- case 2 and item 2 both exist and mean different things — every row that
-- pointed at a case has to be pointed at the card it became. A column carries
-- the old id across the insert, which is the only way to join back to where
-- each row came from, and it is dropped at the end.
DO $$
BEGIN
  IF to_regclass('"catalog"."tool_case"') IS NULL THEN RETURN; END IF;

  ALTER TABLE "catalog"."item" ADD COLUMN IF NOT EXISTS "legacy_case_id" bigint;

  INSERT INTO "catalog"."item"
    ("name", "model", "notes", "reference_url", "brand_id", "kind",
     "created_by", "updated_by", "created_at", "updated_at", "legacy_case_id")
  SELECT "name", "model", "notes", "reference_url", "brand_id", 'case',
         "created_by", "updated_by", "created_at", "updated_at", "id"
  FROM "catalog"."tool_case"
  ORDER BY "id";

  -- The spec sheet says which kind of thing each row is about. Both kinds are
  -- cards now, and the id is the card's rather than the box's.
  UPDATE "catalog"."attribute" AS "a"
  SET "reference" = 'item', "reference_id" = "i"."id"
  FROM "catalog"."item" AS "i"
  WHERE "a"."reference" = 'tool_case' AND "a"."reference_id" = "i"."legacy_case_id";

  -- One link table for pictures instead of two. A photograph of a box and a
  -- photograph of a drill were already the same row in the same table; only
  -- the thing they hung on was described twice.
  INSERT INTO "catalog"."photo_item" ("item_id", "photo_id", "is_primary", "created_by", "created_at")
  SELECT "i"."id", "p"."photo_id", "p"."is_primary", "p"."created_by", "p"."created_at"
  FROM "catalog"."photo_case" AS "p"
  JOIN "catalog"."item" AS "i" ON "i"."legacy_case_id" = "p"."case_id"
  ON CONFLICT DO NOTHING;

  ALTER TABLE "catalog"."case_label_slot" DROP CONSTRAINT IF EXISTS "case_label_slot_case_id_fkey";
  ALTER TABLE "catalog"."case_label_slot" RENAME COLUMN "case_id" TO "item_id";

  UPDATE "catalog"."case_label_slot" AS "s"
  SET "item_id" = "i"."id"
  FROM "catalog"."item" AS "i"
  WHERE "i"."legacy_case_id" = "s"."item_id";

  ALTER TABLE "catalog"."organizer" DROP CONSTRAINT IF EXISTS "organizer_case_id_fkey";

  UPDATE "catalog"."organizer" AS "o"
  SET "case_id" = "i"."id"
  FROM "catalog"."item" AS "i"
  WHERE "i"."legacy_case_id" = "o"."case_id";

  DROP TABLE "catalog"."photo_case";
  DROP TABLE "catalog"."tool_case";
  ALTER TABLE "catalog"."item" DROP COLUMN "legacy_case_id";
END
$$;

-- Both kinds of thing are cards now, so there is one word left.
ALTER TABLE "catalog"."attribute" DROP CONSTRAINT IF EXISTS "attribute_reference_check";
ALTER TABLE "catalog"."attribute"
  ADD CONSTRAINT "attribute_reference_check" CHECK ("reference" IN ('item'));

-- Both of these hold a card that has to be a case, and say so the way the
-- organizer says an item in a drawer has to be a tool: a kind fixed by its own
-- CHECK, and a foreign key on the pair. A drill cannot be given a label slot,
-- and a box in use cannot quietly stop being a box.
ALTER TABLE "catalog"."case_label_slot" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'case';
ALTER TABLE "catalog"."case_label_slot" DROP CONSTRAINT IF EXISTS "case_label_slot_kind_check";
ALTER TABLE "catalog"."case_label_slot"
  ADD CONSTRAINT "case_label_slot_kind_check" CHECK ("kind" = 'case');
ALTER TABLE "catalog"."case_label_slot" DROP CONSTRAINT IF EXISTS "case_label_slot_is_a_case_fkey";
ALTER TABLE "catalog"."case_label_slot"
  ADD CONSTRAINT "case_label_slot_is_a_case_fkey"
  FOREIGN KEY ("item_id", "kind") REFERENCES "catalog"."item" ("id", "kind") ON DELETE CASCADE;

ALTER TABLE "catalog"."organizer" ADD COLUMN IF NOT EXISTS "case_kind" text NOT NULL DEFAULT 'case';
ALTER TABLE "catalog"."organizer" DROP CONSTRAINT IF EXISTS "organizer_case_kind_check";
ALTER TABLE "catalog"."organizer"
  ADD CONSTRAINT "organizer_case_kind_check" CHECK ("case_kind" = 'case');
ALTER TABLE "catalog"."organizer" DROP CONSTRAINT IF EXISTS "organizer_case_is_a_case_fkey";
ALTER TABLE "catalog"."organizer"
  ADD CONSTRAINT "organizer_case_is_a_case_fkey"
  FOREIGN KEY ("case_id", "case_kind") REFERENCES "catalog"."item" ("id", "kind") ON DELETE CASCADE;

-- The pair is the key: one case cannot have the same size listed twice, and
-- adding it again is a mistake rather than a second place. Sizes repeat freely
-- across cases, which is the point of a modular system.
DROP INDEX IF EXISTS "catalog"."case_label_slot_size_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "case_label_slot_size_idx"
  ON "catalog"."case_label_slot" ("item_id", "width_mm", "height_mm");
`
