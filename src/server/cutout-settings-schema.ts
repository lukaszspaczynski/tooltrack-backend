// DDL for the cutout configuration: one row, owned by an admin.
//
// Shaped like the search engines, and for the same reason: the question an
// admin answers is "which methods may be used here", not "which one runs". The
// method for a given photo is chosen on the cutout screen, from whatever is
// switched on and has its key.
//
// Unlike the engines there is nothing per-account. Which methods exist decides
// what the installation spends, and that is not an individual preference.

export const CUTOUT_SETTINGS_DDL = `
CREATE TABLE IF NOT EXISTS "account"."cutout_setting" (
  -- One row, enforced by the database: a primary key that can only ever hold
  -- one value. Cheaper to read than a key/value table and impossible to
  -- duplicate by accident.
  "id" boolean PRIMARY KEY DEFAULT true CHECK ("id"),
  "remove_bg_api_key" text NOT NULL DEFAULT '',
  "gemini_api_key" text NOT NULL DEFAULT '',
  -- The one knob of the local method: sum of R+G+B at or above which a pixel
  -- counts as background. 765 is pure white, so anything above it would make
  -- the whole frame background.
  "threshold" integer NOT NULL DEFAULT 735 CHECK ("threshold" > 0 AND "threshold" <= 765),
  "updated_by" bigint REFERENCES "account"."user_account"("id") ON DELETE SET NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- One switch per method, replacing the single "mode" this table started with.
-- A method that is off is not offered on the cutout screen at all; with all
-- three off the feature is switched off.
ALTER TABLE "account"."cutout_setting"
  ADD COLUMN IF NOT EXISTS "local_enabled" boolean NOT NULL DEFAULT true;
ALTER TABLE "account"."cutout_setting"
  ADD COLUMN IF NOT EXISTS "removebg_enabled" boolean NOT NULL DEFAULT true;
ALTER TABLE "account"."cutout_setting"
  ADD COLUMN IF NOT EXISTS "gemini_enabled" boolean NOT NULL DEFAULT true;

-- The old single-mode column. Dropped rather than migrated: it was one row on
-- one installation, a day old, and every method being available is the state
-- an admin would have chosen anyway.
ALTER TABLE "account"."cutout_setting" DROP COLUMN IF EXISTS "mode";

COMMENT ON TABLE "account"."cutout_setting" IS 'Which cutout methods may be used, and their keys. Credentials never leave the server.';
`

export const CUTOUT_SETTINGS_DROP_DDL = `
DROP TABLE IF EXISTS "account"."cutout_setting";
`
