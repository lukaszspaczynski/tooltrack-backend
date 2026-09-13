# Data model

Two raw Postgres schemas, both defined as DDL strings in
`src/server/account-schema.ts` and `src/server/catalog-schema.ts` and applied
by `npm run db:schema:apply`. There is no ORM and no migration folder: the
statements are written to be re-runnable, and the schema is small enough that
reading it whole is the fastest way to understand it.

## `account`

### `account.user_account`

| Column                           | Type              | Notes                                              |
| -------------------------------- | ----------------- | -------------------------------------------------- |
| `id`                             | `bigint` identity |                                                    |
| `email`                          | `text` unique     | Stored already lowercased and trimmed              |
| `display_name`                   | `text`            | Defaults to the part before the `@`                |
| `password_hash`, `password_salt` | `text`            | PBKDF2-SHA512, 210 000 iterations, hex             |
| `role`                           | `text`            | `viewer` \| `editor` \| `admin`, CHECK constrained |
| `status`                         | `text`            | `active` \| `disabled`                             |
| `language`                       | `text`            | `pl` \| `en`, CHECK constrained, defaults `pl`     |
| `created_at`, `updated_at`       | `timestamptz`     |                                                    |

The role list is repeated in the CHECK constraint and in
`src/access/roles.ts`. Both have to change together — the database refusing a
value the application would not understand is the point.

### `account.session`

One row per login. `token_hash` is the SHA-256 of an opaque random token; the
token itself only ever exists in the cookie, so a dump of this table cannot be
used to sign in as anyone. Sessions are deleted on logout, on a password
change and when an account is disabled.

## `catalog`

### `catalog.tool`

One row per physical tool — the card the app shows.

| Column                                        | Type                              | Notes                                                    |
| --------------------------------------------- | --------------------------------- | -------------------------------------------------------- |
| `id`                                          | `bigint` identity                 |                                                          |
| `name`                                        | `text`                            | Required, CHECK non-blank                                |
| `category`, `brand`, `model`, `serial_number` | `text`                            | Free text, `''` when not filled in                       |
| `condition`                                   | `text`                            | `new` \| `good` \| `worn` \| `needs_repair` \| `retired` |
| `notes`                                       | `text`                            |                                                          |
| `created_by`, `updated_by`                    | `bigint` → `account.user_account` | `ON DELETE SET NULL`                                     |
| `created_at`, `updated_at`                    | `timestamptz`                     |                                                          |

Category and brand are free text rather than foreign keys. A tool shed is not
a taxonomy: people type "wiertarka" and "Makita" long before anyone agrees on
a list, and a card that cannot be saved because its brand is missing from a
table is a card that gets written on paper instead. `GET /api/tools/categories`
derives the filter list from the tools themselves.

A partial unique index makes a non-blank `serial_number` unique
(case-insensitively): one serial number is one physical machine, so a second
card claiming it is a duplicate to merge. Blank is exempt — most hand tools
have no serial at all.

Search is `ILIKE` over six columns, with `%` and `_` escaped so a typed
wildcard is a literal character. That is enough for a catalog of this size; if
it stops being enough, the next step is a `tsvector` column and a GIN index,
not a search service.

### `catalog.tool_case`

One row per case, box or drawer unit the tools are kept in.

| Column                                    | Type                              | Notes                              |
| ----------------------------------------- | --------------------------------- | ---------------------------------- |
| `id`                                      | `bigint` identity                 |                                    |
| `name`, `manufacturer`                    | `text`                            | Required, CHECK non-blank          |
| `system`                                  | `text`                            | Free text, `''` when not filled in |
| `outer_*_mm`, `inner_*_mm`, `diagonal_mm` | `integer`                         | NULL when unmeasured, CHECK `> 0`  |
| `capacity_l`, `load_kg`                   | `numeric(8,2)`                    | NULL when unmeasured, CHECK `> 0`  |
| `ean`, `sku`                              | `text`                            | Free text, **not** unique          |
| `notes`                                   | `text`                            |                                    |
| `created_by`, `updated_by`                | `bigint` → `account.user_account` | `ON DELETE SET NULL`               |
| `created_at`, `updated_at`                | `timestamptz`                     |                                    |

Measurements are nullable and never `0`: a box with no height does not exist,
so zero cannot stand in for "nobody has measured it". The CHECK is what keeps
the two apart in the database rather than only in the parser.

The EAN and the SKU identify the product, not this box. Two identical cases on
the shelf are two rows carrying the same barcode, which is why neither column
is unique — the opposite of `tool.serial_number`, which is one machine.

### `catalog.tool_attribute`

| Column       | Type              | Notes                                          |
| ------------ | ----------------- | ---------------------------------------------- |
| `id`         | `bigint` identity |                                                |
| `tool_id`    | `bigint`          | → `catalog.tool`, `ON DELETE CASCADE`          |
| `name`       | `text`            | Non-blank; "Napięcie sieciowe"                 |
| `value`      | `text`            | Non-blank, carries its unit; "230 V"           |
| `created_by` | `bigint`          | → `account.user_account`, `ON DELETE SET NULL` |

Unique on `(tool_id, lower(btrim(name)))`: one tool cannot list the same
parameter twice, and the second one is somebody correcting the first rather
than a second fact about the machine. The name repeats freely across tools,
which is what makes it worth reading across the catalog — and what the
suggestion list is built from.

A row per parameter rather than columns on the tool, because no two kinds of
tool share a spec sheet: a drill has a chuck size and a ladder has a working
height, and a column for each would be a table of mostly nulls needing a
migration every time somebody catalogues a new kind of thing.

### `catalog.case_label_slot`

Where a label goes on a case.

| Column                     | Type                           | Notes               |
| -------------------------- | ------------------------------ | ------------------- |
| `id`                       | `bigint` identity              |                     |
| `case_id`                  | `bigint` → `catalog.tool_case` | `ON DELETE CASCADE` |
| `width_mm`, `height_mm`    | `integer`                      | CHECK `> 0`         |
| `created_by`, `created_at` |                                |                     |

A slot is a size and nothing else; what gets printed on it is a different
question and not one this table answers.

Unique on `(case_id, width_mm, height_mm)`: one case cannot list the same size
twice, and adding it again is a mistake rather than a second place. Sizes
repeat freely across cases, which is what a modular system is.

Unlike the measurements on the case itself, these are `NOT NULL` and checked
positive rather than nullable: "nobody measured the box" is a normal state, but
a label slot with no width is not a slot.

### `catalog.photo`

One row per picture. The bytes are not here: the row says what the file is and
which storage key holds it, and `src/server/photo-storage.ts` owns the file. A
database that also carried a few hundred megabytes of PNG is a database nobody
wants to back up.

| Column                      | Type                       | Notes                                       |
| --------------------------- | -------------------------- | ------------------------------------------- |
| `id`                        | `bigint` identity          |                                             |
| `storage_key`, `checksum`   | `text`                     | Content addressed; `checksum` is **unique** |
| `content_type`              | `text`                     | Always `image/png` since the PNG-only rule  |
| `byte_size`                 | `bigint`                   |                                             |
| `width`, `height`           | `integer`                  |                                             |
| `source`                    | `text`                     | `upload` \| `url` \| `search` \| `edit`     |
| `source_url`, `attribution` | `text`                     | Where it came from, and whose it is         |
| `derived_from`              | `bigint` → `catalog.photo` | The picture a cutout was made from          |
| `created_by`, `created_at`  |                            |                                             |

The unique checksum is what makes the same bytes arriving twice — a re-import,
the same address pasted again — one row and one file rather than a conflict
every caller has to handle.

Nothing here says which card shows the picture. That is a different fact, and
it has its own tables.

### `catalog.photo_tool` and `catalog.photo_case`

Which cards show which pictures.

| Column                     | Type                       | Notes                                  |
| -------------------------- | -------------------------- | -------------------------------------- |
| `tool_id` / `case_id`      | `bigint` → the card        | `ON DELETE CASCADE`                    |
| `photo_id`                 | `bigint` → `catalog.photo` | `ON DELETE CASCADE`                    |
| `is_primary`               | `boolean`                  | One per card, by partial unique index  |
| `created_by`, `created_at` |                            | When this picture was put on this card |

The primary key is the pair, so a picture cannot be attached to one card twice
— the rule the old per-card checksum index carried. Being the main photo is a
property of the pairing: the same photograph can head one card and sit fourth
on another, which a flag on the picture could not express.

Two tables rather than one polymorphic `(owner_kind, owner_id)`, because a real
foreign key is what makes deleting a case take its links with it. The cost is
one table per kind of card; the alternative costs every query a discriminator
and gives up referential integrity.

Photos of a card are read by joining these, ordered by `is_primary` first and
then by when each picture was attached — which is per card, and therefore not
something the pictures themselves could carry.

Earlier shapes of this table are migrated in place, idempotently: `tool_photo`
is renamed to `photo`, the owner columns are read into the link tables, rows
sharing a checksum are merged into the oldest of each group (with the links and
any `derived_from` repointed at it), and the columns are then dropped.

### `catalog.organizer`

One arrangement: a case, a name, and the number painted on the box.

| Column                     | Type                              | Notes                               |
| -------------------------- | --------------------------------- | ----------------------------------- |
| `id`                       | `bigint` identity                 |                                     |
| `number`                   | `integer`                         | Unique, CHECK `> 0`. **Not** the id |
| `name`                     | `text`                            | Required, CHECK non-blank           |
| `description`              | `text`                            |                                     |
| `case_id`                  | `bigint` → `catalog.tool_case`    | Required, `ON DELETE CASCADE`       |
| `created_by`, `updated_by` | `bigint` → `account.user_account` | `ON DELETE SET NULL`                |
| `created_at`, `updated_at` | `timestamptz`                     |                                     |

The number is unique and deliberately separate from the id: ids are ours and
change when a row is recreated, while this one is painted on a box and has to
survive that. A `POST` without one takes `max(number) + 1` inside the inserting
transaction, so two people creating at once cannot both read the same maximum.

`case_id` is required and cascades. One case may hold several organizers — a
toolbox with three drawers is three arrangements of the same box — and deleting
the box deletes them, because an arrangement has no meaning without it.

### `catalog.organizer_tool`

Which tools are in which organizer.

| Column                     | Type                           | Notes                    |
| -------------------------- | ------------------------------ | ------------------------ |
| `organizer_id`             | `bigint` → `catalog.organizer` | `ON DELETE CASCADE`      |
| `tool_id`                  | `bigint` → `catalog.tool`      | `ON DELETE CASCADE`      |
| `created_by`, `created_at` |                                | When it was put in there |

The primary key is the pair; a **unique index on `tool_id` alone** is what makes
it one-to-one from the tool's side. A tool lies in exactly one place, and the
database says so rather than a handler remembering to check — `INSERT` for a
tool that is already somewhere fails with 23505, which the API answers as 409
rather than moving it silently.

A link table rather than an `organizer_id` column on the tool, so `catalog.tool`
knows nothing about organizers: removing the feature would not touch a tool
card. The same reasoning as the photo links above.

Deleting a tool takes it out of its organizer and changes nothing else — the
arrangement is still an arrangement with one fewer thing in it.

### `catalog.brand`

One row per maker.

| Column                     | Type                              | Notes                      |
| -------------------------- | --------------------------------- | -------------------------- |
| `id`                       | `bigint` identity                 |                            |
| `name`                     | `text`                            | Required, unique on lower  |
| `notes`                    | `text`                            |                            |
| `color`                    | `text`                            | `#rrggbb` or `''`, CHECKed |
| `created_by`, `updated_by` | `bigint` → `account.user_account` | `ON DELETE SET NULL`       |
| `created_at`, `updated_at` | `timestamptz`                     |                            |

The colour is stored in one canonical form — lowercase `#rrggbb` — enforced by
a CHECK, so CSS can use it directly and two spellings of the same colour cannot
both exist. The API accepts an `r g b` triple as well, because that is how a
brand book gives it. Empty means nobody has said, which is not the same as
black and is why the column is not null with a default rather than nullable.

The unique index is case-insensitive: "Bosch" and "BOSCH" typed on two days are
the same company, and two rows would split its tools in half.

`catalog.tool.brand_id` points here, `ON DELETE SET NULL` — removing a maker
must not remove its tools. The tool keeps its free-text `brand` as well: that
is what the catalog searches and what a card shows, and the API keeps the two
in step (a rename rewrites the text, and a typed name is matched back to a row).
Collapsing them into one column is the obvious next step and has not been taken.

### `catalog.photo_brand`

The logo. One to one in **both** directions: `brand_id` is the primary key, so
a brand has at most one, and `photo_id` is unique, so a picture is the logo of
at most one brand.

Its own table rather than a column on either side — the same reasoning as the
photo links — and it means deleting the picture clears the logo through the
cascade instead of leaving an id pointing at nothing.
