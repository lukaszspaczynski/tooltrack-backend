// DDL for `catalog.address`: the places the tools and the arrangements are kept.
//
// A workshop, a yard, a site, a van. It is a thing rather than a field on a
// tool for the reason every shared thing here is: fifty cards saying
// "Budowa Mokotów, ul. Puławska 12" is fifty chances to spell it differently,
// and "what is on the Mokotów site" is then a question nobody can ask.

export const ADDRESS_DDL = `
CREATE TABLE IF NOT EXISTS "catalog"."address" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- What people call it out loud. This is the required part, and the one that
  -- appears in a picker: a crew says "magazyn" and "Mokotów", not a postcode.
  "name" text NOT NULL CHECK (btrim("name") <> ''),
  -- The postal half, for when somebody has to drive there. All optional, all
  -- free text: a yard on a site has a name and no street, and refusing to
  -- record it until somebody invents one would mean it is not recorded at all.
  "street" text NOT NULL DEFAULT '',
  "building" text NOT NULL DEFAULT '',
  -- Flat, unit, gate. Separate from the building number because "12A/3" and
  -- "12A lok. 3" are the same place written by two people.
  "unit" text NOT NULL DEFAULT '',
  "postal_code" text NOT NULL DEFAULT '',
  "city" text NOT NULL DEFAULT '',
  "notes" text NOT NULL DEFAULT '',
  -- A colour to recognise the place by, as #rrggbb, or '' when nobody has
  -- picked one. Stored in one canonical form so that CSS can use it directly
  -- and two spellings of the same colour cannot both exist; the API accepts an
  -- "r g b" triple as well and normalises it, exactly as a brand's does.
  --
  -- Empty rather than black: a place without a colour has to look different
  -- from one somebody deliberately made black.
  "color" text NOT NULL DEFAULT '',
  "created_by" bigint REFERENCES "account"."user_account"("id") ON DELETE SET NULL,
  "updated_by" bigint REFERENCES "account"."user_account"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Databases that predate the colour.
ALTER TABLE "catalog"."address" ADD COLUMN IF NOT EXISTS "color" text NOT NULL DEFAULT '';

-- Two places called "Magazyn" is a list nobody can pick from. Folded and
-- trimmed, like the brand names and the parameter names, because "Magazyn" and
-- "magazyn " are one place typed by two people.
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_address_name_idx"
  ON "catalog"."address" (lower(btrim("name")));

CREATE INDEX IF NOT EXISTS "catalog_address_city_idx" ON "catalog"."address" (lower("city"));

-- Where a tool is, and where an arrangement is. A column on each rather than a
-- link table, because a thing is in one place: that is single-valued on this
-- side and needs no row of its own. The same reasoning as brand_id, and the
-- opposite of the photos, where one picture legitimately hangs on several
-- cards.
--
-- ON DELETE SET NULL, so closing a site does not delete the tools that were on
-- it. They read as "nowhere recorded", which is true and is what the address
-- list's delete confirmation says out loud before anybody agrees to it.
ALTER TABLE "catalog"."item"
  ADD COLUMN IF NOT EXISTS "address_id" bigint
  REFERENCES "catalog"."address"("id") ON DELETE SET NULL;

ALTER TABLE "catalog"."organizer"
  ADD COLUMN IF NOT EXISTS "address_id" bigint
  REFERENCES "catalog"."address"("id") ON DELETE SET NULL;

-- Read by "what is at this address", which is the question the feature exists
-- for and the one that would otherwise scan the whole catalog.
CREATE INDEX IF NOT EXISTS "catalog_item_address_id_idx" ON "catalog"."item" ("address_id");
CREATE INDEX IF NOT EXISTS "catalog_organizer_address_id_idx"
  ON "catalog"."organizer" ("address_id");

COMMENT ON TABLE "catalog"."address" IS 'Places tools and arrangements are kept: a workshop, a yard, a site.';
COMMENT ON COLUMN "catalog"."address"."name" IS 'What the crew calls it. The part people pick from.';
COMMENT ON COLUMN "catalog"."address"."color" IS 'Identifying colour as #rrggbb, or empty when nobody picked one.';
COMMENT ON COLUMN "catalog"."item"."address_id" IS 'Where this card is kept. Null when nobody has said.';
COMMENT ON COLUMN "catalog"."organizer"."address_id" IS 'Where this arrangement is. Null when nobody has said.';
`

export const ADDRESS_DROP_DDL = `
ALTER TABLE IF EXISTS "catalog"."item" DROP COLUMN IF EXISTS "address_id";
ALTER TABLE IF EXISTS "catalog"."organizer" DROP COLUMN IF EXISTS "address_id";
DROP TABLE IF EXISTS "catalog"."address";
`
