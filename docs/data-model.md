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
