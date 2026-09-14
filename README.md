# ToolTrack Backend

The Node API behind ToolTrack — a catalog of construction tools. Every tool has
a card: name, category, brand, model, serial number, condition and notes. You
browse and search it from a phone, on site, and know what you own and what
state it is in.

Node 22 + TypeScript, a plain `node:http` server, raw Postgres. No framework,
no ORM, no migration tool. The web client lives in the sibling `Frontend/`
directory.

- [HTTP contract](docs/api.md) — every endpoint, written for the client.
- [Data model](docs/data-model.md) — the two schemas and why they look like that.
- [CLAUDE.md](CLAUDE.md) — conventions, and how to add a route.

## Roles

| Capability                    | viewer | editor | admin |
| ----------------------------- | :----: | :----: | :---: |
| browse and search the catalog |   ●    |   ●    |   ●   |
| add, edit and delete tools    |        |   ●    |   ●   |
| manage users and their roles  |        |        |   ●   |

Signing up is open and every new account is a **viewer**. An admin promotes
from there. See "First admin" below for a fresh database.

## Local development

```bash
cp .env.example .env
npm install
npm run db:up             # Postgres 16 in Docker on port 55433
npm run db:schema:apply   # applies the DDL, re-runnable
npm run dev               # http://localhost:37411, restarts on change
```

Check it is up:

```bash
curl -s localhost:37411/healthz
curl -s localhost:37411/api/version
```

`npm run db:down` stops the database; the data stays in the Docker volume.

## In VS Code

Open `Backend/` as the workspace folder — the settings below are per-folder and
do not apply if the editor is opened on `ToolTrack/`. Accept the recommended
extensions when prompted (Prettier, Docker, REST Client), then:

- **Cmd+Shift+B** runs `typecheck`; the test task is the default under
  _Run Test Task_. Both put their output in the terminal, and type errors in
  the Problems panel.
- **F5** starts the API with the debugger attached, breakpoints straight in the
  `.ts` files — there is no build step to step through. For watch mode plus a
  debugger, run the `dev: debug` script and use _API: attach to dev server_.
- _Tests: debug current file_ runs the test file in the active editor. Tests
  need no database, so this works with the container stopped.
- The `start local stack` task does `db: up`, `db: apply schema` and `dev` in
  order — what a fresh checkout needs.
- `open: status in browser` opens the running API. The root path answers 404
  with the route list, which is the quickest look at what is served;
  `/api/version` and `/healthz` are the two endpoints worth bookmarking.
- [`docs/api.http`](docs/api.http) is every endpoint as a clickable request.
  Log in once and the extension keeps the session cookie for the rest.

Editor behaviour (format on save, organize imports, LF, workspace TypeScript)
is the same as in the RN-App repo, so a save does the same thing in both. The
code style itself is not: this project has no semicolons, and `.prettierrc.json`
is the authority.

## Photos

Every tool can have several photos, one of them the main one. They arrive three
ways — an upload from a phone, a pasted URL, or a pick from the web search
behind `GET /api/tools/:id/photo-suggestions` — and all three end the same way:
the bytes stored by this server, under `TOOLTRACK_MEDIA_DIR` (`.local/media` by
default), named by their own checksum. A link is where a photo came from, not
something the catalog keeps depending on.

Uploads arrive as the raw file in the request body rather than as
`multipart/form-data`, and the file's type is decided by reading its first
bytes, not by trusting the header. See [docs/api.md](docs/api.md#photos).

**Everything is stored as PNG.** JPEG, GIF and WebP are converted at the door
by `src/server/image-convert.ts`; a PNG is kept byte for byte, because
re-encoding would change its checksum and therefore its storage key for no
gain. One stored format means every later step — the cutout today, a thumbnail
or an export tomorrow — decodes one format, and the one that used to be
unreadable (WebP, which is most of what an image search returns) is exactly
the one people wanted to cut out.

The cost is size: a 200 kB JPEG becomes a PNG several times larger, because
PNG is lossless and photographs are not what it was designed for. For a catalog
measured in hundreds of pictures that is an acceptable trade; if it stops being
one, the answer is a maximum edge length on the way in rather than a second
stored format. Photos that predate this run through
`npm run photos:png -- --apply`.

Three search engines, configured on the **Ustawienia** screen rather than in a
deploy: **Google Custom Search** and **Brave Search** need a key, **Openverse**
needs none and is therefore what works on a fresh install — at the cost of
indexing only openly licensed photography, which finds "angle grinder" but not
"GWS 180-LI".

Who owns what is split on purpose. An admin holds the keys and can switch an
engine off for the whole installation; every user decides which of the
configured engines their own searches use. When a search runs, every engine
enabled for that account is asked in parallel and contributes up to ten results
of its own; the answers are interleaved, and one engine failing costs its
results rather than the search. With nothing enabled the
API answers 503 and the button in the UI is disabled rather than hopeful.

Keys given as `GOOGLE_SEARCH_API_KEY` / `GOOGLE_SEARCH_CX` /
`BRAVE_SEARCH_API_KEY` still work; they are the bootstrap, and anything saved
through the screen wins over them. Credentials never leave the server — the
settings API reports only whether a key is set and its last four characters.

`GET /api/photos` is the same collection from the other side — every picture on
disk with the tool it belongs to, or with none — and `POST /api/photos/delete`
removes up to two hundred of them at once. That pair exists for the cleanup
after an import that pulled in the wrong pictures, which the per-tool gallery
is the wrong shape for.

A photo does not have to belong to a tool. `POST /api/photos` uploads one that
does not: pictures arrive before anyone decides what they are — a batch off a
phone at the end of a day — and forcing a tool at that moment is how photos end
up on the wrong card. `?assigned=false` finds them again, and
`POST /api/tools/:id/photos/attach` is the way out of that shelf: an unattached
photo is **moved** onto the tool, keeping its id, while one that already
belongs to another tool is **copied**, which costs a row rather than a second
file.

### Cutting the tool out

`POST /api/tools/:id/photos/:photoId/cutout` returns the tool alone, without
the bench it was photographed on. It adds a photo and links it to the original
(`source: "edit"`, `derivedFrom`), so an unconvincing cutout is one delete away
from undone.

**The default needs no key and no service.** `src/server/cutout-local.ts`
carries the method from the Qbrick labelling project: everything light that
touches the edge of the frame is background, what is left is the object, the
largest such object is the tool, and the result is cropped to its outline with
a transparent background. It answers in milliseconds and costs nothing.

It works on catalogue photos — a tool on a plain light background, which is
exactly what the web search imports — and **refuses everything else with a
422** rather than returning half a cut-out workbench. Two differences from the
original script: the background is flooded in from the border rather than taken
as the largest dark blob, so a white label in the middle of a drill stays part
of the tool; and the background becomes real transparency instead of white
paint.

For photographs taken on site there are two paid providers: **remove.bg**,
built for exactly this and returning a transparent PNG, and **Gemini**, a
general model that returns the tool on a plain white background instead. Which
methods may be used, and their keys, are set on the **Ustawienia** screen, like
the search engines — `REMOVE_BG_API_KEY`, `GEMINI_API_KEY` and
`TOOLTRACK_CUTOUT_THRESHOLD` remain as the bootstrap for the keys and the
threshold, and anything saved through the screen wins. There is no default
method: whoever presses the wand picks one from what is available.

The wand opens a screen rather than doing something immediately: method on the
left of the parameters, original and result side by side, and nothing written
until it is accepted. That is `preview` → `commit` in the API. The
preview lands in a cache under `<media>/previews` and is swept after
`TOOLTRACK_PREVIEW_TTL_MINUTES` (30 by default), so keeping one costs no second
call to a paid service and discarding one costs nothing at all. The sweep runs
when a preview is written (at most once a minute), at startup, and on a timer
that cannot hold the process open — there is no cron in this server, and a
preview cache does not deserve one.

The local method reads whatever is stored, which since the conversion above is
always PNG. It still refuses a photograph with no plain background — that is a
statement about the picture, not the format, and the 422 says so, so the person
at the wand can pick a paid method for that one photo.

The AI prompt is deliberately narrow: keep the tool exactly as it is, remove
everything else, invent nothing. A cutout that "improves" the tool is a picture
of a tool we do not own.

Two things this deliberately does not do: it does not resize or re-encode
anything (no image library, no native dependency — the cap is the size limit),
and it does not check whether a photo from the web may be republished.
`attribution` is stored when the provider states one; what may be done with a
picture is a decision for the person ticking the box.

## Importing the Qbrick tool list

The fifteen labelled Qbrick boxes from `~/Projects/Qbrick` are the first real
content of this catalog. The list is frozen into
`scripts/data/qbrick-tools.json` — taken from that project's `generuj.py` and
`ZASADY-PROJEKTU.md`, not read from it live: it is a PDF label generator with
its own release cycle, and a catalog import must not change because someone
re-numbered a sticker.

```bash
npm run qbrick:import              # validate and report, writes nothing
npm run qbrick:import -- --apply   # insert what is missing
```

One manifest entry is one physical tool, not one box: boxes 01 and 11 hold two
tools, 14 and 15 hold three, so fifteen boxes import as twenty-one cards. The
box number goes into the notes, because a card has no location field yet.

Re-running it is safe. Nothing here has a serial number, so the importer
dedupes on name, brand and model — what a person would read as the same card —
and skips what is already there. It records the cards as created by the
account named with `--actor`, or by the oldest active admin.

Catalog and part numbers (`SR1E7615AB`, `0611910000`, `6-TRE650`) are kept in
the notes rather than in the serial number field: they identify a model, not
the individual machine, and that field is unique per tool.

## Importing the Qbrick cases

The boxes themselves come from the manufacturer's product pages, frozen into
`scripts/data/qbrick-cases.json` for the same reason the tool list is frozen: a
catalog that changed because a shop restyled its spec table is a catalog nobody
could trust twice. Each entry carries the page it was read from.

```bash
npm run qbrick:cases              # validate and report, writes nothing
npm run qbrick:cases -- --apply   # insert what is missing, and top up the sheets
```

It writes **parameters** and the **note** as well as cases. The pages state nine
rows and seven of them are columns; the weight and the pallet count are not, so
those two are frozen into the manifest as attributes. Beside them goes
`Referencja`, derived from `sourceUrl` — the same name an imported tool carries,
so "where did 11 L come from" is answered in the same place on both.

A case already in the catalog gets all of it, which is what makes a second run
worth anything.

The two are updated differently, on purpose. **Parameters are added, never
replaced**: this is a seeder run again months later, and it has no business
deleting a line somebody typed themselves. **The note is overwritten**, because
it is a sentence the manifest owns rather than a list people add to — and it has
to be, now that the address and the weight have left it for parameters of their
own. A note that already matches is left alone, so a second run is silent.

That is the one place this differs from `POST /api/cases/:id/import`, where the
page is the source of truth and a parameter the maker dropped should leave the
card.

The **notes disagree** between the two, and knowingly. The live import writes
the maker's own description, because that is what the page says about the box.
The manifest holds a remark about the catalog instead — that the capacity on a
drawer unit is the sum of its drawers — which is a thing no product page can
know and no description would ever say. Pressing "update from the page" on one
of those two cases replaces the remark with the maker's prose, which is the
same bargain a tool card makes and the reason the button is not a background
job.

The catalog keeps one value per measurement, and two of these products do not
have one. The drawer units list a capacity and a load **per drawer**, so the
import stores the sum, takes the internal dimensions of the largest drawer, and
writes the breakdown into the notes — where nothing is lost and nobody has to
guess which drawer 4,5 L referred to.

Validation is the parser the API uses, plus one rule of its own: internal
dimensions larger than external ones mean a decimal point moved while somebody
was copying a table. Re-running is safe — the importer dedupes on maker and
name, because the EAN cannot be a key when owning two identical cases is
normal.

## Looking at the data

```bash
npm run db:adminer   # http://localhost:8080, brings Postgres up with it
```

Adminer is a table browser and a query box — the Postgres equivalent of
phpMyAdmin — and it sits behind a compose profile, so `npm run db:up` does not
start it and nothing holds port 8080 when nobody is looking. In VS Code the
`open: adminer in browser` task starts it and opens a URL that already has the
driver, server, user and database filled in; the password is `tooltrack`.

Two things to know: inside the compose network the server is `postgres:5432`,
not `localhost:55433` (that port is only published to the host), and the
tables are in the `account` and `catalog` schemas, not `public`.

With the SQLTools extension the same database is one click in the sidebar —
the connection is already in `.vscode/settings.json`. And when a shell is
enough:

```bash
docker compose exec postgres psql -U tooltrack -d tooltrack
# \dn                    schemas
# \dt account.* catalog.*  tables
# select * from catalog.tool;
```

`npm run db:down` stops everything, Adminer included.

## First admin

Every registration is a viewer, so a fresh database has nobody who can promote
anyone. Create one:

```bash
npm run user:admin -- --email you@example.com --password 'a-real-password'
```

It is idempotent: run it again for an existing account and that account is
promoted to an active admin, with its password replaced only if `--password`
is given. That is also how to recover an installation where the last admin was
lost.

The other way in is `TOOLTRACK_BOOTSTRAP_ADMIN_EMAILS`: accounts on that list
resolve as admins whatever the database says, so nobody can be locked out by a
demotion. Prefer promoting a real account and then unsetting it. It never
overrides `status = 'disabled'`.

## Talking to it

```bash
# register (always a viewer) and keep the session cookie
curl -s -c cookies.txt -H 'content-type: application/json' \
  -d '{"email":"ola@example.com","password":"sekret1234"}' \
  localhost:37411/api/auth/register

# what may this session do?
curl -s -b cookies.txt localhost:37411/api/auth/me

# the catalog
curl -s -b cookies.txt 'localhost:37411/api/tools?q=makita&condition=needs_repair'
```

The session is an HttpOnly cookie holding an opaque token; only its SHA-256 is
stored, so a database dump cannot be used to sign in as anyone. It is marked
`Secure` when `NODE_ENV=production`, and never in development, or a session
over `http://localhost` could not work at all.

The web client is served from its own origin and logs in with that cookie, so
its origin has to be on `TOOLTRACK_ALLOWED_ORIGINS`. In development
`http://localhost:5173` is allowed by default; in production the list starts
empty, because credentialed CORS cannot use a wildcard.

## Verification

```bash
npm test          # node:test, colocated as src/**/*.test.ts
npm run typecheck
```

Tests do not need a database: the stores take their pool as an argument, and
the tests hand in a fake that records the statement instead of running it. What
that cannot prove is that the SQL parses, so anything touching a query should
also be run against `npm run db:up` once.

## Schema

There are no migration files. The DDL lives in `src/server/account-schema.ts`
and `src/server/catalog-schema.ts` as strings written to be re-runnable, and
one script applies them:

```bash
npm run db:schema:apply                 # everything, account first
npm run db:schema:apply -- --only catalog   # one batch
npm run db:schema:apply -- --dry-run
```

A `DATABASE_URL` that does not point at localhost needs
`CONFIRM_REMOTE_SCHEMA=true` on the command line. Note that a proxy listening
on `127.0.0.1` can front a production instance, so that check is a speed bump,
not a guarantee — read the URL before you run it.

## How a failure comes back

Every failed call answers `{ code, error }`. `error` is prose for a person and
follows `Accept-Language`; `code` is the stable name of the failure, never
translated and the same whichever route produced it. A client branches on the
code, never on the message.

The catalogue is `src/server/error-codes.ts` and the OpenAPI document enumerates
it, read from that file rather than copied — so a code the server can return and
the contract does not mention cannot exist. Failures are built through
`errorResponse()`, and a test reads the source to make sure none is built any
other way.

## The OpenAPI description

`docs/openapi.json` is the machine-readable contract, served by the running
server at `GET /api/openapi.json` and generated by `npm run openapi:build`.
`npm run lint` fails when the committed document no longer matches the code,
so it cannot quietly rot.

Four things in it are derived rather than written, because each is a fact the
server already holds and a second copy of a fact is a copy that goes stale:

- the **entity schemas**, generated from the TypeScript types the handlers
  return — add a column to `Tool` and the schema grows with it;
- the **request bodies**, generated from the Zod schemas in `*-input.ts` that
  refuse a bad body at runtime — the object that rejects a 201-character name
  is the object that writes `"maxLength": 200`;
- the **security** of every operation, read from `src/access/route-policy.ts`
  by calling the same function the guard calls;
- the **path parameters**, read off the route itself.

What is written by hand is what no machine knows: what an endpoint is for and
which failures it can actually produce. That lives in `src/openapi/paths/`.

Query strings are deliberately not schemas. A list forgives — a pasted link
with `?limit=banana` still shows the catalog, clamped — and a schema that
forgives accepts anything, which says less than the parameter list already
does.

A **path** is written once, in `ROUTES`. `compileRoute` turns `/api/tools/:id`
into the pattern that matches it, so the router no longer keeps a second copy as
a regular expression of its own.

What is still separate, on purpose, is the **access policy**. Six of its rules
match `[^/]+` where the router matches `\d+`: it classifies a family of paths
rather than the exact ones the router happens to serve, so a mistake in the
router cannot expose something the policy never considered. Deriving both from
one table would make it a single opinion instead of two, which is the property
worth keeping.

So a route lives in three places — the list, the handler table, and the policy —
plus its description in `src/openapi/paths/`. Three tests tie them together, so
forgetting one fails immediately and names which: `router.test.ts`,
`src/openapi/coverage.test.ts` and `docs/api-coverage.test.ts`.

Coverage is partial on purpose and says so out loud. `src/openapi/operations.ts`
holds a `PENDING` list beside the described ones, and `coverage.test.ts` asserts
that the two together are exactly the routing table — so a route added tomorrow
fails the build until somebody decides which list it belongs in. A spec is only
dangerous when it does not know which half of itself is missing.

`docs/api.md` remains the prose contract and is the one to read first; the spec
is what a second client generates itself from.

## Deployment

`Dockerfile` builds a container that runs the TypeScript directly through
`tsx`. It listens on `$PORT` (8080 in the image, 37411 locally) and needs
`DATABASE_URL`, `NODE_ENV=production` and `TOOLTRACK_ALLOWED_ORIGINS`. Pass
`--build-arg TOOLTRACK_COMMIT=$(git rev-parse --short HEAD)` and
`/api/version` will tell you what is running.

`/healthz` is the liveness probe and deliberately never touches Postgres: a
probe that fails during a brief database blip restarts a container that was
about to recover. Database trouble is reported per request, as a 503.

`assets/` is copied into the image because it is read at runtime: the fonts a
label is drawn with, and one CA certificate. The `start` and `dev` scripts
point `NODE_EXTRA_CA_CERTS` at that certificate — nac.com.pl serves an
incomplete chain, which a browser repairs by itself and Node does not, and
without it every import from that source fails as an unreachable page. The
reasoning is in `assets/certs/README.md`; run the server by its npm script
rather than by calling `tsx` directly and it is handed over for you.
