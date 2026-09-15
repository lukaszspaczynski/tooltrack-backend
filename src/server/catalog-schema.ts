// DDL for the `catalog` schema: the tool cards themselves.

export const CATALOG_DDL = `
CREATE SCHEMA IF NOT EXISTS "catalog";

-- The catalog held tools. It holds what somebody owns: a drill, a washing
-- machine, and — when the boxes are folded in too — a case. All of it has the
-- same card, because everything that makes a card is the same for all three:
-- a name, a maker, a model, a serial number, a condition, photographs, a
-- manual, a spec sheet, an address, and the page it was imported from.
--
-- So the table is item and kind says which sort of thing it is, rather
-- than a second table with the same twelve columns under another name.
--
-- Renamed rather than recreated: the rows are somebody's catalog. Each step is
-- guarded on its own, so running the schema twice is the same as running it
-- once, and a database halfway through one run finishes on the next.
DO $$
BEGIN
  IF to_regclass('"catalog"."tool"') IS NOT NULL
     AND to_regclass('"catalog"."item"') IS NULL THEN
    ALTER TABLE "catalog"."tool" RENAME TO "item";
  END IF;

  IF to_regclass('"catalog"."manual_tool"') IS NOT NULL
     AND to_regclass('"catalog"."manual_item"') IS NULL THEN
    ALTER TABLE "catalog"."manual_tool" RENAME TO "manual_item";
    ALTER TABLE "catalog"."manual_item" RENAME COLUMN "tool_id" TO "item_id";
  END IF;

  -- A box called it a system because a Qbrick stacks with a range. An item
  -- card calls the same fact a model, and a box is one card away from being an
  -- item.
  IF to_regclass('"catalog"."tool_case"') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'catalog' AND table_name = 'tool_case' AND column_name = 'system'
     ) THEN
    ALTER TABLE "catalog"."tool_case" RENAME COLUMN "system" TO "model";

    IF to_regclass('"catalog"."catalog_tool_case_system_idx"') IS NOT NULL THEN
      ALTER INDEX "catalog"."catalog_tool_case_system_idx"
        RENAME TO "catalog_tool_case_model_idx";
    END IF;
  END IF;

  -- The spec sheet says which kind of thing each row is about, as a word. The
  -- word was 'tool' and the table it names is now item.
  IF to_regclass('"catalog"."attribute"') IS NOT NULL THEN
    UPDATE "catalog"."attribute" SET "reference" = 'item' WHERE "reference" = 'tool';
  END IF;
END
$$;

-- Renaming a table renames nothing else. Its indexes and its constraints keep
-- the names they were born with, and both matter here.
--
-- The indexes matter because the CREATE INDEX IF NOT EXISTS statements below
-- name the new ones: left alone, a migrated database would end up with two of
-- each, one under each name, and pay for both on every write.
--
-- The **constraint** names matter more, because the code reads one. A foreign
-- key that matched nothing is answered as "no such address" rather than as a
-- 500, and which key it was is known only from error.constraint. A migrated
-- database saying tool_address_id_fkey where a fresh one says
-- item_address_id_fkey is the same server behaving differently depending on
-- how old the database is, which is the worst kind of difference to debug.
DO $$
DECLARE
  "old_name" text;
  "new_name" text;
BEGIN
  -- Nothing to rename on a database that has never had the old names, and
  -- 'catalog.item'::regclass below would throw rather than answer null.
  IF to_regclass('"catalog"."item"') IS NULL THEN RETURN; END IF;

  FOR "old_name", "new_name" IN
    SELECT unnest(ARRAY[
      'catalog_tool_serial_number_idx', 'catalog_tool_category_idx',
      'catalog_tool_condition_idx', 'catalog_tool_name_idx',
      'catalog_tool_brand_id_idx', 'catalog_tool_address_id_idx',
      'catalog_manual_tool_manual_idx'
    ]),
    unnest(ARRAY[
      'catalog_item_serial_number_idx', 'catalog_item_category_idx',
      'catalog_item_condition_idx', 'catalog_item_name_idx',
      'catalog_item_brand_id_idx', 'catalog_item_address_id_idx',
      'catalog_manual_item_manual_idx'
    ])
  LOOP
    IF to_regclass('"catalog".' || quote_ident("old_name")) IS NOT NULL
       AND to_regclass('"catalog".' || quote_ident("new_name")) IS NULL THEN
      EXECUTE format('ALTER INDEX "catalog".%I RENAME TO %I', "old_name", "new_name");
    END IF;
  END LOOP;

  FOR "old_name", "new_name" IN
    SELECT unnest(ARRAY['tool_pkey', 'tool_address_id_fkey', 'tool_brand_id_fkey',
                        'tool_created_by_fkey', 'tool_updated_by_fkey', 'tool_condition_check']),
           unnest(ARRAY['item_pkey', 'item_address_id_fkey', 'item_brand_id_fkey',
                        'item_created_by_fkey', 'item_updated_by_fkey', 'item_condition_check'])
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'catalog.item'::regclass AND conname = "old_name"
    ) THEN
      EXECUTE format('ALTER TABLE "catalog"."item" RENAME CONSTRAINT %I TO %I',
                     "old_name", "new_name");
    END IF;
  END LOOP;
END
$$;

CREATE TABLE IF NOT EXISTS "catalog"."item" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "name" text NOT NULL CHECK (btrim("name") <> ''),
  -- Category, brand, model and serial number are free text rather than
  -- foreign keys. A tool shed is not a taxonomy: people type "wiertarka" and
  -- "Makita" long before anyone agrees on a list, and a card that cannot be
  -- saved because its brand is missing from a table is a card that gets
  -- written on paper instead. Empty string means "not filled in"; the column
  -- is NOT NULL so no query has to handle both.
  "category" text NOT NULL DEFAULT '',
  "model" text NOT NULL DEFAULT '',
  "serial_number" text NOT NULL DEFAULT '',
  -- What sort of thing this is. Not a category — a category is free text and
  -- somebody's own word for a shelf, while this is the handful of sorts the
  -- catalog itself behaves differently about.
  --
  -- 'case' is here before anything uses it, deliberately: the boxes are their
  -- own table today and folding them in is a decision for later, but a check
  -- constraint that has to be widened on the day of is one more thing to
  -- remember on the day of.
  "kind" text NOT NULL DEFAULT 'tool'
    CHECK ("kind" IN ('tool', 'appliance', 'case')),
  "condition" text NOT NULL DEFAULT 'good'
    CHECK ("condition" IN ('new', 'good', 'worn', 'needs_repair', 'retired')),
  "notes" text NOT NULL DEFAULT '',
  -- Where the card was read from, when it was read from anywhere. A column
  -- rather than a parameter: every imported card has exactly one and no card
  -- has two, which is the shape of a field and not of a spec sheet. It used to
  -- live on the sheet as "Referencja", where it sorted among the voltages and
  -- could be renamed by anybody editing a row the screens depend on.
  "reference_url" text NOT NULL DEFAULT '',
  -- Who last touched the card. ON DELETE SET NULL: removing an account must
  -- not remove the history of the tools it catalogued.
  "created_by" bigint REFERENCES "account"."user_account"("id") ON DELETE SET NULL,
  "updated_by" bigint REFERENCES "account"."user_account"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- A serial number identifies one physical machine, so two cards claiming the
-- same one is a duplicate someone should merge, not two tools. Blank is
-- exempt: most hand tools have no serial at all.
-- Databases that predate the kind. Everything already in a catalog of tools is
-- a tool; what is not gets said afterwards, by somebody looking at it.
ALTER TABLE "catalog"."item" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'tool';

ALTER TABLE "catalog"."item" DROP CONSTRAINT IF EXISTS "item_kind_check";
ALTER TABLE "catalog"."item"
  ADD CONSTRAINT "item_kind_check" CHECK ("kind" IN ('tool', 'appliance', 'case'));

-- Redundant on its own — id is already unique — and here so that another table
-- can point at "this row, and it is a tool" in one foreign key. See
-- organizer-schema.ts, which is the only thing that uses it.
--
-- Added only when missing, never dropped and re-added. The organizer's foreign
-- key depends on the index behind it, so a second run of this file would be
-- refused — which is how this was found.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'catalog.item'::regclass AND conname = 'item_id_kind_key'
  ) THEN
    ALTER TABLE "catalog"."item" ADD CONSTRAINT "item_id_kind_key" UNIQUE ("id", "kind");
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "catalog_item_kind_idx" ON "catalog"."item" ("kind");

CREATE UNIQUE INDEX IF NOT EXISTS "catalog_item_serial_number_idx"
  ON "catalog"."item" (lower("serial_number"))
  WHERE "serial_number" <> '';

CREATE INDEX IF NOT EXISTS "catalog_item_category_idx" ON "catalog"."item" (lower("category"));
CREATE INDEX IF NOT EXISTS "catalog_item_condition_idx" ON "catalog"."item" ("condition");
CREATE INDEX IF NOT EXISTS "catalog_item_name_idx" ON "catalog"."item" (lower("name"));

-- The boxes the tools live in. A crew talks about "skrzynka 04" as often as
-- about the drill inside it, and a case is a thing with its own price, its own
-- dimensions and its own photo — not an attribute of a tool.

-- The manuals: the PDF that came in the box, and whatever else is worth
-- keeping beside a tool — a parts diagram, a safety sheet.
--
-- Its own table with a link table beside it, exactly like the photos and for
-- the same reason: a manual describes a model, not one machine, so three
-- identical grinders share one file rather than three copies of it. Content
-- addressed by checksum, so the same PDF uploaded twice is one row.
CREATE TABLE IF NOT EXISTS "catalog"."manual" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "storage_key" text NOT NULL,
  -- SHA-256 of the bytes. Unique: the same file arriving from an upload and
  -- from the maker's website is one manual with one name, not two.
  "checksum" text NOT NULL UNIQUE,
  "byte_size" bigint NOT NULL,
  -- What the card calls it. Taken from the file name or from the page it came
  -- from, and editable, because "instrukcja_pl_v2_final.pdf" is not a title.
  "title" text NOT NULL DEFAULT '',
  "source" text NOT NULL DEFAULT 'upload'
    CHECK ("source" IN ('upload', 'url', 'import')),
  "source_url" text NOT NULL DEFAULT '',
  "created_by" bigint REFERENCES "account"."user_account"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "catalog"."manual_item" (
  "item_id" bigint NOT NULL REFERENCES "catalog"."item"("id") ON DELETE CASCADE,
  "manual_id" bigint NOT NULL REFERENCES "catalog"."manual"("id") ON DELETE CASCADE,
  "created_by" bigint REFERENCES "account"."user_account"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("item_id", "manual_id")
);

CREATE INDEX IF NOT EXISTS "catalog_manual_item_manual_idx"
  ON "catalog"."manual_item" ("manual_id");

-- What this particular tool is: mains voltage 230 V, 300 rpm, SDS-plus, 4.2 kg.
--
-- A row per parameter rather than columns on the tool, because no two kinds of
-- tool share a spec sheet — a drill has a chuck size and a ladder has a
-- working height, and a table with a column for each would be mostly nulls and
-- would need a migration every time somebody catalogues a new kind of thing.
--
-- Name and value are both free text, like the brand and the category above and
-- for the same reason: the crew writes what the plate on the machine says, and
-- a card that cannot record "prędkość obrotowa" until somebody defines a unit
-- system is a card that gets written on paper instead. The value carries its
-- unit — "230 V", not 230 — because half these parameters have no unit anybody
-- agrees on and a number without one is a number nobody can read.
-- Attributes were a tool's alone once, in a table called tool_attribute keyed
-- by its tool. A case turned out to want the same thing — a spec sheet of names
-- and values that nobody can agree a column list for — so the table is generic
-- and says which kind of thing each row belongs to.
--
-- Renamed rather than recreated: the rows are somebody's spec sheets. These
-- statements run before the CREATE below so that an existing database is
-- migrated and a fresh one falls through to the CREATE, and each is guarded so
-- that running the schema twice is the same as running it once.
DO $$
BEGIN
  IF to_regclass('"catalog"."tool_attribute"') IS NOT NULL
     AND to_regclass('"catalog"."attribute"') IS NULL THEN
    ALTER TABLE "catalog"."tool_attribute" RENAME TO "attribute";
  END IF;

  IF to_regclass('"catalog"."attribute"') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'catalog' AND table_name = 'attribute' AND column_name = 'tool_id'
     ) THEN
    ALTER TABLE "catalog"."attribute" RENAME COLUMN "tool_id" TO "reference_id";
    -- Every row that existed before this column did belongs to a tool, which is
    -- why the default is there and why it is dropped again straight after: a new
    -- row has to say what it is about.
    ALTER TABLE "catalog"."attribute" ADD COLUMN "reference" text NOT NULL DEFAULT 'tool';
    ALTER TABLE "catalog"."attribute" ALTER COLUMN "reference" DROP DEFAULT;
    -- The foreign key went with the old column name and cannot survive: the row
    -- may now point at a case. What keeps an orphan out is the delete path in
    -- the stores, and the cascade below for tools.
    ALTER TABLE "catalog"."attribute" DROP CONSTRAINT IF EXISTS "tool_attribute_tool_id_fkey";
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "catalog"."attribute" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Which kind of thing this is about, and which one. Not a foreign key: two
  -- tables cannot both be the target of one column, and a check constraint on
  -- the kind is what keeps the pair meaningful. The stores delete the rows when
  -- the thing goes.
  "reference" text NOT NULL CHECK ("reference" IN ('tool', 'tool_case')),
  "reference_id" bigint NOT NULL,
  -- Neither is optional: a parameter with no name says nothing, and one with
  -- no value is a question rather than an answer.
  "name" text NOT NULL CHECK (btrim("name") <> ''),
  "value" text NOT NULL CHECK (btrim("value") <> ''),
  "created_by" bigint REFERENCES "account"."user_account"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- One thing cannot list the same parameter twice: the second "napięcie" is
-- somebody correcting the first, not a second fact about it. Compared trimmed
-- and case-folded, because "Napięcie" and "napięcie " are the same parameter
-- typed by two people. The name repeats freely across things, which is what
-- makes it worth reading across the catalog.
DROP INDEX IF EXISTS "catalog"."catalog_tool_attribute_name_idx";
DROP INDEX IF EXISTS "catalog"."catalog_tool_attribute_lookup_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "catalog_attribute_name_idx"
  ON "catalog"."attribute" ("reference", "reference_id", lower(btrim("name")));

-- Read by the parameter list the form offers as suggestions, which asks the
-- whole catalog rather than one card.
CREATE INDEX IF NOT EXISTS "catalog_attribute_lookup_idx"
  ON "catalog"."attribute" (lower(btrim("name")));

-- The address an import read a card from was a parameter called "Referencja"
-- until it became a column on the card itself. Moved rather than copied: two
-- places holding one fact is two places to disagree, and the sheet is for what
-- the maker states about the thing rather than for how the catalog found it.
--
-- Below the CREATE, because it reads the table. Guarded by the rows themselves
-- rather than by a flag: once they are gone there is nothing to move, which is
-- what makes running the schema twice the same as running it once.
ALTER TABLE "catalog"."item" ADD COLUMN IF NOT EXISTS "reference_url" text NOT NULL DEFAULT '';
DO $$
BEGIN
  -- The box gained this before it became a card, and the card already has it.
  IF to_regclass('"catalog"."tool_case"') IS NOT NULL THEN
    ALTER TABLE "catalog"."tool_case" ADD COLUMN IF NOT EXISTS "reference_url" text NOT NULL DEFAULT '';
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "catalog"."attribute" WHERE lower(btrim("name")) = 'referencja') THEN
    UPDATE "catalog"."item" AS "t"
       SET "reference_url" = "a"."value"
      FROM "catalog"."attribute" AS "a"
     WHERE "a"."reference" = 'tool'
       AND "a"."reference_id" = "t"."id"
       AND lower(btrim("a"."name")) = 'referencja'
       -- An address typed on the card wins over one a parameter remembers: the
       -- column is the newer statement about the same fact.
       AND "t"."reference_url" = '';

    UPDATE "catalog"."tool_case" AS "c"
       SET "reference_url" = "a"."value"
      FROM "catalog"."attribute" AS "a"
     WHERE "a"."reference" = 'tool_case'
       AND "a"."reference_id" = "c"."id"
       AND lower(btrim("a"."name")) = 'referencja'
       AND "c"."reference_url" = '';

    DELETE FROM "catalog"."attribute" WHERE lower(btrim("name")) = 'referencja';
  END IF;
END
$$;

-- Everything a spec sheet states about a box becomes a parameter.
--
-- A case had eleven columns of measurements, and they were columns because a
-- box is mostly measurements — until the next kind of box states something
-- else, and a twelfth column is a migration rather than a row. The spec sheet
-- already exists, already takes a name and a value with its unit, and already
-- holds the two rows a Qbrick page states that no column covered.
--
-- The unit travels in the value, as it does for every other parameter: "450
-- mm" rather than 450 beside a unit column nobody agrees on. The order is the
-- order somebody reads a box in — outside, inside, diagonal, what goes in,
-- what it carries, then the numbers that identify the product.
--
-- One-time: it runs while the columns are still there and drops them after, so
-- a second run has nothing to find.
DO $$
DECLARE
  "moved_column" text;
  "label" text;
  "unit" text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'catalog' AND table_name = 'tool_case' AND column_name = 'outer_length_mm'
  ) THEN
    RETURN;
  END IF;

  FOR "moved_column", "label", "unit" IN
    SELECT * FROM (VALUES
      ('outer_length_mm',  'Długość zewnętrzna',  ' mm'),
      ('outer_width_mm',   'Szerokość zewnętrzna', ' mm'),
      ('outer_height_mm',  'Wysokość zewnętrzna', ' mm'),
      ('inner_length_mm',  'Długość wewnętrzna',  ' mm'),
      ('inner_width_mm',   'Szerokość wewnętrzna', ' mm'),
      ('inner_height_mm',  'Wysokość wewnętrzna', ' mm'),
      ('diagonal_mm',      'Przekątna',           ' mm'),
      ('capacity_l',       'Pojemność',           ' L'),
      ('load_kg',          'Ładowność',           ' kg'),
      ('ean',              'EAN',                 ''),
      ('sku',              'SKU',                 '')
    ) AS "moved"("name", "label", "unit")
  LOOP
    -- trim_scale drops the trailing zeros numeric(8,2) carries, so 11.00 reads
    -- as "11 L" the way the page writes it rather than as "11.00 L".
    EXECUTE format(
      $sql$
        INSERT INTO "catalog"."attribute" ("reference", "reference_id", "name", "value", "created_by")
        SELECT 'tool_case', "id", %L,
               CASE WHEN pg_typeof(%I) = 'numeric'::regtype
                    THEN trim_scale(%I::numeric)::text
                    ELSE %I::text END || %L,
               "created_by"
        FROM "catalog"."tool_case"
        WHERE %I IS NOT NULL AND btrim(%I::text) <> ''
        ON CONFLICT DO NOTHING
      $sql$,
      "label", "moved_column", "moved_column", "moved_column", "unit",
      "moved_column", "moved_column"
    );

    EXECUTE format('ALTER TABLE "catalog"."tool_case" DROP COLUMN %I', "moved_column");
  END LOOP;
END
$$;

-- Where a label goes on a case. A slot is a size and nothing else: 30 x 40 mm
-- on the front, 200 x 60 mm on the lid. What gets printed on it is a different
-- question, and not one this table answers.
CREATE TABLE IF NOT EXISTS "catalog"."case_label_slot" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "item_id" bigint NOT NULL,
  -- Fixed by its own CHECK and half of the key below: only a box has places
  -- for stickers, and a drill must not be given one.
  "kind" text NOT NULL DEFAULT 'case' CHECK ("kind" = 'case'),
  FOREIGN KEY ("item_id", "kind") REFERENCES "catalog"."item" ("id", "kind") ON DELETE CASCADE,
  -- Millimetres, always as width x height of the outline. A label with no
  -- width is not a label, so zero is refused rather than stored as "unknown".
  "width_mm" integer NOT NULL CHECK ("width_mm" > 0),
  "height_mm" integer NOT NULL CHECK ("height_mm" > 0),
  "created_by" bigint REFERENCES "account"."user_account"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- The pair is the key: one case cannot have the same size listed twice, and
-- adding it again is a mistake rather than a second place. Sizes repeat freely
-- across cases, which is the point of a modular system.

COMMENT ON SCHEMA "catalog" IS 'The ToolTrack tool catalog.';
COMMENT ON TABLE "catalog"."item" IS 'One row per thing somebody owns — a tool, an appliance, later a case. The card shown in the app.';
COMMENT ON TABLE "catalog"."case_label_slot" IS 'Where a label goes on a case: a size in mm, unique per case.';
COMMENT ON TABLE "catalog"."manual" IS 'One PDF kept beside the tools: the manual, a parts diagram, a safety sheet.';
COMMENT ON TABLE "catalog"."manual_item" IS 'Which items a manual belongs to. A manual describes a model, so several cards can share one file.';
COMMENT ON TABLE "catalog"."attribute" IS 'One parameter of one card: a name and a value, both free text, unique per card.';
`

export const CATALOG_DROP_DDL = `
DROP SCHEMA IF EXISTS "catalog" CASCADE;
`
