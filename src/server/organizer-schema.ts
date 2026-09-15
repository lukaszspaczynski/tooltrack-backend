// DDL for the organizer: which tools live in which case.
//
// Applied by scripts/apply-db-schema.ts after `catalog`, which owns both ends.
//
// An organizer row is one arrangement — a case, a name, and an ordinal number
// people say out loud ("organizer 4"). The tools in it are a link table, not a
// column on the tool, so `catalog.tool` stays unaware that organizers exist.

export const ORGANIZER_DDL = `
-- The cards are items now. The link table that names them follows, and gains
-- the one rule this feature has that the catalog cannot express anywhere else.
DO $$
BEGIN
  IF to_regclass('"catalog"."organizer_tool"') IS NOT NULL
     AND to_regclass('"catalog"."organizer_item"') IS NULL THEN
    ALTER TABLE "catalog"."organizer_tool" RENAME TO "organizer_item";
    ALTER TABLE "catalog"."organizer_item" RENAME COLUMN "tool_id" TO "item_id";
  END IF;

  IF to_regclass('"catalog"."organizer_tool_once_idx"') IS NOT NULL
     AND to_regclass('"catalog"."organizer_item_once_idx"') IS NULL THEN
    ALTER INDEX "catalog"."organizer_tool_once_idx" RENAME TO "organizer_item_once_idx";
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "catalog"."organizer" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- The number on the lid. Unique, and deliberately not the id: ids are ours
  -- and change when a row is recreated, while this one is painted on a box and
  -- has to survive that.
  "number" integer NOT NULL CHECK ("number" > 0),
  "name" text NOT NULL CHECK (btrim("name") <> ''),
  "description" text NOT NULL DEFAULT '',
  -- The case this arrangement is in. One per organizer; a case can hold
  -- several, because a Toolbox with three drawers is three arrangements of the
  -- same box. Deleting the case takes them with it — the arrangement has no
  -- meaning without the box it describes.
  "case_id" bigint NOT NULL,
  -- Fixed by its own CHECK and half of the key below. An arrangement is an
  -- arrangement of tools in a box, and the box has to be one — a drill cannot
  -- be the thing three drawers are arranged inside.
  "case_kind" text NOT NULL DEFAULT 'case' CHECK ("case_kind" = 'case'),
  FOREIGN KEY ("case_id", "case_kind") REFERENCES "catalog"."item" ("id", "kind") ON DELETE CASCADE,
  "created_by" bigint REFERENCES "account"."user_account"("id") ON DELETE SET NULL,
  "updated_by" bigint REFERENCES "account"."user_account"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "organizer_number_idx" ON "catalog"."organizer" ("number");
CREATE INDEX IF NOT EXISTS "organizer_case_idx" ON "catalog"."organizer" ("case_id");
CREATE INDEX IF NOT EXISTS "organizer_name_idx" ON "catalog"."organizer" (lower("name"));

-- Which tools are in which organizer.
--
-- A link table rather than an organizer_id on the tool, so that a tool card
-- knows nothing about organizers and removing the feature would not touch it.
-- The pair is the primary key; the unique index on tool_id alone is what makes
-- it one-to-one from the tool's side — a tool lies in exactly one place, and
-- the database says so rather than a handler remembering to check.
CREATE TABLE IF NOT EXISTS "catalog"."organizer_item" (
  "organizer_id" bigint NOT NULL REFERENCES "catalog"."organizer"("id") ON DELETE CASCADE,
  -- Deleting a tool takes it out of its organizer. Nothing else happens: the
  -- arrangement is still an arrangement with one fewer thing in it.
  "item_id" bigint NOT NULL REFERENCES "catalog"."item"("id") ON DELETE CASCADE,
  "created_by" bigint REFERENCES "account"."user_account"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("organizer_id", "item_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "organizer_item_once_idx"
  ON "catalog"."organizer_item" ("item_id");

-- Only a tool goes in an organizer. A washing machine is in the same catalog
-- and on the same kind of card, and it is not going into a Qbrick box.
--
-- As a constraint rather than a check in a handler, like every other rule of
-- this feature. The column is fixed to 'tool' by its own CHECK and the pair
-- points at (id, kind) on the card, so the database cannot be talked into
-- linking anything else — and changing a card's kind while it is in an
-- organizer fails rather than quietly leaving an appliance in a drawer.
ALTER TABLE "catalog"."organizer_item"
  ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'tool';

ALTER TABLE "catalog"."organizer_item" DROP CONSTRAINT IF EXISTS "organizer_item_kind_check";
ALTER TABLE "catalog"."organizer_item"
  ADD CONSTRAINT "organizer_item_kind_check" CHECK ("kind" = 'tool');

ALTER TABLE "catalog"."organizer_item" DROP CONSTRAINT IF EXISTS "organizer_item_is_a_tool_fkey";
ALTER TABLE "catalog"."organizer_item"
  ADD CONSTRAINT "organizer_item_is_a_tool_fkey"
  FOREIGN KEY ("item_id", "kind") REFERENCES "catalog"."item" ("id", "kind") ON DELETE CASCADE;

-- A generated label. One organizer has many; each is a PDF on disk plus the
-- options it was made from.
--
-- The options are jsonb because every template asks for different things — a
-- number label wants "with logos or without", a contents label wants three
-- photo ids — and a column per template would be a column per template
-- forever. The shape is the generator's business, and it is written down in
-- docs/api.md rather than in the table.
CREATE TABLE IF NOT EXISTS "catalog"."organizer_label" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "organizer_id" bigint NOT NULL REFERENCES "catalog"."organizer"("id") ON DELETE CASCADE,
  -- Which template drew it. Text rather than an enum: a new template is a new
  -- value and a deploy, not a migration.
  "template" text NOT NULL CHECK (btrim("template") <> ''),
  -- The size it was drawn at, copied rather than referenced. The slot it came
  -- from can be removed from the case, but a PDF that exists is 30 x 40 mm
  -- whatever happens to the list of places it could go.
  "width_mm" integer NOT NULL CHECK ("width_mm" > 0),
  "height_mm" integer NOT NULL CHECK ("height_mm" > 0),
  -- Where the slot came from, when it still exists. Only for showing "this is
  -- the lid one"; nothing depends on it.
  "slot_id" bigint REFERENCES "catalog"."case_label_slot"("id") ON DELETE SET NULL,
  -- Everything the generator was told, so the same label can be drawn again.
  "options" jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The file, relative to the media directory.
  "pdf_path" text NOT NULL DEFAULT '',
  "byte_size" bigint NOT NULL DEFAULT 0,
  -- A raster of the first page, for the tile in the list. Empty means the
  -- picture could not be made, which is not a broken label: the PDF is the
  -- artefact and the preview is a convenience.
  "preview_path" text NOT NULL DEFAULT '',
  "created_by" bigint REFERENCES "account"."user_account"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "organizer_label_organizer_idx"
  ON "catalog"."organizer_label" ("organizer_id");

-- Databases that predate the preview.
ALTER TABLE "catalog"."organizer_label"
  ADD COLUMN IF NOT EXISTS "preview_path" text NOT NULL DEFAULT '';

COMMENT ON TABLE "catalog"."organizer_label" IS 'A generated label: the PDF on disk and the options it was made from.';
COMMENT ON COLUMN "catalog"."organizer_label"."options" IS 'What the generator was told. Shape depends on the template; see docs/api.md.';
COMMENT ON COLUMN "catalog"."organizer_label"."preview_path" IS 'PNG of the first page, for the list. Empty when it could not be rendered.';

COMMENT ON TABLE "catalog"."organizer" IS 'One arrangement: a case, a number and a name.';
COMMENT ON TABLE "catalog"."organizer_item" IS 'Which tools are in which organizer. One organizer per tool, by unique index; tools only, by composite foreign key.';
COMMENT ON COLUMN "catalog"."organizer"."number" IS 'The number said out loud and painted on the box. Not the id.';
`

export const ORGANIZER_DROP_DDL = `
DROP TABLE IF EXISTS "catalog"."organizer_label";
DROP TABLE IF EXISTS "catalog"."organizer_item";
DROP TABLE IF EXISTS "catalog"."organizer";
`
