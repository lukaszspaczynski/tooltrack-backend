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

CREATE TABLE IF NOT EXISTS "catalog"."manual_tool" (
  "tool_id" bigint NOT NULL REFERENCES "catalog"."tool"("id") ON DELETE CASCADE,
  "manual_id" bigint NOT NULL REFERENCES "catalog"."manual"("id") ON DELETE CASCADE,
  "created_by" bigint REFERENCES "account"."user_account"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("tool_id", "manual_id")
);

CREATE INDEX IF NOT EXISTS "catalog_manual_tool_manual_idx"
  ON "catalog"."manual_tool" ("manual_id");

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
CREATE TABLE IF NOT EXISTS "catalog"."tool_attribute" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tool_id" bigint NOT NULL REFERENCES "catalog"."tool"("id") ON DELETE CASCADE,
  -- Neither is optional: a parameter with no name says nothing, and one with
  -- no value is a question rather than an answer.
  "name" text NOT NULL CHECK (btrim("name") <> ''),
  "value" text NOT NULL CHECK (btrim("value") <> ''),
  "created_by" bigint REFERENCES "account"."user_account"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- One tool cannot list the same parameter twice: the second "napięcie" is
-- somebody correcting the first, not a second fact about the machine. Compared
-- trimmed and case-folded, because "Napięcie" and "napięcie " are the same
-- parameter typed by two people. The name repeats freely across tools, which
-- is what makes it worth reading across the catalog.
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_tool_attribute_name_idx"
  ON "catalog"."tool_attribute" ("tool_id", lower(btrim("name")));

-- Read by the parameter list the form offers as suggestions, which asks the
-- whole catalog rather than one tool.
CREATE INDEX IF NOT EXISTS "catalog_tool_attribute_lookup_idx"
  ON "catalog"."tool_attribute" (lower(btrim("name")));

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
COMMENT ON TABLE "catalog"."manual" IS 'One PDF kept beside the tools: the manual, a parts diagram, a safety sheet.';
COMMENT ON TABLE "catalog"."manual_tool" IS 'Which tools a manual belongs to. A manual describes a model, so several cards can share one file.';
COMMENT ON TABLE "catalog"."tool_attribute" IS 'One parameter of one tool: a name and a value, both free text, unique per tool.';
`

export const CATALOG_DROP_DDL = `
DROP SCHEMA IF EXISTS "catalog" CASCADE;
`
