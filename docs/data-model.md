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

### `catalog.photo`

Photos of tools and of cases. The bytes are not here: the row says what the
file is and which storage key holds it, and `src/server/photo-storage.ts` owns
the file. A database that also carried a few hundred megabytes of PNG is a
database nobody wants to back up.

| Column                      | Type                           | Notes                                      |
| --------------------------- | ------------------------------ | ------------------------------------------ |
| `id`                        | `bigint` identity              |                                            |
| `tool_id`                   | `bigint` → `catalog.tool`      | `ON DELETE CASCADE`, NULL if not a tool's  |
| `case_id`                   | `bigint` → `catalog.tool_case` | `ON DELETE CASCADE`, NULL if not a case's  |
| `storage_key`, `checksum`   | `text`                         | Content addressed: same image, one file    |
| `content_type`              | `text`                         | Always `image/png` since the PNG-only rule |
| `byte_size`                 | `bigint`                       |                                            |
| `width`, `height`           | `integer`                      |                                            |
| `source`                    | `text`                         | `upload` \| `url` \| `search` \| `edit`    |
| `source_url`, `attribution` | `text`                         | Where it came from, and whose it is        |
| `is_primary`                | `boolean`                      | One per card, by partial unique index      |
| `derived_from`              | `bigint` → `catalog.photo`     | The original a cutout was made from        |
| `created_by`, `created_at`  |                                |                                            |

Two owner columns rather than an `owner_kind`/`owner_id` pair, because a real
foreign key is what makes deleting a case take its photos with it. A CHECK
allows at most one of them to be set, and a second CHECK stops a row with
neither from claiming to be a main photo of nothing.

Three unique indexes carry the rules a route would otherwise have to remember:
one primary per tool, one per case, and the same checksum only once per card.
A fourth covers photos with no owner at all — in an index two NULLs are
different values, so without it the same picture could sit in the library a
hundred times.

The table was called `tool_photo` when tools were the only thing with a
picture. The DDL renames it, idempotently, rather than creating a second table:
a case photo is the same row with a different owner.
