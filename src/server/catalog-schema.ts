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

COMMENT ON SCHEMA "catalog" IS 'The ToolTrack tool catalog.';
COMMENT ON TABLE "catalog"."tool" IS 'One row per physical tool, the card shown in the app.';
`

export const CATALOG_DROP_DDL = `
DROP SCHEMA IF EXISTS "catalog" CASCADE;
`
