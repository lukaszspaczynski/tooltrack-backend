// DDL for the `catalog` schema: the tool cards themselves.

export const CATALOG_DDL = `
CREATE SCHEMA IF NOT EXISTS "catalog";

CREATE TABLE IF NOT EXISTS "catalog"."tool" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "name" text NOT NULL CHECK (btrim("name") <> ''),
  -- Category, brand, model and serial number are free text rather than
  -- foreign keys. A tool shed is not a taxonomy: people type "wiertarka" and
  -- "Makita" long before anyone agrees on a list, and a card that cannot be
  -- saved because its brand is missing from a table is a card that gets
  -- written on paper instead. Empty string means "not filled in"; the column
  -- is NOT NULL so no query has to handle both.
  "category" text NOT NULL DEFAULT '',
  "brand" text NOT NULL DEFAULT '',
  "model" text NOT NULL DEFAULT '',
  "serial_number" text NOT NULL DEFAULT '',
  "condition" text NOT NULL DEFAULT 'good'
    CHECK ("condition" IN ('new', 'good', 'worn', 'needs_repair', 'retired')),
  "notes" text NOT NULL DEFAULT '',
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
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_tool_serial_number_idx"
  ON "catalog"."tool" (lower("serial_number"))
  WHERE "serial_number" <> '';

CREATE INDEX IF NOT EXISTS "catalog_tool_category_idx" ON "catalog"."tool" (lower("category"));
CREATE INDEX IF NOT EXISTS "catalog_tool_condition_idx" ON "catalog"."tool" ("condition");
CREATE INDEX IF NOT EXISTS "catalog_tool_name_idx" ON "catalog"."tool" (lower("name"));

-- The boxes the tools live in. A crew talks about "skrzynka 04" as often as
-- about the drill inside it, and a case is a thing with its own price, its own
-- dimensions and its own photo — not an attribute of a tool.
CREATE TABLE IF NOT EXISTS "catalog"."tool_case" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- The two facts a case cannot be catalogued without. Everything below comes
  -- off a spec sheet and is missing far more often than it is present.
  "name" text NOT NULL CHECK (btrim("name") <> ''),
  "manufacturer" text NOT NULL CHECK (btrim("manufacturer") <> ''),
  -- Which modular system it stacks with: PRO, ONE, Systainer, none. Free text
  -- for the same reason brands are: the list is not ours to close.
  "system" text NOT NULL DEFAULT '',
  -- Millimetres, integers, and NULL when nobody has measured. Zero would be a
  -- claim about a box with no height, so the CHECK keeps the two apart.
  "outer_length_mm" integer CHECK ("outer_length_mm" IS NULL OR "outer_length_mm" > 0),
  "outer_width_mm" integer CHECK ("outer_width_mm" IS NULL OR "outer_width_mm" > 0),
  "outer_height_mm" integer CHECK ("outer_height_mm" IS NULL OR "outer_height_mm" > 0),
  "inner_length_mm" integer CHECK ("inner_length_mm" IS NULL OR "inner_length_mm" > 0),
  "inner_width_mm" integer CHECK ("inner_width_mm" IS NULL OR "inner_width_mm" > 0),
  "inner_height_mm" integer CHECK ("inner_height_mm" IS NULL OR "inner_height_mm" > 0),
  "diagonal_mm" integer CHECK ("diagonal_mm" IS NULL OR "diagonal_mm" > 0),
  "capacity_l" numeric(8, 2) CHECK ("capacity_l" IS NULL OR "capacity_l" > 0),
  "load_kg" numeric(8, 2) CHECK ("load_kg" IS NULL OR "load_kg" > 0),
  -- A barcode and a catalogue number identify the product, not this box. Two
  -- identical cases on the shelf are two rows with the same EAN, so neither is
  -- unique — unlike a tool's serial number, which is one machine.
  "ean" text NOT NULL DEFAULT '',
  "sku" text NOT NULL DEFAULT '',
  "notes" text NOT NULL DEFAULT '',
  "created_by" bigint REFERENCES "account"."user_account"("id") ON DELETE SET NULL,
  "updated_by" bigint REFERENCES "account"."user_account"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "catalog_tool_case_name_idx" ON "catalog"."tool_case" (lower("name"));
CREATE INDEX IF NOT EXISTS "catalog_tool_case_manufacturer_idx"
  ON "catalog"."tool_case" (lower("manufacturer"));
CREATE INDEX IF NOT EXISTS "catalog_tool_case_system_idx"
  ON "catalog"."tool_case" (lower("system"));

-- Where a label goes on a case. A slot is a size and nothing else: 30 x 40 mm
-- on the front, 200 x 60 mm on the lid. What gets printed on it is a different
-- question, and not one this table answers.
CREATE TABLE IF NOT EXISTS "catalog"."case_label_slot" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "case_id" bigint NOT NULL REFERENCES "catalog"."tool_case"("id") ON DELETE CASCADE,
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
CREATE UNIQUE INDEX IF NOT EXISTS "case_label_slot_size_idx"
  ON "catalog"."case_label_slot" ("case_id", "width_mm", "height_mm");

COMMENT ON SCHEMA "catalog" IS 'The ToolTrack tool catalog.';
COMMENT ON TABLE "catalog"."tool" IS 'One row per physical tool, the card shown in the app.';
COMMENT ON TABLE "catalog"."tool_case" IS 'One row per case, box or drawer unit the tools are kept in.';
COMMENT ON COLUMN "catalog"."tool_case"."ean" IS 'Barcode of the product, not of this box: duplicates are expected.';
COMMENT ON TABLE "catalog"."case_label_slot" IS 'Where a label goes on a case: a size in mm, unique per case.';
`

export const CATALOG_DROP_DDL = `
DROP SCHEMA IF EXISTS "catalog" CASCADE;
`
