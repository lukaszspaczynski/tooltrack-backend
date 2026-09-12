// DDL for the organizer: which tools live in which case.
//
// Applied by scripts/apply-db-schema.ts after `catalog`, which owns both ends.
//
// An organizer row is one arrangement — a case, a name, and an ordinal number
// people say out loud ("organizer 4"). The tools in it are a link table, not a
// column on the tool, so `catalog.tool` stays unaware that organizers exist.

export const ORGANIZER_DDL = `
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
  "case_id" bigint NOT NULL REFERENCES "catalog"."tool_case"("id") ON DELETE CASCADE,
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
CREATE TABLE IF NOT EXISTS "catalog"."organizer_tool" (
  "organizer_id" bigint NOT NULL REFERENCES "catalog"."organizer"("id") ON DELETE CASCADE,
  -- Deleting a tool takes it out of its organizer. Nothing else happens: the
  -- arrangement is still an arrangement with one fewer thing in it.
  "tool_id" bigint NOT NULL REFERENCES "catalog"."tool"("id") ON DELETE CASCADE,
  "created_by" bigint REFERENCES "account"."user_account"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("organizer_id", "tool_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "organizer_tool_once_idx"
  ON "catalog"."organizer_tool" ("tool_id");

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
  "created_by" bigint REFERENCES "account"."user_account"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "organizer_label_organizer_idx"
  ON "catalog"."organizer_label" ("organizer_id");


COMMENT ON TABLE "catalog"."organizer_label" IS 'A generated label: the PDF on disk and the options it was made from.';
COMMENT ON COLUMN "catalog"."organizer_label"."options" IS 'What the generator was told. Shape depends on the template; see docs/api.md.';

COMMENT ON TABLE "catalog"."organizer" IS 'One arrangement: a case, a number and a name.';
COMMENT ON TABLE "catalog"."organizer_tool" IS 'Which tools are in which organizer. One organizer per tool, by unique index.';
COMMENT ON COLUMN "catalog"."organizer"."number" IS 'The number said out loud and painted on the box. Not the id.';
`

export const ORGANIZER_DROP_DDL = `
DROP TABLE IF EXISTS "catalog"."organizer_label";
DROP TABLE IF EXISTS "catalog"."organizer_tool";
DROP TABLE IF EXISTS "catalog"."organizer";
`
