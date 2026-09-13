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
├── i18n/            What an answer says, in Polish or English
│   ├── lang.ts          Accept-Language, placeholders. Pure.
│   ├── catalog.ts       The English side, keyed by the Polish message
│   └── index.ts         t(), and the language of the request in hand
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

## Importing a card from a shop

`src/server/importers/` reads a product page into the shape of a card. The
address decides which script does it — the registry in `importers/index.ts` maps
a host to an importer — and an address from a shop nobody has taught this server
to read is refused rather than guessed at: a card of empty fields is worse than
a refusal, because somebody has to undo it.

Each importer is **pure**. `mistama.ts` takes the page as text and gives back a
product or nothing; the fetching, the writing and the photographs live in
`routes/tool-import.ts`. That is what lets the reading be argued with in a test
instead of over the network — a shop redesigns its markup, and the test says
which part stopped matching.

What mistama.ts knows about that shop:

- The fields come from the **schema.org Product** in the page's JSON-LD, not
  from the markup around it: name, catalog number, EAN, the whole gallery. The
  markup is the part a shop redesigns.
- The **spec table is scraped**, because the graph does not carry it: a list
  under "Parametry techniczne" where the parameter is the plain text and its
  value is in bold. A bullet that is bold all the way through is a feature, not
  a parameter called nothing, and a value of "-" is the shop saying the field
  does not apply.
- A **parameter named twice** — torque for hard materials and for soft — becomes
  one parameter with both readings. The card cannot hold the name twice and
  neither reading is worth losing.
- The shop writes one maker, "BOSCH". Which line it is — Professional or Home &
  Garden — is in the **breadcrumb**, and the catalog keeps them apart because a
  green drill and a blue one are not the same tool to anybody holding one.
- The **category** is the last crumb that names a kind of thing rather than a
  battery platform or the maker's own section. The shop's own narrowest heading
  is as often "Seria 18V" as "Podkaszarki".
- The **model** is the shouted run in the name with the maker taken out —
  "GSB 185-LI". Nothing shouted is nothing written: a model invented from the
  first two words of a Polish sentence would be worse than an empty field.
- `gtin13` becomes "Kod EAN" only when it is thirteen digits. The shop fills it
  with the catalog number on some cards, and a line repeating the one above it
  is worse than no line.

The page's own limits are not the card's, so `fitToCard` cuts every field to
what the column takes rather than failing an import somebody is watching. The
serial number is deliberately left blank: it identifies one physical machine,
and the page describes a model.

The pictures go through `importPhotoLinks`, the same path a pasted address and
a ticked search result take. Sixteen of them is around a dozen seconds of one
request — the ceiling is twenty, which is what keeps that from becoming a
minute.

## What a tool is

`catalog.tool_attribute` holds the parameters of one tool — mains voltage,
speed, chuck, working height — as a name and a value, both free text, `n` rows
per card. Columns on the tool would have been a table of mostly nulls: no two
kinds of tool share a spec sheet, and a new kind of thing would mean a
migration rather than a row.

The value carries its unit. "230 V" rather than 230 with a unit column, because
half these parameters have no unit anybody agrees on — "SDS-plus", "3 tryby" —
and a number nobody can read is worse than a string somebody can.

They live under the card in the API: `POST /api/tools/:id/attributes`, `PATCH`
and `DELETE` on one of them, each answering with the whole tool the way a case
answers with itself when a label slot is added. The list at `GET /api/tools`
deliberately leaves them out — a grid shows a name, a maker and a condition —
while every single-tool answer carries them.

One card cannot list the same parameter twice; the unique index folds case and
trims, and the parser collapses runs of spaces so that "napięcie sieciowe"
cannot slip past it as a second row. `GET /api/tools/attributes` is the
vocabulary in use, read from the tools themselves like the category list, so
the form can offer what other cards already call the same thing.

## Cases

`catalog.tool_case` is the box the tools live in, and it is a thing rather than
an attribute: a case has its own dimensions, its own barcode and its own
photograph, and a crew talks about "skrzynka 04" as often as about the drill
inside it. Name and manufacturer are required; every measurement is nullable,
because a spec sheet is something you have or you do not, and `0` would be a
claim about a box with no height.

The EAN and the SKU are not unique, unlike a tool's serial number. They
identify the product, and owning two identical cases is normal.

`catalog.case_label_slot` is where a label goes: a size in millimetres, unique
per case on the pair. Both values are NOT NULL and positive — the opposite of
the case's own measurements, where null means "nobody measured" — because a
slot with no width is not a slot. Only `getCase` carries them; the list does
not, since a grid of cases has no use for them.

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
picture off a card removes the link and then deletes the picture **if nothing
else holds it**, because a bin on a card has to mean the photograph is gone
rather than that it moved to a library nobody asked to fill. Deleting a whole
tool or case does the same through `dropOrphanedPhotos`, which is application
code on purpose: a foreign key cannot say "delete the parent when its last
child goes".

Three things hold a picture, not two: a tool, a case, and **a maker whose logo
it is**. `photo_brand` cascades on the photo, so a rule that only knew about
cards did not fail — it quietly took the logo off a brand that had nothing to
do with the card being deleted. `exclusivePhotoIds` asks the same three holds
before the fact, which is what a delete confirmation shows: "and its
photographs" is not something anybody can weigh without a number, and the
number is not the size of the gallery when another card shows half of it.

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

## Labels

Both templates' proportions are copied from the Qbrick stickers, not chosen: a
shelf of old and new labels has to look like one set. `number` is rounded
corners, the number on top, the maker under it, the second maker in a wedge
along the bottom with a white seam. `contents` is Qbrick's `label_tool` —
a white card in a navy frame, pictures filling the top, the organizer's name
over a rule and the tool names in caps under it. `pdf.ts` carries the
rounded-rectangle and wedge paths, because pdf-lib's drawRectangle has no
corner radius, and the shared corner radius, because one label rounder than the
next looks like two batches.

How many pictures a `contents` label holds follows its shape — six when it is
at least twice as wide as it is tall, three otherwise, the same test the number
template uses to decide whether to stack the number over the maker. The count
is therefore checked in the route rather than in the parser: the parser knows
the ceiling, only the resolved slot knows the shape.

Both lines of type on a `contents` label can be typed instead of worked out,
and the lower one has a third source: `namesSource` picks the tool names,
their models, or the typed `namesText`. A model is what is written on the
machine — "POF 1200 F5" says more about a box than the category name does.
That field becomes a column name, so it is validated against a fixed map on
the way out of jsonb rather than trusted: the same rule as `SORT_COLUMNS`.
An empty `titleText` still means the organizer's name, and an absent
`namesSource` still means what it used to: a text is a typed line, no text is
the tool names. Empty as absence rather than as a value is the `brand.color`
convention, and it is what keeps labels made before any of these fields
existed meaning what they meant — a redraw of one still puts the catalog's own
words on.

The `contents` metrics are millimetres measured off a 30 x 40 mm Qbrick
sticker, not shares of the label: matching that sheet is the whole point of the
shape. The taller set of sizes starts at 60 mm, as it does there, and anything
below 40 mm scales all of them down with it so the padding and two lines of
type are not the entire label.

`src/server/labels/` draws PDFs with **pdf-lib**, which is pure JavaScript —
unlike sharp next door, no native build. The two templates take plain data and
draw; `generate.ts` is the only module there that touches the database, which
is what keeps the geometry testable without a catalog.

`assets/fonts/` holds DejaVu Sans because the fourteen fonts built into every
reader are WinAnsi and have no `ł`, `ą` or `ę`. A label carrying a Polish tool
name needs an embedded font, and pdf-lib subsets it to the glyphs used.

Sizes come from the case's `case_label_slot` rows and are checked against them
in the route: a label printed at a size the box has no place for is a label
nobody can stick anywhere. The size is then copied onto the label row, because
a PDF that exists is 30 x 40 mm whatever later happens to the list of places.

`print-ready.ts` wraps a finished label rather than drawing into it: it embeds
the page in a larger one and puts the crop marks, the cut line and the measured
bar in the margin. That is why the templates know nothing about printing, and
why `cutLine` is a flag `number` takes rather than something it decides.
`contents` has no such flag: its navy frame is printed at the trim and is
already the line to cut along, so a grey guide under it would only print
twice.

Files live in `<media>/labels`, content addressed like the photos, so two
identical labels are one file and the delete path unlinks only when the last
row pointing at it is gone.

`preview.ts` rasterises the finished PDF to a PNG for the tile in the list —
from the file rather than by drawing a second time, so the tile cannot quietly
disagree with the print. It uses **@hyzyla/pdfium**, which is WebAssembly: the
labels module still needs no native build, and the eleven-megabyte module is
instantiated once for the process rather than per label. The preview shares its
PDF's name with a `.png` on the end, which is what makes it dedupe and get
cleaned up for free — whatever unlinks the PDF unlinks its picture. A render
that fails leaves `preview_path` empty and the label alone: the PDF is the
artefact and the picture is a convenience.

`options` on the row is jsonb on purpose: every template asks for different
things, and a column per template is a column per template forever. The shape
is documented in docs/api.md rather than in the table. It is also what makes
`POST .../labels/refresh` possible: drawing a label again needs nothing the row
does not already hold, so the id, the size and the options survive and only the
file underneath changes.

`labels/sheet.ts` gangs many of them onto A4 and `labels/sheet-layout.ts`
decides where each one goes — pure millimetres, so the packing is argued with
in a test rather than by printing. The margins, the 2 mm gutter and the ruler
are Qbrick's `arkusz_zbiorczy`; the packing is not, and cannot be. Over there
every sticker in a batch is one width, so a page is columns. Here a 200 mm lid
shares a sheet with a 30 mm front, and columns would leave a 170 mm strip empty
beside every front — so it is rows of decreasing height, and anything wider
than the paper goes on sideways.

The sheet draws each label's artwork again with `printReady: false` rather than
embedding the file the label points at: that file carries a margin and crop
marks, and thirty margins is most of a sheet of paper. Whatever is missing from
it — a label whose pictures have gone since, one no page can hold — is written
under the title in red on every page, because the sheet is the only thing the
person printing ever sees and a short one looks complete. The artworks are
parsed a few at a time rather than all at once: each is a whole document in
memory, and two hundred of them at their peak is how a container runs out of
it. Nothing about a sheet is stored — it is a view of labels that already exist, and a stored one would be a
second thing to redraw whenever any of them changed. Copies — Qbrick's
`--kopie`, the same sticker n times on one sheet — are not built; the sheet
draws each label it is given once, and asking for two of one means asking
twice.

`routes/labels.ts` is the same labels seen from outside the organizer that made
them — `GET /api/labels` and `POST /api/labels/refresh`, the shelf rather than
the drawer, standing in the same relation to the routes under an organizer as
the photo library does to a card's gallery. Its SQL is `labels-store.ts`, and
both refresh routes share one loop in `routes/label-redraw.ts`, so a redraw
cannot come to mean two different things depending on which screen asked for
it. The cross-organizer one answers with counts rather than an organizer,
because a selection that spans arrangements has no single one to send back.

That redraw is why `url` and `previewUrl` carry a `?v=`. Both files are served
`immutable` for a year and a label keeps its id when it is redrawn, so without
the checksum on the end a browser would go on showing the copy it cached. The
version is derived in the mapper from the stored path, which is how the path
itself stays ours to change.

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

How many pictures each engine may contribute is per engine and lives in
`account.search_engine.result_limit`, because the engines are not
interchangeable: ten plausible pictures is everything an index has to say,
while a shop's product card holds twenty photographs of the one right machine.
The number is clamped twice — once where it is stored and once where it is read
— against `maxResults` in the registry, which is set only where a provider
documents its own ceiling (Google's `num` above ten is a 400, not more
results). The merged list holds the sum of the shares; capping it at one share
is how a third engine could be switched on and change nothing.

`photo-search.ts` takes the engines and their credentials as arguments rather
than reading configuration itself, which is why its mapping functions are
testable without a network or a database.

`mistama` is the odd one: a shop, not an index, read as HTML rather than JSON.
It costs two requests — find the product card, then take that card's gallery —
and gives back one model shot from every side at full size, which is what a
catalog card wants and what a general image search is worst at. Three rules keep
it honest: the gallery is anchored on the hash in the page's `og:image`, so a
cross-sold tool on the same page contributes nothing; a search that finds
nothing is retried on the last two words of the query, because the shop ANDs
every word and a brand it spells differently ("BOSCH" against "Bosch Home &
Garden") matches nothing at all; and a result is used only when its name
answers the query, because the shop ranks _something_ for almost anything and
an answer about the wrong machine looks like a find. The match is tested
against the address as well as the name, since the listing truncates a long
name while the slug carries the model whole. Both halves are pure functions over the
markup, pinned by tests copied from the real pages — a template change there is
the one thing that can quietly break this engine.

## Adding a route

1. Write the handler in `src/server/routes/`, and its SQL in the matching
   `*-store.ts`. Parse the body in a `*-input.ts` function so the rules can be
   tested on their own.
2. Add the path to `matchRoute` and to the `ROUTES` list in `index.ts`.
3. Add it to `RULES` in `src/access/route-policy.ts`. Skipping this makes the
   route return 403 — that is the design, not a bug.
4. Document it in `docs/api.md`.

## Two languages

The messages a person reads come back in the language the client asked for.
`Accept-Language` decides — the web client sends whichever language its own
interface is in — and anything this API cannot write falls back to Polish.

The key of a message is the Polish message, the same arrangement as the web
client's: no key namespace to invent, an untranslated message goes out in
Polish rather than as a raw key, and the code reads the way the answer reads.
`i18n/catalog.ts` is the English side and the only place it lives.

The language is **ambient rather than a parameter**. A handler is a function
from a Request to a Response and nothing else, which is what the whole routing
table is built on, so threading a language through every handler, every store
and every body parser would change all three. Instead the http adapter runs
each request inside `withLanguage(...)`, an `AsyncLocalStorage`, and `t` reads
it from there. Outside a request — a script, a test, `apply-db-schema` — there
is no store and `t` answers in Polish.

A message carrying a value takes a placeholder rather than being built by
template literal: `t('Serwer odpowiedział {status}', { status })`. Word order
is not the same in both languages, and a sentence glued together at the seams
can only be right in one of them.

Two things stay where they are. A **definition table** — the search engines,
the cutout methods — holds Polish and is translated where the answer is built
(`search-settings-store.ts`, `cutout-settings-store.ts`), because a module is
evaluated once and would otherwise freeze the language of whoever asked first.
And **messages that answer a broken client** rather than a person —
`Unauthorized`, `Not found`, `Expected a JSON object` — stay English, like the
log lines.

Which language somebody reads in is stored on their account —
`user_account.language`, `PATCH /api/auth/language` — so it follows them to
another device rather than living in one browser. It does not decide the
language of an answer: `Accept-Language` does, because that says what the
client is showing at the moment it asks.

What is deliberately not translated: the text drawn onto the label PDFs. Those
are stickers cut out and stuck on boxes in one workshop, and the sheet they are
printed on says the same thing to everybody there.

`i18n/catalog.test.ts` keeps it honest: it reads every `t('…')` in the source
and every note in the two definition tables, and fails when one has no English
— or when the catalog holds a message the code no longer says.

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
