# ToolTrack API

Every response is JSON. Authentication is a session cookie (`tooltrack_session`,
HttpOnly), issued by register or login and sent by the browser automatically.
A non-browser client keeps the cookie and sends it back on every call.

Access is enforced centrally in `src/access/route-policy.ts`, before any
handler runs. Two refusals are possible and they mean different things:

| Status | Meaning                                                 | What the client should do              |
| ------ | ------------------------------------------------------- | -------------------------------------- |
| `401`  | No session, or it expired                               | Send the user to the login screen      |
| `403`  | Signed in, not allowed                                  | Say so; an admin has to grant the role |
| `409`  | Conflict (duplicate email or serial number, last admin) | Show `error`                           |
| `503`  | Database unavailable                                    | Retry; the request itself was fine     |

## Roles

| Capability                                                  | viewer | editor | admin |
| ----------------------------------------------------------- | :----: | :----: | :---: |
| `catalog.read` — browse and search the catalog              |   ●    |   ●    |   ●   |
| `catalog.write` — add, edit, delete tools, cases and photos |        |   ●    |   ●   |
| `users.manage` — list users, change roles                   |        |        |   ●   |

New accounts are always `viewer`.

## Auth

### `POST /api/auth/register`

```json
{ "email": "ola@example.com", "password": "sekret1234", "displayName": "Ola" }
```

`201` with `{ user, capabilities }` and a session cookie. `displayName` is
optional and defaults to the part before the `@`. `409` if the email is taken.

### `POST /api/auth/login`

```json
{ "email": "ola@example.com", "password": "sekret1234" }
```

`200` with `{ user, capabilities }` and a session cookie. `401` for a wrong
password, an unknown account and a disabled account alike — one answer, so the
form cannot be used to find out which addresses have an account.

### `POST /api/auth/logout`

`200 { "ok": true }` and clears the cookie. Succeeds without a session too.

### `GET /api/auth/me`

`200 { user, capabilities, effectiveRole }` or `401 { "user": null }`.
Render menus from `capabilities`, not by comparing role strings.

### `PATCH /api/auth/password`

```json
{ "currentPassword": "sekret1234", "newPassword": "inne-haslo-9" }
```

`200 { "ok": true, "reauthenticationRequired": true }`. Every session of that
account is ended, including the caller's, so the client has to log in again.
`403` if the current password is wrong.

## Tools

### `GET /api/tools` — `catalog.read`

Query parameters, all optional:

| Name          | Meaning                                                                    | Default     |
| ------------- | -------------------------------------------------------------------------- | ----------- |
| `q`           | Substring match over name, brand, model, serial number, category and notes | —           |
| `category`    | Exact category, case-insensitive                                           | —           |
| `condition`   | One of `new`, `good`, `worn`, `needs_repair`, `retired`                    | —           |
| `inOrganizer` | `false` for tools in no organizer — what the organizer wizard offers       | —           |
| `sort`        | `updatedAt`, `createdAt` or `name`                                         | `updatedAt` |
| `order`       | `asc` or `desc`                                                            | `desc`      |
| `limit`       | 1–200                                                                      | 50          |
| `offset`      | ≥ 0                                                                        | 0           |

```json
{ "items": [/* tools */], "total": 128, "limit": 50, "offset": 0 }
```

Each item is a tool plus two things the grid needs and would otherwise ask for
per card: `primaryPhotoUrl`, and `organizer` — where the tool lies.

```json
{
  "organizer": {
    "organizerId": 4,
    "number": 4,
    "caseId": 2,
    "caseName": "Qbrick System PRO Toolbox 2.0",
    "casePhotoUrl": "/api/photos/29/file"
  }
}
```

`null` for a tool nobody has put anywhere. Both are one query for the whole
page, so a screen of tools costs three statements rather than one per row.

A malformed `limit`, `offset` or `sort` is clamped or ignored rather than
refused — a pasted link should still show the catalog. An unknown `condition`
is a `400`, because silently listing everything would look like an answer.

### `GET /api/tools/categories` — `catalog.read`

`{ "categories": [{ "category": "Wiertarki", "count": 12 }] }`, read from the
tools themselves. That is the list to offer in a filter.

### `POST /api/tools` — `catalog.write`

```json
{
  "name": "Młotowiertarka",
  "category": "Wiertarki",
  "brand": "Makita",
  "model": "HR2470",
  "serialNumber": "12345-AB",
  "condition": "good",
  "notes": "Szczotki do wymiany"
}
```

`name` is the only required field; the rest default to `""` and `condition` to
`good`. `201 { tool }`. `409` if another card already claims that serial
number (blank serial numbers are exempt).

### `GET /api/tools/:id` — `catalog.read`

`200 { tool }` or `404`.

### `PATCH /api/tools/:id` — `catalog.write`

Send only what changes. `""` clears a field; omitting it leaves it alone. The
name cannot be cleared. `200 { tool }`, `404`, or `409` on a duplicate serial.

### `POST /api/tools/:id/duplicate` — `catalog.write`

Another card just like this one. `201 { tool }`.

Everything is copied except the **serial number**, which starts blank: it
identifies one physical machine, and the unique index would refuse a second
card claiming it. Which is the point — a crew with three identical grinders
wants three cards, and the difference between them is the number on the plate.

The photos come along as links to the same pictures, main photo included. Two
of the same model look the same, and since the pairing is a row this costs a
row rather than a second file.

### `DELETE /api/tools/:id` — `catalog.write`

`200 { "ok": true }` or `404` if it was already gone.

### The tool object

```json
{
  "id": 7,
  "name": "Młotowiertarka",
  "category": "Wiertarki",
  "brand": "Makita",
  "model": "HR2470",
  "serialNumber": "12345-AB",
  "condition": "good",
  "notes": "",
  "createdBy": 3,
  "updatedBy": 3,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-02T00:00:00.000Z"
}
```

## Cases

A case is the box the tools live in. Name and manufacturer are required;
everything else comes off a spec sheet, and a spec sheet is something you have
or you do not. Measurements are `null` when nobody has taken them — never `0`,
which would be a claim about a box with no height.

### `GET /api/cases` — `catalog.read`

| Parameter      | Meaning                                       | Default |
| -------------- | --------------------------------------------- | ------- |
| `q`            | Name, manufacturer, system, EAN, SKU, notes   | —       |
| `manufacturer` | Exact match, case-insensitive                 | —       |
| `system`       | Exact match, case-insensitive                 | —       |
| `sort`         | `name`, `capacityL`, `createdAt`, `updatedAt` | `name`  |
| `order`        | `asc` or `desc`                               | `desc`  |
| `limit`        | 1–200                                         | 50      |
| `offset`       | ≥ 0                                           | 0       |

`200 { items, total, limit, offset }`. Each item is a case plus
`primaryPhotoUrl`, so a grid can show thumbnails without a request per row.
Sorting by capacity puts the unmeasured cases last rather than first.

### `GET /api/cases/systems` — `catalog.read`

`200 { systems: [{ system, count }] }` — read from the cases themselves, the
same way tool categories are.

### `POST /api/cases` — `catalog.write`

`name` and `manufacturer` are required. Measurements accept a number, a numeric
string, or a string with a Polish comma (`"4,5"`); `null` and `""` both mean
"not known". Millimetres must be whole numbers, litres and kilograms may carry
two decimals. `201 { case }`.

### `GET /api/cases/:id` — `catalog.read`

`200 { case }` or `404`.

### `PATCH /api/cases/:id` — `catalog.write`

Any subset of the create body. An omitted field is left alone; an explicit
`null` clears a measurement, which is how a number copied off the wrong spec
sheet gets removed. `200 { case }`.

### `DELETE /api/cases/:id` — `catalog.write`

`200 { ok: true }`. The photos of the case go with it — the foreign key
cascades.

### `POST /api/cases/:id/label-slots` — `catalog.write`

Where a label goes on this case: `{ "widthMm": 30, "heightMm": 40 }`. Whole
millimetres, always width by height of the outline, and neither may be zero —
elsewhere on a case a missing measurement is null and means "nobody measured",
but a label with no width is not a label.

`201 { case }` — the whole case, so a screen showing the slots together does
not have to merge one into a list it already holds. `409` when this case
already has that size: the pair is the key, and adding it twice is a mistake
rather than a second place. The same size on another case is fine, which is
the point of a modular system.

### `DELETE /api/cases/:id/label-slots/:slotId` — `catalog.write`

`200 { case }`, or `404` when this case has no such slot.

### The case object

```json
{
  "id": 2,
  "name": "Qbrick System PRO Toolbox 2.0",
  "manufacturer": "Qbrick",
  "system": "PRO",
  "outerLengthMm": 450,
  "outerWidthMm": 331,
  "outerHeightMm": 240,
  "innerLengthMm": 331,
  "innerWidthMm": 245,
  "innerHeightMm": 189,
  "diagonalMm": 497,
  "capacityL": 19,
  "loadKg": 20,
  "ean": "5901238254249",
  "sku": "SKRQTBPRO2CZAPG001",
  "notes": "",
  "labelSlots": [{ "id": 1, "widthMm": 30, "heightMm": 40 }],
  "createdBy": 1,
  "updatedBy": 1,
  "createdAt": "2026-09-11T18:12:33.370Z",
  "updatedAt": "2026-09-11T18:12:33.370Z"
}
```

The EAN and the SKU identify the product, not this box: two identical cases on
the shelf are two rows carrying the same barcode, so neither is unique. That is
the difference from a tool's serial number, which is one machine.

## Photos

A card has any number of photos and at most one **main** photo — the one the
grid shows. The first photo added becomes the main one automatically, and
removing the main one promotes the oldest remaining attachment.

The bytes are always stored by this server. A URL or a search result is a
source, not a link the catalog keeps depending on: a page that disappears next
year must not empty the shed.

Everything in this section exists twice, under `/api/tools/:id/…` and under
`/api/cases/:id/…`. They are the same routes, served by the same handler, and
the only difference is which link table the pairing lands in. `:id` below means
either.

A **picture** and **a card showing a picture** are two different things. The
photo object is the picture: it has no owner and no `isPrimary`, because the
same photograph can illustrate several tools, several cases, and a tool
together with the case it lives in. The per-card routes add `isPrimary`, which
belongs to the pairing.

### `GET /api/{tools,cases}/:id/photos` — `catalog.read`

```json
{ "photos": [{ "id": 3, "url": "/api/tools/7/photos/3/file", "isPrimary": true }] }
```

Main photo first, then in the order the pictures were attached to **this**
card. Each entry carries `isPrimary` and the picture's own `contentType`,
`byteSize`, `width`, `height`, `source` (`upload` \| `url` \| `search` \|
`edit`), `sourceUrl`, `attribution`, `derivedFrom`, `createdBy` and
`createdAt`.

### `POST /api/{tools,cases}/:id/photos` — `catalog.write`

Two request shapes on one endpoint.

**An uploaded file** — the raw bytes as the body, with the file's own type:

```
POST /api/tools/7/photos
Content-Type: image/jpeg

<bytes>
```

Not `multipart/form-data`: one file per request needs no envelope, and
`fetch(url, { body: file })` is all the client has to do. `201 { photo }`.

**Links** — one address, or a batch ticked in the suggestions:

```json
{ "url": "https://example.com/gws.jpg", "attribution": "example.com" }
{ "items": [{ "url": "…", "attribution": "…" }, { "url": "…" }] }
```

Up to thirty at a time — with several engines enabled the suggestion grid
holds more than one engine's worth, and someone may reasonably tick a
screenful. The server fetches each one and stores it. `201 { photos, failed }`:
one dead link out of ten does not lose the other nine, and `failed` says which
address failed and why. Everything failing is a `422`.

Whatever arrives — JPEG, GIF, WebP — is **converted to PNG before it is
stored**, so every photo this API serves back is `image/png`. A PNG is kept
byte for byte.

Refusals worth handling: `409` the same image is already on this tool
(compared by checksum of the stored PNG, not by URL), `415` the file is not a
JPEG, PNG, GIF or WebP — decided by reading the file, not by trusting its
content type — and `413` above the size cap. An address pointing into a private network is
refused as a failed item, never fetched.

### `POST /api/{tools,cases}/:id/photos/attach` — `catalog.write`

```json
{ "photoIds": [24, 25] }
```

Puts photos that already exist on this tool — the other half of being able to
upload a picture before deciding what it is. Two different things depending on
where the photo is now:

- **unattached** — it is _moved_: it keeps its id and leaves the unassigned
  shelf, which is what "assign" means to the person doing it;
- **on another tool** — it is _copied_. The same picture can legitimately
  illustrate two tools, and since files are addressed by checksum the copy is a
  row, not another megabyte.

`201 { photos, failed }`; one id that no longer exists does not lose the rest.
`409` when none of them could be attached — already on this card, or gone.

### `GET /api/{tools,cases}/:id/photos/:photoId/file` — `catalog.read`

The bytes, with `cache-control: private, immutable` and the checksum as `ETag`.
Use it directly as an `<img src>`.

### `PATCH /api/{tools,cases}/:id/photos/:photoId` — `catalog.write`

```json
{ "isPrimary": true }
```

The only edit a photo has. Everything else about it is a fact about the file.

### `DELETE /api/{tools,cases}/:id/photos/:photoId` — `catalog.write`

`200 { "ok": true }`. Takes the picture off **this** card. If no other card
shows it, the picture and its file go too — a bin on a card has to mean the
photograph is gone, not that it moved to a library nobody asked to fill.

Deleting a whole tool or case does the same for everything it showed: its
pairings go with it, and the pictures no other card uses go with those.

### `POST /api/{tools,cases}/:id/photos/:photoId/cutout` — `catalog.write`

Take this photo and give back the tool alone, without the workbench, the case
or the hands holding it.

`201 { photo, provider }`. It **adds** a photo rather than replacing one: the
original stays, the new one carries `source: "edit"` and `derivedFrom` with
the original's id, and it does not become the main photo on its own — whether
a cutout beats the photograph is a judgement for whoever sees both.

Three refusals, and they mean different things:

- `422` — this photograph cannot be cut out. The default method needs a plain
  light background; a picture taken on a workbench has none. Try another photo,
  or point the server at an AI provider.
- `503` — the configured service is unavailable or the feature is switched off.
  Nothing to do with this photo.
- `409` — the result is byte-identical to a photo already on the card, which
  means it was cut out once before. The local method is deterministic, so this
  is how a second press answers.

Takes seconds rather than milliseconds. Clients should show progress on the
photo it was started from.

### The cutout screen: `preview` → `commit`

One-click is not always what you want. These two split the same work so a
person can see the result before anything is written.

**`POST /api/{tools,cases}/:id/photos/:photoId/cutout/preview`** — `catalog.write`

```json
{ "method": "local", "threshold": 700, "padding": 20, "removeBgType": "product" }
```

Every field is optional. `method` is `local`, `removebg` or `gemini` and has to
be one the installation allows — anything else answers 503, whether it came
from this screen or from settings. Omitting it uses the local method when it is
allowed. `threshold` and `padding` are the local method's knobs; `removeBgType`
is remove.bg's hint about what it is looking at.

There is no "try the free one and fall back to a paid one" mode. This screen
shows the refusal, and whether a photo is worth a paid call is a decision for
the person looking at it.

```json
{
  "preview": {
    "checksum": "…",
    "url": "…",
    "width": 200,
    "height": 160,
    "byteSize": 279,
    "contentType": "image/png"
  },
  "provider": "local"
}
```

Nothing is written to the catalog. The bytes go to a **preview cache** —
`<media>/previews`, swept after `TOOLTRACK_PREVIEW_TTL_MINUTES` (30 by
default) — so a cutout nobody accepts disappears on its own instead of
becoming a file the catalog has to explain. Accepting copies it into the photo
store, which costs no second call to a paid service for a picture somebody has
already seen.

**`GET .../cutout/preview/:checksum`** — `catalog.write`. The bytes, for the
`<img>` on the right-hand side of the screen. `404` once the preview has
expired, and its `cache-control` never outlives the cache it came from — a
browser holding a picture the server has already forgotten is how a save fails
after a preview that still looked fine.

**`POST .../cutout/commit`** — `catalog.write`

```json
{ "checksum": "…" }
```

Turns a preview into a photo: `source: "edit"`, `derivedFrom` the original,
`201 { photo }`. `409` if the preview has expired or was never made — an old tab, a swept
cache — in which case it is generated again rather than half-saved; or if that
exact cutout is already on the card.

### `GET /api/{tools,cases}/:id/photo-suggestions` — `catalog.write`

Up to ten images found on the web for this tool. `?q=` overrides the query,
which otherwise is the tool's brand and model.

```json
{
  "providers": ["google", "openverse"],
  "failed": [],
  "query": "Bosch Professional GWS 180-LI",
  "suggestions": [
    {
      "provider": "google",
      "url": "…",
      "thumbnailUrl": "…",
      "sourceUrl": "…",
      "title": "…",
      "attribution": "…",
      "width": 1200,
      "height": 800
    }
  ]
}
```

Every engine enabled for the calling account is asked **in parallel**, and each
one contributes **up to its own `resultLimit`** — ten by default, set per engine
in the settings. The limit is per engine, so two engines switched on mean twice
as much to choose from rather than the same ten split between them, and the
merged list holds the sum of their shares. The answers are interleaved, so the first row shows all of them,
and the same picture found by two engines is one suggestion. An engine that
fails is named in `failed` and the rest still answer; only when all of them
fail is it a `503`.

**`mistama`** is not an image index but a shop, and it answers a different
question: instead of pictures that look like the words, it finds the product
card for this model and hands back that card's gallery — one machine
photographed from every side, at the size the manufacturer shot it. It is the
best engine here for a tool it sells and useless for one it does not. Its
search wants every word to match, so a query it cannot place is retried on the
last two words alone, which is where the model number sits.

A result only counts when its name answers the query: every part of the query
carrying a digit has to appear in the product's name or address, and a query
with no such part needs a word of its own to appear. The shop ranks something
for almost any query — "Dexter 360" returned a bearing flange — and a
confident answer about the wrong machine is worse than an empty one.

Nothing is downloaded here — these are links. Saving is `POST /photos` with the
ones that were picked. It asks for `catalog.write` rather than `catalog.read`
because it costs an API call and exists only to add a photo.

`503` when no engine is enabled for this account, or when every enabled one
failed. The catalog is unaffected, so the client says so rather than looking
broken — and when nothing is enabled it points at the settings screen.

## Search engine settings

Two owners, deliberately split: the credentials belong to the installation and
only an admin may change them; which of the configured engines a given account
searches with is that person's own business.

### `GET /api/settings/search-engines` — `catalog.read`

```json
{
  "engines": [
    {
      "provider": "google",
      "label": "Google Custom Search",
      "configured": true,
      "globallyEnabled": true,
      "usedByMe": true,
      "keyHint": "••••f-LM",
      "keySource": "environment",
      "requiresKey": true,
      "requiresSecret": true,
      "keyLabel": "Klucz API",
      "secretLabel": "Identyfikator wyszukiwarki (cx)",
      "resultLimit": 10,
      "maxResults": 10
    }
  ],
  "usable": 2
}
```

`resultLimit` is how many pictures this engine contributes to one search, and
`maxResults` is the highest it may be set to — the provider's own ceiling where
it has one (Google answers with at most ten however it is asked), otherwise 30.

The same answer for everybody, because a non-admin has to see why the search
button is grey. **It never carries a credential** — only whether one is set,
where it came from and its last four characters. `usable` is the number of
engines this account's search would actually run against; zero means the button
has nothing to call.

### `PATCH /api/settings/search-engines/:provider` — `users.manage`

```json
{ "apiKey": "…", "apiSecret": "…", "enabled": true, "resultLimit": 20 }
```

Global. An omitted field keeps what is stored, an empty string clears it — that
distinction is what lets a form which never receives a key avoid wiping one.

`resultLimit` is refused outside 1–30 and quietly lowered to the provider's own
ceiling within it. Those are different mistakes: 99 is somebody typing
nonsense, while 30 for Google is a reasonable thing to ask for that Google will
not do.
`enabled: false` switches the engine off for everyone, whatever each account
prefers; it is how you stop paying for a provider without deleting its key.
Answers with the same shape as the `GET`.

### `PATCH /api/me/search-engines/:provider` — `catalog.write`

```json
{ "enabled": false }
```

This account only. A missing row means "use it", so a newly configured engine
is on for everybody the moment an admin sets it up.

### Where credentials come from

A value saved through this API wins. When none is stored, the engine falls back
to its environment variable (`GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_CX`,
`BRAVE_SEARCH_API_KEY`), which is what `keySource` reports. Openverse and
mistama need neither, so those two are what a fresh install can search with.

### `GET /api/settings/cutout` — `catalog.read`

```json
{
  "methods": [
    {
      "method": "local",
      "label": "Lokalny skrypt",
      "configured": true,
      "enabled": true,
      "requiresKey": false,
      "keyHint": "",
      "keySource": "none"
    }
  ],
  "threshold": 735,
  "usable": 1
}
```

The same shape as the engine list, and the same rule: readable by anyone who
may read the catalog, because whoever presses the wand should be able to see
which methods exist and why one is missing, and **never a credential** — only
whether a key is set and its last four characters. `usable` counts the methods
the cutout screen can offer; zero means the wand has nothing to run.

There is no default method. Which one runs on a given photo is chosen on the
cutout screen, from what is switched on here.

### `PATCH /api/settings/cutout/:method` — `users.manage`

```json
{ "enabled": true, "apiKey": "…" }
```

`:method` is `local`, `removebg` or `gemini`. Omitted keeps, empty string
clears — as everywhere. The local method has no key, and sending one is a
`400` rather than a value nothing would read.

### `PATCH /api/settings/cutout` — `users.manage`

```json
{ "threshold": 700 }
```

The only setting that is not a method: where the local method's threshold
starts on the cutout screen. 1 to 765, where 765 is pure white.

## Producers

A brand is a maker: one row, many tools. The logo is a picture from the same
library everything else draws from, linked one to one — a brand has at most one
logo, and a picture is the logo of at most one brand.

Tools carry the maker twice on purpose, for now: `brand` is the text the card
shows and the catalog searches, `brandId` points at the row. Creating or
editing a tool matches the typed name against the brands, case-insensitively,
and points the card at one when it recognises it — a name it does not know
points at nothing rather than inventing a brand from a typo.

### `GET /api/brands` — `catalog.read`

| Parameter | Meaning           | Default |
| --------- | ----------------- | ------- |
| `q`       | Name or notes     | —       |
| `sort`    | `name` or `tools` | `name`  |
| `order`   | `asc` or `desc`   | `asc`   |
| `limit`   | 1–500             | 100     |
| `offset`  | ≥ 0               | 0       |

`200 { items, total, limit, offset }`. Each item carries `logoUrl` and
`toolCount`, both aggregates of the one query, so the screen costs one
statement rather than two per row.

### `POST /api/brands` — `catalog.write`

`{ "name": "Makita", "notes": "", "color": "0 158 224" }` → `201 { brand }`.
`409` when the name is taken: "Bosch" and "BOSCH" typed on two days are the same
company, and two rows would split its tools in half.

`color` is the maker's leading colour and is optional. It arrives as
`#rrggbb`, as `rrggbb`, or as three numbers — `"18 36 71"`, `"18,36,71"`,
`"rgb(18, 36, 71)"` — because that is how a brand book gives it, and comes back
as lowercase `#rrggbb`, which CSS can use directly. One stored form means two
spellings of the same colour cannot both exist. Empty means nobody has said,
which is not the same as black. A channel outside 0–255, or anything that is
not a colour, is a `400` rather than a silently dropped field.

### `GET|PATCH|DELETE /api/brands/:id` — `catalog.read` / `catalog.write`

A `PATCH` takes `name`, `notes` and `color`. **Renaming rewrites the maker on
its tools** in the same transaction — the card carries the name as text, and
renaming one without the other leaves them telling different stories.

`DELETE` removes the row. The tools stay and keep the maker's name as text;
they simply stop pointing at it. Deleting the grouping is not a claim about who
made them.

### `PUT /api/brands/:id/logo` — `catalog.write`

`{ "photoId": 48 }` → `200 { brand }`. Setting it twice replaces it. `404` when
the picture does not exist, `409` when it is already another brand's logo — the
one-to-one rule refuses rather than moving it.

### `DELETE /api/brands/:id/logo` — `catalog.write`

`200 { brand }`, with `logoUrl: null`. The picture itself stays in the library.

## Organizer

Which tools live in which case. An organizer row is one arrangement: a case, a
name, and an ordinal **number** — the one painted on the box and said out loud,
deliberately not the id.

The rules, all of them in the database rather than in a handler:

- one case per organizer, and **a case may hold several organizers** (a toolbox
  with three drawers is three arrangements of the same box);
- **a tool is in at most one organizer**, by a unique index on the link table's
  `tool_id`;
- deleting a tool takes it out of its organizer and changes nothing else;
- deleting a case deletes its organizers — the arrangement has no meaning
  without the box, and the screen warns before it happens.

### `GET /api/organizers` — `catalog.read`

| Parameter | Meaning                                   | Default  |
| --------- | ----------------------------------------- | -------- |
| `q`       | Organizer name, description, or case name | —        |
| `caseId`  | Only the organizers of one case           | —        |
| `sort`    | `number` or `name`                        | `number` |
| `order`   | `asc` or `desc`                           | `asc`    |
| `limit`   | 1–200                                     | 50       |
| `offset`  | ≥ 0                                       | 0        |

`200 { items, total, limit, offset }`. Each item carries its case (with the
case's main photo) and every tool in it (each with its own), so the list screen
can draw a tile per organizer without a request per row.

`caseId` is what a case's delete confirmation asks with.

### `POST /api/organizers` — `catalog.write`

```json
{ "name": "Wiertarki", "caseId": 2, "description": "", "toolIds": [7, 9] }
```

`name` and `caseId` are required; `toolIds` is optional, because the wizard
lets somebody set a case aside before deciding what goes in it. `number` may be
given, and when it is not the server takes the next free one — inside the same
transaction, so two people creating at once cannot both read the same maximum.

`201 { organizer }`. `409` when the number is taken or one of the tools is
already in another organizer — moving a tool out of somebody else's
arrangement is a decision, not something to do silently. `404` when the case
does not exist.

### `GET|PATCH|DELETE /api/organizers/:id` — `catalog.read` / `catalog.write`

A `PATCH` takes any of `name`, `description`, `number`, `caseId`. `caseId`
cannot be cleared: an arrangement of nothing is not an arrangement.

`DELETE` removes the arrangement only. The tools and the case stay; they simply
stop being connected.

### `POST /api/organizers/:id/tools` — `catalog.write`

```json
{ "toolIds": [7, 9] }
```

`200 { organizer }`, or `409` if one of them is already somewhere else.

### `DELETE /api/organizers/:id/tools/:toolId` — `catalog.write`

Takes one tool out. `200 { ok: true }`, or `404` if it was not in there.

## Labels

A label is a PDF: one page exactly the size of the sticker, with a hairline
outline to cut along. It is generated once and kept — the options it was drawn
from are stored beside it, so the same label can be drawn again, but nothing
edits a label in place.

Sizes come from the **case**, never from the request: an organizer's case lists
where labels go (`case_label_slot`), and a size that is not one of them is a
`400`. A label nobody can stick anywhere is not worth printing.

### `GET /api/organizers/:id/label-slots` — `catalog.read`

`200 { slots: [{ id, widthMm, heightMm }] }` — what the wizard may offer. Empty
when the case has no places recorded yet.

### `POST /api/organizers/:id/labels` — `catalog.write`

```json
{ "slotId": 4, "template": "number", "withLogos": true, "printReady": true }
```

```json
{
  "slotId": 4,
  "template": "contents",
  "photoIds": [75, 79],
  "withTitle": true,
  "titleText": "",
  "withNames": true,
  "namesSource": "models",
  "namesText": ""
}
```

`201 { organizer }` — the whole organizer, labels included, so a screen does
not have to merge one into a list it already holds.

**`number`** follows the stickers already on the shelf: a rounded rectangle in
the maker's colour, the ordinal number as large as the label allows, and the
maker under it. Two makers split the label diagonally with a light seam — Bosch
navy against Bosch green is a contrast of about 1.5:1 and the boundary
disappears in print without it — and three or more share the bottom in bands.

`withLogos` swaps each maker's **name for its logo**, one or the other and
never both: a mark reading "Bosch Professional" above the words "Bosch
Professional" says nothing twice and takes the room from the number. A maker
with no logo falls back to its name.

The arrangement follows the shape: past twice as wide as it is tall — a lid —
the number and the maker stand side by side instead of stacked, because a
number a fifth of the height of a 200 mm label is a number nobody reads.

**`contents`** is a white card in a navy frame: up to three pictures of the
tools filling the top, the organizer's name under them, a rule, and the tool
names in caps along the bottom — the same drawing as the Qbrick tool stickers,
so a label from here sits on the shelf next to one from there. Both lines of
type are options; a card with neither is the pictures alone. The arrangement of
the pictures is chosen, not fixed: every split into rows and columns is
measured and the one that draws them largest wins, because a row that suits a
200 × 60 lid is hopeless on a 30 × 40 front. Names that do not fit shrink, and
then the tail becomes "+N więcej".

`withTitle` and `withNames` say whether each line is there at all.

`namesSource` says where the line under the rule comes from: `tools` (the tool
names, the default), `models` (their model numbers) or `text` (`namesText`).
The models are what is written on the machine and what a spare belt is ordered
by — "POF 1200 F5" identifies a box more sharply than "Frezarka
górnowrzecionowa", which is a category. Duplicates are dropped and a tool with
no model recorded is skipped. An unknown value is treated as `tools` rather
than refused, because the same field is read back out of jsonb on a redraw and
a row can hold anything; below it, the answer picks a column name.

Omitting `namesSource` means the old rule — a `namesText` is a typed line, its
absence is the tool names — which is what labels made before the choice
existed still mean when they are drawn again.

`titleText` is the line over the rule: **empty means work it out** — the
organizer's name — and anything else is printed instead of what the catalog
thinks. The same convention as
`brand.color`, where empty is the absence of a value rather than a value. It
matters because a person knows things the catalog does not: "18 V + 12 V,
LI-ION" says more about a box of batteries than five product names would. At
most 120 characters each; past that a 30 mm label can only shrink the type
until nobody can read it, so it is a `400`.

A typed line cannot be shortened by dropping a name from it the way a list can,
so one too long for the band is cut and ends in an ellipsis.

`photoIds` must belong to tools in this organizer — checked in the database,
not trusted from the request. **How many fit depends on the shape**: a label at
least twice as wide as it is tall takes six, anything else three, because six
across a 200 × 60 lid still come out bigger than three down a 30 × 40 front.
More than that is a `400` naming the size rather than a silent truncation — a
label quietly missing its sixth picture is one somebody prints before noticing.

**`printReady`** decides what kind of file comes out, and defaults to `true`
because a label is made to be printed.

- `true`: the artwork on a page 6 mm larger on every side, with crop marks in
  the corners, a cut line along the label itself, and a measured bar with its
  length written next to it. Printers scale to fit by default and a sticker
  printed at 96% fits nothing — measuring that bar is how somebody finds out
  before cutting fifteen labels rather than after.
- `false`: the page is exactly the label and carries no lines at all. The right
  thing to embed or look at.

The marks are added around the finished artwork, never into it: a crop mark
printed on a sticker is a crop mark stuck to a toolbox.

Every label also gets a **preview**: a PNG of the first page, 480 px on its
long side, rendered from the finished PDF when the label is made. It is what
the tile in the list shows, so twenty labels are twenty pictures rather than
twenty PDF viewers. `previewUrl` on the label is `null` when there is none —
a label made before previews existed, or one the rasteriser could not read —
and the list has to cope with that rather than assume.

### `POST /api/organizers/:id/labels/refresh` — `catalog.write`

```json
{ "labelIds": [14, 16] }
```

`200 { organizer, refreshed, failed: [{ id, error }] }` — draws the chosen
labels again from the options they were kept with. The row keeps its id, its
size and its options; only the file underneath changes. That is what the stored
options are for: a label made before a tool was added, or before a maker got
its logo, becomes current without anybody retyping the wizard.

The size comes off the label rather than the slot, so a label whose slot has
since been taken off the case still redraws at the size it was printed at.

One label that cannot be drawn does not stop the others — a contents label
whose photos have been deleted comes back in `failed`, named, while the rest
are brought up to date. Fifty at a time at most.

### `GET /api/organizers/:id/labels/:labelId/file` — `catalog.read`

The PDF, `application/pdf`, `inline`.

### `GET /api/organizers/:id/labels/:labelId/preview` — `catalog.read`

The PNG, `image/png`. `404` when the label has no preview.

Both files are served immutable and cached for a year, and a label keeps its id
when it is drawn again — so `url` and `previewUrl` carry a `?v=` taken from the
checksum the file is named after. Use the URLs as they come back; building
either one by hand hands somebody last week's label.

### `DELETE /api/organizers/:id/labels/:labelId` — `catalog.write`

`200 { organizer }`. The file goes too, unless another label is byte-identical
and still points at it — labels are content addressed like photos.

### `GET /api/labels` — `catalog.read`

Every label there is, whichever organizer made it. A separate surface from the
routes above for the same reason the photo library sits next to the per-card
gallery: those answer "what has this arrangement produced", this one answers
"what have we printed", which is the question after a box changed and a shelf
of stickers went stale.

| Parameter     | Meaning                                           | Default |
| ------------- | ------------------------------------------------- | ------- |
| `q`           | Organizer name, its description, or the case name | —       |
| `template`    | `number` or `contents`                            | —       |
| `organizerId` | Only the labels of one arrangement                | —       |
| `order`       | `asc` or `desc` by the time the label was drawn   | `desc`  |
| `limit`       | 1–200                                             | 48      |
| `offset`      | ≥ 0                                               | 0       |

`200 { items, total, limit, offset }`. A label has no name of its own, so `q`
matches the arrangement and the box — the same words the organizer list
matches — and every item carries both:

```json
{
  "id": 9,
  "template": "contents",
  "widthMm": 30,
  "heightMm": 40,
  "byteSize": 42130,
  "options": { "printReady": true, "withNames": true },
  "organizer": { "id": 4, "number": 4, "name": "Wiertarki" },
  "case": { "id": 2, "name": "Skrzynka 4", "manufacturer": "Qbrick" },
  "url": "/api/organizers/4/labels/9/file?v=ab12cd34ef56",
  "previewUrl": "/api/organizers/4/labels/9/preview?v=ab12cd34ef56",
  "createdAt": "2026-09-12T08:00:00.000Z",
  "createdBy": 1
}
```

The two file URLs are the ones under the organizer, versioned the same way:
there is one PDF per label, and this list points at it rather than serving a
second copy of it.

### `POST /api/labels/refresh` — `catalog.write`

```json
{ "labelIds": [14, 27, 31] }
```

`200 { refreshed, failed: [{ id, error }] }` — the same redraw as
`POST /api/organizers/:id/labels/refresh`, over a selection that spans
organizers. Fifty at a time at most, and a label that cannot be drawn comes
back in `failed` rather than failing the call.

There is no `organizer` in the answer, because there is no single one: the
screen re-reads the list. `404` when none of the ids is a label — an empty
selection is a `400` from the parser.

## The photo library

The same photos seen from the other side: everything on disk, across all
tools. A separate surface from `/api/tools/:id/photos` because it answers a
different question — what did we import — and it exists for the cleanup after
a batch that pulled in the wrong pictures.

### `GET /api/photos` — `catalog.read`

| Parameter  | Meaning                                                                   | Default |
| ---------- | ------------------------------------------------------------------------- | ------- |
| `q`        | Matches the **tool** — name, brand, model. A photo has no name of its own | —       |
| `source`   | `upload`, `url`, `search` or `edit`                                       | —       |
| `assigned` | `true` for photos that belong to a tool, `false` for those still waiting  | both    |
| `order`    | `asc` or `desc` by upload time                                            | `desc`  |
| `limit`    | 1–200                                                                     | 48      |
| `offset`   | ≥ 0                                                                       | 0       |

```json
{
  "items": [
    {
      "id": 5,
      "url": "…",
      "owners": [
        { "kind": "tool", "id": 9, "name": "Szlifierka kątowa", "isPrimary": true },
        { "kind": "case", "id": 2, "name": "Toolbox 2.0", "isPrimary": false }
      ]
    }
  ],
  "total": 128,
  "limit": 48,
  "offset": 0
}
```

Each entry is the picture plus `owners`: every card showing it, as
`{ kind, id, name, isPrimary }`. The array is empty for a picture nobody has
placed yet, which is reached through `url` — `/api/photos/:id/file` — because
there is no card to reach it through.

It also carries `logoForBrand`: `{ id, name }` when the picture is a maker's
logo, null otherwise. A logo is **not** an owner — it is not on a card, cannot
be attached through the photo routes, and does not make the picture count as
assigned by the `assigned` filter. It is, however, what a delete would quietly
take away, so a screen that offers to delete has to be able to say so.

A picture appears **once** here however many cards use it. That is the
difference from the per-card routes: this screen is about what is on our disk,
and one photograph is one thing on the disk.

### `POST /api/photos` — `catalog.write`

An upload that belongs to nothing, in either of two shapes.

**The raw file as the body**, like the per-card upload, converted to PNG the
same way. `201 { photo }` with no `owners`.

**`{ "url": "https://…" }`** when the body is JSON: the server fetches it
instead, through the same guards — the address is checked before anything is
opened, the bytes decide what the file really is, and whatever it turns out to
be is stored as PNG. A bad address, a page that is not an image or something
too large is a `422` about what was asked for. A logo or a manual is as likely
to be a link somebody has as a file on their phone.

Both answer `{ created, photo }`. `created` is false — and the status `200`
rather than `201` — when those bytes were already here: the picture comes back
either way, because it is the same photograph, but a screen should not claim to
have added a row it did not add.

Pictures arrive before anyone decides what they are: a batch off a phone at the
end of a day, something found while looking for something else. Forcing a card
at that moment is how photos end up on the wrong one.

Bytes already on the server answer with the picture that is there rather than a
409: it is the same photograph, and refusing would only make the client ask what
to do about a fact nobody can change.

### `GET /api/photos/:id/file` — `catalog.read`

The bytes of any photo, by its own id. The per-card paths still serve the same
file; this one is what a photo with no card can be reached through at all.

### `POST /api/photos/delete` — `catalog.write`

```json
{ "ids": [4, 5, 6] }
```

Up to 200 at a time. `200 { deleted, requested, promoted }`.

`deleted` can be lower than `requested`: someone else may have removed a photo
between the screen loading and the button being pressed. `promoted` lists the
cards whose main photo was among them and which now show a different one, each
as `{ kind, id }` — the same promotion a single delete does, applied per card.
The kind is part of it because tool 4 and case 4 are different cards that
happen to share a number.

A `POST` rather than `DELETE` with a body: a body on `DELETE` is legal but not
universally carried by proxies, and this is a form submission with a list in
it.

## Users — `users.manage`

### `GET /api/users`

`{ "users": [{ ...user, "capabilities": ["catalog.read"] }] }`.

### `PATCH /api/users/:id`

```json
{ "role": "editor", "status": "active", "displayName": "Ola" }
```

The email is not editable: it is the login identity and the unique key.
Two refusals protect the installation rather than the data:

- `403` changing your own role or status — ask another admin.
- `409` demoting or disabling the last active admin.

Disabling an account also ends its open sessions.

### `DELETE /api/users/:id`

`200 { "ok": true }`. `403` on your own account, `409` on the last active
admin. Tool cards the account created stay, with `createdBy` set to `null`.

## Service

- `GET /healthz` — liveness only, never touches Postgres.
- `GET /api/version` — `{ version, commit, startedAt }`.
