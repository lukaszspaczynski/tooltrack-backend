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
