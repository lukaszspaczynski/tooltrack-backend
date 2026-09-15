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

Six scripts so far, and they have almost nothing in common beyond the
contract: a shop publishes schema.org, one manufacturer publishes its own CMS,
another publishes both halves in different places, a fourth names the kind of
tool where the others name the machine, the fifth publishes no structured data
at all, and the sixth keeps its specification inside the description. That is the argument
for a script per domain rather than one parser with options — the shapes are
not variations of each other. What they did turn out to share is two small
things, `html.ts` and `attributes.ts`: taking tags out of a paragraph, merging
a parameter the page lists twice, and cutting "(PDF 12.4 MB)" off a title.

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

`bosch-diy.ts` reads the maker's own site for the green line. There is no
JSON-LD on it at all: the page is Next.js and everything — name, category, spec
table, gallery, order numbers — is a field in `__NEXT_DATA__`, so nothing there
is scraped out of markup. The component holding it sits under a key that is a
hash of the page, which is why it is found by the models it carries rather than
by its address in the tree.

- The **maker is the site**. bosch-diy.com is one line of one manufacturer, and
  reading it off a breadcrumb would be tea leaves about a fact the address
  already settles.
- The **model is the machine, not the box**: "CityMower 18V-32-300 - Bez
  akumulatora | Bez ładowarki" is one product name and two facts. The part
  before the first separator is the machine.
- A product page offers several **kits** — with a battery, with two, with
  neither — each with its own order number. The one whose number is the page's
  own `sku` is the configuration this address is about; its EAN and its
  contents are the ones that belong on the card, and the others describe a tool
  nobody bought.
- Noise and vibration sit behind "Pokaż więcej" as a row of titles and a row of
  values rather than as pairs. Same spec sheet, continued, so they are zipped
  back together.
- Every picture is offered in a handful of widths **baked into the file name**;
  the biggest is kept, because a card is looked at on a phone today and printed
  on a label tomorrow.

Every imported card carries a **`reference_url`**: the address it was read
from. A card that arrived by import is one somebody will want to check against
its source later — the shop corrects a spec, a photograph is added, somebody
asks where "9,400 kg" came from — and three screens read it: the update dialog,
the manuals panel, and the photo suggestions that come from the page rather
than from an engine.

It was a parameter called `Referencja` and it is a column now. A card has
exactly one address and never two, which is what a column says and what a spec
sheet does not; on the sheet it sorted among the voltages and could be renamed
by anybody editing a row. The move is in `catalog-schema.ts`, guarded by the
rows themselves — once they are gone there is nothing left to move.

The importers still only report it, as `sourceUrl`, and the routes write it.
`withoutTracking` cuts the analytics tail before it is stored, and unlike every
other field it is not clamped: half an address is not an address.

`POST /api/tools/:id/import` reads a page into a card that already exists. The
split is what the page can know and what it cannot: the maker, the model, the
category, the description, the spec sheet and the documents are overwritten;
the name, the serial number, the condition and the photographs are not — a card
called "Pilarka Janka" was called that on purpose, and a photograph may be one
somebody took themselves.

The parameters and the manuals are cleared and written again rather than
merged, in one transaction for the parameters. A page is the source of truth
for what a machine is, so one the maker has dropped should leave the card;
matching old rows against new ones by name would keep exactly the wrong ones.

`bosch-professional.ts` reads the blue line's own site — the third shape. It
publishes a schema.org Product like the shop does, and leaves out of it exactly
what a card needs most:

- The **spec table is markup**: two cells to a row, and the name carries a
  footnote marker pointing at small print the card has no room for.
- The **category is in the analytics payload**. An odd place to read it from
  and the only one that has it: the JSON-LD carries no category, and the
  breadcrumb markup on this site is a list of empty names. The last entry is
  the product, so the one before it is what it is a kind of.
- A **document is titled by its own link** rather than by the heading above it.
  The heading says "Instrukcja obsługi" for all of them; the link says which
  machines each one covers — "Instrukcja obsługi | GBH 18V-26, GBH 18V-26 F" —
  and that is what tells two apart on a card. Unlike the DIY site, this page
  lists only its own product's files, so there is nothing to filter out.
- The **brand needs no mapping**: the page writes "Bosch Professional", which
  is what the catalog calls it. The model is the name without the "PRO" in
  front, because the line already lives in the brand.

`skil.ts` is the fourth. Its Product names the **kind** of tool — "Szlifierka
taśmowa" — and keeps the machine's number in the sku, so the card is named for
both: one of those is three of the tools in the shed and the other is none of
them until somebody remembers what it is. The spec table is Magento's own, the
category is again only in the analytics payload (the narrowest `item_categoryN`
this time), and a document is titled by the `title` attribute of its link
rather than by the text, which carries the arrow icon's own name along with it.

Its gallery is served twice, once under `/cache/<hash>/` at whatever size the
page wanted and once at its own address. The catalog keeps the second: the hash
belongs to a layout that will change.

`stanley.ts` is the fifth and the plainest: no schema.org, no CMS payload, no
analytics category — a Drupal page with the facts in its markup. The name is
the heading, the category is the last breadcrumb that is not the product, the
spec table is a table, and a picture is kept without the `?resize=` the layout
asked for. A page with a heading and no spec table is refused: on this site
that is a category page or a redirect, not a product.

It is the second source declaring `manuals: false`, and for a different reason
than mistama's. The page links one EU declaration and loads its actual manuals
from `/pdp/get-manuals/<nodeId>` after rendering. An importer is handed one
page and makes no requests of its own, so what this one can promise is what the
page itself says — and it says none. Reading that endpoint would mean a second
fetch, which is a change to the contract rather than to a script.

`lidl.ts` is the sixth, and where PARKSIDE is sold. Its Product carries the
name, the pictures and the numbers, while everything a person would call a
specification lives **inside the description**, as a table somebody typed in a
rich-text editor — every name ending in a colon because that is how it was
written. The downloads block is a table too, so the reading stops at a row
whose columns are a language and a file name.

Two small things it settles: the brand arrives as "PARKSIDE®", and the ® is the
shop being careful about a trademark rather than part of a name — left in, it
would sit in the catalog beside the right one for ever. And the one document
has no title at all, only a file and a language, so the card calls it "IAN
525250 (PL)", which is at least what somebody would search for.

`nac.ts` is the seventh, and the first page built on WordPress — which means
there is no Product anywhere: every page on the site is a post, and the SEO
plugin duly calls a garden shredder a **BlogPosting**. What the theme gives
instead is anchors. The page links its own sections, so `#parametry` is where
the specification is (a list of `em`/`strong` pairs rather than a table),
`#opis` is the prose, and `#galeria` bounds the carousel — which matters,
because further down the page are photographs of four other machines.

Three things it settles. The heading is written in two parts, the kind of tool
and then the model in a span of its own, and that span is **how a product page
is told from a shelf**: `/kosiarki/` is a post too, and reading it would make a
card of empty fields. The documents are the icon boxes that link a PDF, which
leaves out the rating plate (a JPG) and the catalogue in the navigation (every
machine NAC makes). And "212 cm<sup>3</sup>" is a unit the page writes as
markup: tags out, it would reach the card as "212 cm 3".

One thing about this source is not in the script at all. The host **serves an
incomplete certificate chain**, and Node — unlike every browser — will not go
and fetch the link it is missing, so `fetch` fails the handshake and the route
can only report a page it could not reach. The missing intermediate is in
`assets/certs/`, and the `start` and `dev` scripts hand it to Node through
`NODE_EXTRA_CA_CERTS`. It has to be the whole process rather than the one
request, because the photographs and the PDFs are a dozen more fetches to the
same host. Run the server by something other than its npm script and this
source, alone among the seven, will look broken.

`gardena.ts` is the eighth, and the first Salesforce Commerce Cloud store. Half
of it reads a schema.org **Product** — the name, the maker, the article number,
the gallery, and the breadcrumb, which is inside the graph rather than in the
markup — and half **scrapes**, because everything a person would call a
specification is rows of two divs under a tab, printed twice so that a wide
screen and a narrow one each have one. `mergeDuplicates` keeps one of each.

Three things it settles. The **model starts at the first word with a digit** and
runs to the end, because "inox automatic" is part of what the machine is called
rather than a description of it — and it stops at an en dash, since "– zestaw z
akumulatorem" is which box it came in. The **barcode is the page's own row**
(`GTIN-13/EAN`), so nothing adds a second one. And a **photograph is taken
without the query string**: `?height=520&width=750` is the layout talking, and
dropping it is the difference between ten kilobytes of WebP and the two-megabyte
file itself.

It is the third source declaring `manuals: false`, for stanley's reason rather
than mistama's: the only PDFs on a product page are the shop's own terms of
sale, and the documents for the machine are fetched after the page renders.

`withoutTracking` cuts the analytics tail off an address before it is written
down — `?_gl=…&utm_source=…` says nothing about the product, and the card would
otherwise show it as its source for ever after.

The page's own limits are not the card's, so `fitToCard` cuts every field to
what the column takes rather than failing an import somebody is watching. The
serial number is deliberately left blank: it identifies one physical machine,
and the page describes a model.

The pictures go through `importPhotoLinks` and the manuals through
`saveManualFromUrl` — the same paths a pasted address and a ticked search
result take, so a file arriving with a whole card is fetched, checked and
refused on exactly the terms it would be on its own. Sixteen of them is around a dozen seconds of one
request — the ceiling is twenty, which is what keeps that from becoming a
minute.

## Manuals

`catalog.manual` holds the PDFs that belong beside a tool: the one from the
box, a parts diagram, a safety sheet. Its own table with `manual_tool` beside
it, exactly like the photos — a manual describes a model rather than one
machine, so three identical grinders share one file, a duplicated card costs a
link, and deleting a card takes with it only what no other card keeps.

Content addressed by checksum, so the same document uploaded from a laptop and
fetched from the maker's website is one row. That is not a corner case: it
happened on the first end-to-end run.

Three ways in, because that is how a document actually reaches somebody:

- **the bytes**, posted as the body with `content-type: application/pdf`, the
  same shape a photo upload takes;
- **an address**, fetched through `fetchRemoteFile` — the generic half of the
  photo fetcher, with the local-network guard, the redirect re-check, the
  timeout and the ceiling that a server fetching a URL needs;
- **a product page**, read by the same importers that import a whole card.

Whichever way it arrives, `isPdf` looks at the bytes. A content-type header is
a claim by the other side and a `.pdf` on the end of an address is a claim by
nobody: a shop answering an error page under a PDF address is the common case,
and the run that proved this caught exactly that.

An importer says whether it finds any at all — `manuals: true` on bosch-diy,
`false` on mistama — and that flag travels to the screens: the dialog offers
only pages that publish documents, the card hides the "fetch from the maker"
button when its own source has none, and the route refuses such an address by
name rather than fetching a page to report it empty afterwards.

`bosch-diy.ts` is the one importer that finds any, because mistama publishes
none — its product pages have three sections and "Instrukcję obsługi" there is
a line on a packing list. Bosch's download block lists more than one machine's
manuals, so they are filtered by the asset number baked into every file it
publishes: a manual whose number appears in one of this product's pictures is
this product's. Where nothing matches, the card gets no manuals rather than
somebody else's — nobody re-reads a document they believe they already have.

`GET /api/manuals` is the shelf rather than the drawer — every document,
whichever tool keeps it, with the cards that keep it rolled up per row. The
same split the photo library makes, and the screen behind it answers the
question a card's panel cannot: which tools is this the manual for, and has the
same PDF been uploaded three times under three names. Deleting from there is
not the bin on a card: it takes the file out of the catalog and off every card
at once, which is why the confirmation names them.

The file is served by the manual's own id, `inline`, with two file names in the
`content-disposition`: an ASCII one every client can read and a `filename*` for
the real title. A header is bytes, and "Instrukcja obsługi" cannot be written
in one — which is how the first version answered 500.

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

## Where things are

`catalog.address` is a place: a workshop, a yard, a site, a van. A thing of its
own for the reason every shared thing here is one — fifty cards each carrying
"Budowa Mokotów, ul. Puławska 12" is fifty chances to spell it differently, and
"what is on the Mokotów site" is then a question nobody can ask.

Only `name` is required, and it is the part a picker shows: a crew says
"magazyn", not a postcode. The postal half is optional to the last field,
because a yard on a site has a name and no street and refusing to record it
until somebody invents one means it is not recorded at all.

`tool.address_id` and `organizer.address_id` are columns rather than a link
table: a thing is in one place, which is single-valued on this side and needs
no row of its own. The same reasoning as `brand_id`, the opposite of the
photos. `ON DELETE SET NULL`, so closing a site does not delete the kit that
was on it — and every answer carries `toolCount` and `organizerCount` so the
delete confirmation can say how many cards are about to lose their location.

Two things worth knowing before changing this.

**The two are independent, on purpose.** A tool in an arrangement carries its
own address and it can disagree with the arrangement's. A drill taken to a site
while its box stays in the workshop is genuinely two places; the catalog
records both rather than choosing which one to call the lie. If that is ever
made to inherit, it is a decision about the domain, not a bug fix.

**23503 now means two things.** A tool points at a place as well as at a maker,
and an organizer at a place as well as at a case, so a foreign key that matched
nothing has to be told apart by `error.constraint` — without that, a bad
address id reported a missing case.

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

## Changing something a client already reads

The web client is rebuilt from this repo and reloads. The second consumer is
not: a phone carries whatever version somebody installed, and it cannot be
asked to change on the day the API does. So the rule is **expand and contract**
rather than rename in place.

1. Add the new thing. Keep writing the old one.
2. Move the clients over. Mark the old one deprecated in `docs/api.md`.
3. Take the old one out, in its own release.

`Referencja` → `reference_url` is what this is for, and it is also what it
would have caught: the column was added and the parameter deleted in one step,
so a client reading the spec sheet for an address would have found nothing and
shown a card with no update button — no error, nothing to report, just a screen
that stopped working. Done properly, the seeder would have gone on writing the
parameter for one release.

**The check is switched off right now**, and `compatibility.test.ts` says why:
the catalog is being renamed from `tool` to `item`, which moves every route
under `/api/tools` and is one deliberate break from beginning to end. Left on,
it would fire on every commit of that and be answered by running
`openapi:baseline` without reading the output — which is the habit it exists to
prevent. Turning it back on is `npm run openapi:baseline` and changing one
`test.skip` back to `test`, and it has to happen before anybody builds a client
that ships on its own schedule.

`src/openapi/compatibility.ts` is the part that does not rely on remembering.
It compares `docs/openapi.json` against **`docs/openapi.baseline.json`**, the
contract as last released, and the test fails on anything an installed client
cannot survive:

- a path or a method that stopped answering;
- a property that left a schema, or changed type;
- a request property that became required, or an enum that lost a value;
- a bound that tightened — `maxLength` down is a break even though every field
  is still there.

**Additions are silent**, deliberately. Adding a field, a route or a response
is the safe half of every change, and a check that complained about those is
one people learn to run with their eyes shut.

To break the contract on purpose: make the change, run
`npm run openapi:baseline` **in the same commit**, and say why in the message.
That is the whole ceremony — it makes a break a line in the history rather than
something found later by somebody holding a phone. Nothing else writes that
file, and the build deliberately does not keep it level with the code.

### When adding is not enough

Expand and contract covers a field that moves. It does not cover a field whose
**meaning** changes under a name that stays — and no amount of adding does.

For that, a client says which build it is:

```
X-ToolTrack-Client: mobile/1.4.2
```

`client-version.ts` reads it, and two things follow. The first needs no
configuration at all: **every build is logged the first time it calls**, once,
so "is anybody still on 1.4" is answered by the log rather than by guessing —
which is what decides when the old field may finally go.

The second is `TOOLTRACK_MIN_CLIENT`, a floor per client. Under it the guard
answers **426** with the minimum in the body, before authenticating: a stale
build should be told to update rather than sent to a login screen it will come
back from and fail anyway. The `public` family is exempt, because `/healthz`,
`/api/version` and the contract are how somebody finds out what is wrong with
a build that is too old.

Three things it deliberately does not do. A caller that sends **no header**, or
one it cannot parse, passes — that is every client alive today, and a floor
that refused the unrecognised would take the catalog off the web the moment it
was set. A client **not named** in the floor list has no floor. And the 426 is
derived in `document.ts` from the same policy call the guard makes, rather than
written into eighty-odd operation specs, so the contract cannot claim a route
is exempt when the guard disagrees.

## Adding a route

1. Write the handler in `src/server/routes/`, and its SQL in the matching
   `*-store.ts`. Parse the body in a `*-input.ts` function so the rules can be
   tested on their own — as an exported **Zod schema** plus a thin
   `parseWith()` wrapper, because the contract's request schema is generated
   from that object. A rule written as an `if` is a rule the document cannot
   see. Query strings stay hand-written: they clamp rather than refuse, and a
   schema cannot express forgiveness.
2. Add the route to `ROUTES` in `src/server/route-list.ts` — that is where the
   path itself lives, and `compileRoute` turns it into a pattern — and the
   handler to `HANDLERS` in `src/server/router.ts`, keyed by the same string.
   `router.test.ts` compares the two in both directions.
3. Add it to `RULES` in `src/access/route-policy.ts`. Skipping this makes the
   route return 403 — that is the design, not a bug.
4. Document it in `docs/api.md`.
5. Fail through `errorResponse(status, code, message)` from
   `src/server/error-codes.ts`, never by building `{ error }` by hand. A test
   reads the source and fails on one built the old way, because that compiles,
   works, and quietly leaves a client with nothing to branch on. If no existing
   code fits the failure, add one — the name is the failure, not the route.
6. Describe it in `src/openapi/paths/`, or put it in `PENDING` in
   `src/openapi/operations.ts`. One or the other — the coverage test fails
   until a route is in exactly one of the two lists, which is how the spec
   stays honest about its own gaps rather than quietly omitting a route. Then
   `npm run openapi:build` and commit `docs/openapi.json`. A new route is an
   addition, so the compatibility check has nothing to say about it — see
   "Changing something a client already reads" for the case where it does.

`npm run lint` is `typecheck` plus `openapi:check`, so a committed document
that no longer matches the code fails before anyone generates a client from it.
Whether that document is _compatible_ with the last released one is a test
rather than a lint step, because it is a fact about two files in the repo and
`npm test` is where facts about this repo are asserted.

## Two doors, one session

A session is a row in `account.session`: an opaque token, stored only as its
SHA-256, with an expiry. There are two ways to present it and they are not two
systems.

- **The cookie**, set by `POST /api/auth/login`. `httpOnly`, so no script on
  the page can read it — which is why `login` deliberately does not answer with
  the token as well. A token in a response body is a token an XSS can take.
- **`Authorization: Bearer`**, from `POST /api/auth/token`, which answers with
  the token and sets no cookie. For a client with no page and no cookie jar
  worth depending on, which is what a native app is.

`sessionTokenOf` is where the two meet, and the header wins when both are
present: a client that has been given a token means to use it, and a stale
cookie from the same host should not quietly authenticate as somebody else.
Everything downstream — the guard, revoking, disabling an account, changing a
password — sees one session and does not know there are two doors.

Both doors share the login throttle, on purpose. A limit guarding one of two
ways into the same house is one a caller walks around.

The expiry **slides**: `authenticateRequest` pushes it out on every request, in
the same `UPDATE` that was already writing `last_seen_at`, so it costs nothing.
`LEAST` caps it against `created_at + SESSION_ABSOLUTE_TTL_DAYS`, because a
session that renewed itself for ever would mean a token taken silently is good
for ever as long as whoever took it keeps using it.

`GET /api/auth/sessions` and `DELETE /api/auth/sessions/:id` are what make a
lost phone recoverable without changing a password, which revokes everything
including the browser. The `device` label is the client's own string, shown on
that list and **never** read while authenticating.

## Guessing at a password

`login-throttle.ts` counts failed sign-ins, per e-mail and per address, and is
the only rate limit here. It is the only route that needs one: everything else
asks for a session first, so an unauthenticated caller can be refused but not
made to work.

Four decisions in it are load-bearing, and each is the kind that looks like a
detail until it is wrong.

- It counts what was **submitted**, before any lookup. An e-mail with no
  account has to be refused exactly like one that has an account, or the two
  answers are a way to list who is registered here — the same leak the single
  401 exists to close.
- Being refused **records nothing**. A block that renewed itself on every
  rejected attempt would let one guesser hold somebody's account shut for as
  long as they cared to, which is a denial of service dressed as a defence.
- A success clears the **e-mail** counter and not the address one. Clearing
  both would mean anybody holding one valid account could reset their address
  counter whenever it filled and carry on guessing at everyone else's.
- The address comes from the **socket** (`client-address.ts`), never from the
  Request the handler sees. Its headers are the caller's. `X-Forwarded-For` is
  read only under `TOOLTRACK_TRUST_PROXY`, and then the **last** entry, because
  a proxy appends the peer it saw and anything to the left is what the caller
  wrote.

In memory rather than in a table: the rows would be written by unauthenticated
requests, so the attacker would choose how many. The cost is that two replicas
mean two counters. One container is the deployment; the module is the place to
change if that stops being true.

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

`.vscode/` carries tasks (`typecheck`, `test`, `format`, `dev`, the `openapi:`
and `db:` ones, and a `start local stack` chain) and launch configurations for
the server, a single test file, the whole suite and a schema dry run.
`openapi: build` is there because it is the one step nothing runs for you:
adding a route or editing a Zod schema does not rewrite `docs/openapi.json`,
and the watcher cannot notice, since the build touches no TypeScript. Editor behaviour
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
