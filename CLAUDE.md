# ToolTrack Backend — working notes

The Node API behind ToolTrack, a catalog of construction tools. One card per
physical tool, searchable from a phone on site, with three roles deciding who
may look and who may change things.

Runtime state lives in two raw Postgres schemas, `account` and `catalog`.
The web client lives in the sibling `Frontend/` directory and talks to this
API over `/api/*`; it is a separate application and is never imported here.

## Shape of the code

```
src/
├── access/          Roles, capabilities and the route policy. Pure, no I/O.
│   ├── roles.ts         Who holds which capability
│   └── route-policy.ts  Which route needs which capability
├── server/
│   ├── index.ts         node:http server, the routing table, the adapter
│   ├── route-guard.ts   The single enforcement point, runs before any handler
│   ├── db.ts            The Postgres pool
│   ├── *-schema.ts      DDL, applied by scripts/apply-db-schema.ts
│   └── routes/
│       ├── *.ts         Handlers: Request -> Response
│       ├── *-store.ts   All the SQL for one domain
│       └── *-input.ts   Pure body/query parsers
└── version.ts
scripts/
├── apply-db-schema.ts   The only way schema reaches a database
└── ensure-admin-user.ts Creates or repairs the first admin
docs/
├── api.md               The HTTP contract, written for the client
└── data-model.md        The tables and why they look like that
```

## How it works

- **No framework.** A route module exports functions from a web `Request` to a
  web `Response`. `src/server/index.ts` adapts `node:http` to that and holds
  one readable routing table. A handler can be called straight from a test
  with a `Request` built by hand.
- **No ORM.** Raw SQL in `*-store.ts`, always parameterised. The only user
  input that may reach query text is a value looked up in a fixed map (see
  `SORT_COLUMNS` in `tools-store.ts`).
- **No migration framework.** The DDL strings in `src/server/*-schema.ts` are
  written to be re-runnable, and `npm run db:schema:apply` applies them.
- **One access decision.** `src/access/route-policy.ts` says what each route
  needs and `route-guard.ts` enforces it before any handler runs. Handlers do
  not check roles. An unclassified route is refused, in every environment.
- **Stores take a pool argument** defaulting to `db()`, so a test hands in a
  recording fake instead of reaching Postgres.

## Cases

`catalog.tool_case` is the box the tools live in, and it is a thing rather than
an attribute: a case has its own dimensions, its own barcode and its own
photograph, and a crew talks about "skrzynka 04" as often as about the drill
inside it. Name and manufacturer are required; every measurement is nullable,
because a spec sheet is something you have or you do not, and `0` would be a
claim about a box with no height.

The EAN and the SKU are not unique, unlike a tool's serial number. They
identify the product, and owning two identical cases is normal.

## Photos

`catalog.photo` holds what a photo is; `src/server/photo-storage.ts` holds
the bytes, in a directory keyed by checksum. Three modules exist because each
answers a different question, and all three are pure enough to test:
`image-metadata.ts` (what is this file, really — the upload gate),
`image-fetch.ts` (may we fetch this URL — the SSRF gate), `photo-search.ts`
(where do suggestions come from) and `photo-edit.ts` (the AI cutout). Every
outbound request in the server goes through one of those three.

A `catalog.photo` row is one **picture**, once — `checksum` is unique. Which
cards show it lives in `photo_tool` and `photo_case`, because the same
photograph legitimately illustrates several tools, several cases, and a tool
together with the case it lives in. Carrying the owner on the photo row would
mean a row per card, and with it a copy of the attribution, the source and the
cutout lineage, which then drift apart.

Two link tables rather than one polymorphic `(owner_kind, owner_id)`: the
foreign keys are real, so deleting a card takes its links with it. Being the
**main** photo lives on the link, not on the picture — the same photograph can
head one card and sit fourth on another.

Every photo route and every function in `photos-store.ts` takes a `PhotoOwner`,
and `routes/photo-owner.ts` is the only place a URL segment becomes a table or
column name — the same fixed-map trick as `SORT_COLUMNS`. That is why there is
one set of photo handlers and not two.

Two consequences worth knowing before changing the delete paths. Taking a
picture off a card removes the link and then deletes the picture **if no other
card shows it**, because a bin on a card has to mean the photograph is gone
rather than that it moved to a library nobody asked to fill. Deleting a whole
tool or case does the same through `dropOrphanedPhotos`, which is application
code on purpose: a foreign key cannot say "delete the parent when its last
child goes".

Previews live in their own directory with a TTL (`photo-storage.ts`), apart
from the photos on purpose: a directory nothing in the catalog points at can be
swept without asking whether a file is still needed. The sweep runs at startup
and on an unref'd timer as well as when a preview is written, so the last
previews of an afternoon do not wait for the next person to use the feature.
Keeping a preview copies
it into the photo store, where nothing sweeps it.

A cutout is an added photo, never an edit in place: `source: 'edit'` and
`derived_from` pointing at the original. That is what makes the feature safe to
press.

Which method runs, and the keys behind it, are settings owned by an admin —
`routes/cutout-settings-store.ts`, with the same precedence rule as the search
engines. `photo-edit.ts` and `cutout-local.ts` read no configuration of their
own; it arrives as an argument, which is what keeps their logic testable.

`image-convert.ts` is the only module that decodes or encodes a picture, and
everything stored goes through it: one format on disk (PNG), one decoder to
reason about. It uses **sharp**, which is a native dependency with prebuilt
binaries — a deliberate reversal of the earlier "no native dependencies" rule,
made when the pure-JavaScript decoder turned out not to read WebP, which is
most of what an image search returns. The sibling project this repo's
conventions come from uses sharp for the same reason.

`cutout-local.ts` is the default cutout: a pure function over RGBA bytes
(background flood from the border, closing, largest component, crop) with
`image-convert.ts` on either side of it. It refuses unsuitable photos with
`PhotoNotSuitableError`, which the route answers as 422; a missing or failing
AI service is a different error and a different status.

## Brands

`catalog.brand` is a maker: one row, many tools, pointed at by
`catalog.tool.brand_id`. The logo lives in `catalog.photo_brand`, one to one in
both directions, for the same reason the photo links exist — a picture carries
no idea of what it is being used for.

The tool still carries its maker as free text as well. That column is what the
catalog searches and what a card shows, and the two are kept in step from both
ends: renaming a brand rewrites the text on its tools in the same transaction,
and creating or editing a tool matches the typed name back to a row
(`brandIdForName`), pointing at nothing rather than inventing a brand from a
typo. Collapsing them into one column, with the tool form picking from a list,
is the obvious next step and has not been taken — say so before doing it, since
it changes what `GET /api/tools` means.

The DDL backfills: every distinct non-empty `tool.brand` became a row and every
tool was pointed at its own, idempotently.

Cases are deliberately not part of this. `tool_case.manufacturer` stays free
text — it was asked for and declined, not overlooked, so leave it alone unless
somebody asks again.

## Organizer

`catalog.organizer` is one arrangement — a case, a name and an ordinal number —
and `catalog.organizer_tool` says which tools are in it. Every rule of the
feature is a constraint rather than a check in a handler:

- one case per organizer, several organizers per case (a toolbox with three
  drawers is three arrangements of the same box) — a `case_id` column with
  `ON DELETE CASCADE`, so deleting the box takes the arrangements;
- a tool is in at most one organizer — a **unique index on `tool_id` alone** in
  the link table, which is what "1:1 from the tool's side" means in SQL;
- deleting a tool takes it out — `ON DELETE CASCADE` on the other end.

The link table rather than an `organizer_id` on the tool is deliberate:
`catalog.tool` knows nothing about organizers, and removing the feature would
not touch a tool card. The same reasoning as the photo links.

`GET /api/tools?inOrganizer=false` is what the wizard offers in its second
step. It is a filter on the tool list rather than an endpoint of its own,
because "tools not in an organizer" is a question about tools.

The list query pulls the case, its main photo, and every tool with its own in
one statement — a screen of twenty organizers would otherwise be forty-one
requests. Watch the shape of it: the window count has to sit between the column
list and the `FROM`, which is why those are two constants and not one.

## Duplicating a card

`POST /api/tools/:id/duplicate` is one `INSERT ... SELECT`, so a copy cannot
drift from its original between a read and a write, and the columns are named
once. The serial number is the single field not copied — it is one physical
machine, and the unique index would refuse the second card anyway.

The photo links are copied too (`copyPhotoLinks`), main photo included. That is
cheap because a pairing is a row: the copy shows the same pictures without a
byte being written.

Cases deliberately do not have this. `copyPhotoLinks` is already owner-generic,
so adding it would be an endpoint and a button — it was asked for and declined,
not overlooked.

## Search engine settings

`search-engines.ts` is the registry — what each engine is called and what it
needs — and it is pure, because three places have to agree about it. The store
in `routes/search-settings-store.ts` owns the one precedence rule: a credential
saved in the database wins, the environment variable is the fallback. It is
also the only module that reads credentials, and the list it builds for the
screen deliberately cannot carry them.

`photo-search.ts` takes the engines and their credentials as arguments rather
than reading configuration itself, which is why its mapping functions are
testable without a network or a database.

## Adding a route

1. Write the handler in `src/server/routes/`, and its SQL in the matching
   `*-store.ts`. Parse the body in a `*-input.ts` function so the rules can be
   tested on their own.
2. Add the path to `matchRoute` and to the `ROUTES` list in `index.ts`.
3. Add it to `RULES` in `src/access/route-policy.ts`. Skipping this makes the
   route return 403 — that is the design, not a bug.
4. Document it in `docs/api.md`.

## Conventions

- Prettier: single quotes, no semicolons, width 100, trailing commas.
  `npm run format`.
- Comments explain _why_, not what. A comment that restates the line below it
  should not be written; a comment saying which failure a line prevents should.
- Object keys and union members are alphabetised, as Prettier's sort plugins
  and the existing files do. Follow the surrounding file.
- Errors a client can act on get their own class (`EmailTakenError`,
  `SerialNumberTakenError`) and a 4xx. Everything else reaches
  `routeErrorResponse` and becomes a 500, or a 503 when Postgres is the
  problem — never a 401 or a 400.
- Keep modules under roughly 250 lines. Not a hard limit, but a longer file
  should have a reason to stay together.

## Verification

```bash
npm test         # node --test over src/**/*.test.ts
npm run typecheck
```

Both must pass before anything is called done. Tests are colocated as
`*.test.ts` and use `node:test` with `assert/strict` — there is no vitest or
jest here.

For a change that touches SQL, also run it against the real database:

```bash
npm run db:up
npm run db:schema:apply
npm start
curl -s localhost:37411/healthz
```

A recording fake proves the statement we meant to send; only Postgres proves
it parses.

## VS Code

`npm run db:adminer` starts a table browser on http://localhost:8080 behind the
`tools` compose profile; the SQLTools connection to the same database is in
`.vscode/settings.json`. Both use the throwaway local credentials.

`.vscode/` carries tasks (`typecheck`, `test`, `format`, `dev`, the `db:` ones
and a `start local stack` chain) and launch configurations for the server, a
single test file, the whole suite and a schema dry run. Editor behaviour
mirrors the RN-App repo deliberately; the ESLint actions are left out because
this project has none. `docs/api.http` is the endpoint list as runnable
requests — keep it in step with `docs/api.md` when a route changes.

## Things to leave alone unless asked

- The three roles and their capabilities. They are the product, and they are
  duplicated into a CHECK constraint on purpose.
- Registration always creating a `viewer`.
- `TOOLTRACK_BOOTSTRAP_ADMIN_EMAILS`, which is what stops an installation from
  locking every admin out.
- Password hashing (PBKDF2-SHA512, 210 000 iterations). Changing it needs a
  re-hash path for existing accounts, not just a new constant.
