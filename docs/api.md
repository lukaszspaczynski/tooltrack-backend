# ToolTrack API

Every response is JSON. A session is one thing presented two ways: a browser
gets the `tooltrack_session` cookie from register or login and sends it back by
itself, and a client without a cookie jar asks `POST /api/auth/token` and sends
`Authorization: Bearer <token>`. Same session either way — same expiry, same
revocation — and the header wins when both arrive.

The expiry **slides**: every call pushes it out again, up to a ceiling counted
from the day the session was issued. An app in daily use is not signed out on a
schedule.

Access is enforced centrally in `src/access/route-policy.ts`, before any
handler runs. The refusals mean different things and a client acts on them
differently:

| Status | Meaning                                                 | What the client should do                       |
| ------ | ------------------------------------------------------- | ----------------------------------------------- |
| `401`  | No session, or it expired                               | Send the user to the login screen               |
| `403`  | Signed in, not allowed                                  | Say so; an admin has to grant the role          |
| `409`  | Conflict (duplicate email or serial number, last admin) | Show `error`                                    |
| `426`  | This build of the client is too old                     | Tell the user to update; `minimum` says to what |
| `429`  | Too many failed sign-ins                                | Wait `Retry-After` seconds                      |
| `503`  | Database unavailable                                    | Retry; the request itself was fine              |

## Language

A signed-in account remembers which language it reads in — `user.language` on
every session answer, changed with `PATCH /api/auth/language`. That is what the
web client restores on another device; `Accept-Language` is still what decides
a given answer, because it says what the client is showing right now.

`Accept-Language` decides what language the `error` of a failed call is written
in — `pl` and `en`, Polish for anything else and Polish when the header is
absent. It applies to the messages a person reads. The refusals a client acts
on rather than displays (`Unauthorized`, `Not found`, `Method not allowed`,
`Expected a JSON object`) are English whatever is asked for, and so is the text
drawn onto the label PDFs, which are printed and cut out in one workshop.

```
GET /api/labels/sheet?ids=1,2,3
Accept-Language: en

400 { "code": "INVALID_QUERY", "error": "At most 200 labels at a time" }
```

## Failures

Every failed call answers with the same two fields, and they have two different
jobs.

```json
{ "code": "SERIAL_NUMBER_TAKEN", "error": "Serial number 3AB77 is already on another item" }
```

`error` is prose for a person, in whatever language the request asked for. **Do
not branch on it.** It is reworded when somebody finds a better sentence, and it
is Polish or English depending on a header.

`code` is the stable name of the failure. It is never translated and never
reworded, and it is the same whichever route produced it — a client that handles
`SERIAL_NUMBER_TAKEN` once handles it on the create and on the edit alike. The
status stays the right thing to branch on for the coarse decision (retry, log
in, give up); `code` is what tells four different 409s apart without reading
Polish.

The whole list is `src/server/error-codes.ts`, and the OpenAPI document
enumerates it — every value, with a sentence about each, under
`components.schemas.Error`. A code the server can return and the contract does
not mention is impossible: the enum is read from that file rather than copied,
so adding one changes the document and `npm run lint` fails until it is rebuilt.

Some failures carry more beside the two fields. A photo or manual import that
could not fetch anything answers with `failed`, one entry per address; a
suggestion route answers with `providers`. Those are additions, never
replacements — `code` and `error` are always there.

## Roles

| Capability                                                  | viewer | editor | admin |
| ----------------------------------------------------------- | :----: | :----: | :---: |
| `catalog.read` — browse and search the catalog              |   ●    |   ●    |   ●   |
| `catalog.write` — add, edit, delete items, cases and photos |        |   ●    |   ●   |
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

Failures are counted per address and per e-mail. Over either limit the answer
is `429` with `Retry-After`, before the password is looked at, and the same
`429` whether or not an account by that name exists.

### `POST /api/auth/token`

```json
{ "email": "ola@example.com", "password": "sekret1234", "device": "Pixel 8 — Ola" }
```

The same door as `login`, for a client with no cookie jar worth relying on — a
native app. It answers with the token itself and **sets no cookie**:

```json
{ "token": "…", "expiresAt": "2026-10-14T18:22:41.000Z", "user": {}, "capabilities": [] }
```

Send it back as `Authorization: Bearer <token>` on every call. The header wins
over a cookie when both are present.

Two doors, one session: the same row in `account.session`, the same expiry, the
same revocation. Which means `login` deliberately does **not** answer with a
token — a token in a response body is one any script on the page can read, and
that is exactly what the `HttpOnly` cookie exists to prevent. A browser has a
page and scripts on it; a native client has neither.

`device` is optional, free text, and a label only. It is what the session list
below shows and it is never read while authenticating.

Same `401`, same `429`, same counter as `login`: a throttle guarding one of two
doors into the same house is one somebody walks around.

### `GET /api/auth/sessions`

`200 { sessions: [{ id, device, createdAt, lastSeenAt, expiresAt, current }] }` —
where this account is signed in, newest use first, with the session asking
marked `current`. This account's own only; expired rows are left out.

### `DELETE /api/auth/sessions/:id`

`204`, or `404` when the session is not this account's — the same answer as one
that never existed, so other people's ids cannot be found by trying. Revoking
the session making the request is allowed: the answer goes out and the next
call with that token is a `401`, which is logging out the long way round.

### `PATCH /api/auth/language`

`{ "language": "en" }` — which language this account reads the interface in,
`pl` or `en`. Answers `200 { user, capabilities, effectiveRole }`, the same
shape as `/api/auth/me`, because the user being shown has just changed. `401`
without a session, `400` for a language this API does not speak. The open
sessions are left alone: reading in English is not a security event the way a
password change is.

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

## Items

The catalog holds what somebody owns. That began as tools and is not only tools
any more: a drill and a washing machine want the same card — a name, a maker, a
model, a serial number, a condition, photographs, a manual, a spec sheet, an
address and the page it was imported from — so they are one table and `kind`
says which sort each row is.

| `kind`      | what it is                                          |
| ----------- | --------------------------------------------------- |
| `tool`      | the default, and what everything in a tool shed is  |
| `appliance` | the washing machine, the fridge, the television     |
| `case`      | reserved; the boxes are still their own thing today |

Only a **tool** goes in an organizer, and the database is what refuses the
rest: `409 ITEM_IS_NOT_A_TOOL` on the way in, and `409 ITEM_IN_ORGANIZER` when
something already in a drawer is asked to stop being a tool. Take it out first.

The **maker** is the row it is, not a string beside a pointer at one:

```json
"brand": { "id": 4, "name": "Bosch Professional", "color": "#122447" }
```

`null` when nobody has said, which is normal — most hand tools have no maker
worth recording. Writing it is `brandId`, and an id that names no maker is a
`404 BRAND_NOT_FOUND` rather than a card quietly pointing at nothing. It used
to be both a `brand` string and a `brand_id`, kept in step by three separate
mechanisms; the colour arriving for free is what the string could never do.

### `GET /api/items` — `catalog.read`

Query parameters, all optional:

| Name          | Meaning                                                                     | Default     |
| ------------- | --------------------------------------------------------------------------- | ----------- |
| `q`           | Substring match over name, brand, model, serial number, category and notes  | —           |
| `category`    | Exact category, case-insensitive                                            | —           |
| `condition`   | One of `new`, `good`, `worn`, `needs_repair`, `retired`                     | —           |
| `inOrganizer` | `false` for items in no organizer — what the organizer wizard offers        | —           |
| `kind`        | `tool`, `appliance` or `case` — the boxes screen asks for `case`            | —           |
| `model`       | Exact model, as the cards spell it                                          | —           |
| `attributes`  | `1` to carry every card's spec sheet; off, because a grid does not show one | —           |
| `sort`        | `updatedAt`, `createdAt` or `name`                                          | `updatedAt` |
| `order`       | `asc` or `desc`                                                             | `desc`      |
| `limit`       | 1–200                                                                       | 50          |
| `offset`      | ≥ 0                                                                         | 0           |

```json
{ "items": [/* items */], "total": 128, "limit": 50, "offset": 0 }
```

Each item is an item plus two things the grid needs and would otherwise ask for
per card: `primaryPhotoUrl`, and `organizer` — where the item lies.

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

`null` for an item nobody has put anywhere. Both are one query for the whole
page, so a screen of items costs three statements rather than one per row.

A malformed `limit`, `offset` or `sort` is clamped or ignored rather than
refused — a pasted link should still show the catalog. An unknown `condition`
is a `400`, because silently listing everything would look like an answer.

### `GET /api/items/categories` — `catalog.read`

`{ "categories": [{ "category": "Wiertarki", "count": 12 }] }`, read from the
items themselves. That is the list to offer in a filter.

### `GET /api/items/attributes` — `catalog.read`

`{ "names": [{ "name": "Napięcie sieciowe", "count": 12 }] }`, most used first.
What the form offers while somebody types a parameter name, read from the items
themselves like the category list above — the names in use are the vocabulary,
and one typed the same way on every card is what makes the catalog answerable
later. Names that differ only in case or spacing count as one.

### `GET /api/docs` — public

Swagger UI, pointed at the document below. Vendored rather than loaded from a
CDN, for the same reason the label fonts and the one CA certificate are: a page
that needs the public internet to render does not render on a site that has
none, and an authenticated screen pulling a megabyte of JavaScript off
somebody else's host is a supply chain nobody chose. Two files come with it,
under `GET /api/docs/:asset`, from an allowlist of two names.

**"Try it out" works.** The page is served from this API's own origin, so the
session cookie is first-party and the browser attaches it — log in through the
app in another tab and the calls on this page run as that account. That is why
it is a route here rather than a static site somewhere else: on its own origin
it would be a CORS and cookie problem for the one feature worth having.

- `GET /api/docs/:asset` — the two files the page loads, by name.

`docs/api.http` is still the better item for a sequence of calls, because it
keeps the session and the variables between them. This is the better one for
reading.

### `GET /api/openapi.json` — public

The OpenAPI 3.1 description of everything below, served by the API it
describes, so a client generates itself against the instance it is talking to
rather than against a file checked in beside it. Public for the same reason
`/healthz` is: a client that has not logged in yet cannot be asked to
authenticate before it may find out how.

It is built by `npm run openapi:build` into `docs/openapi.json` and committed;
`npm run lint` fails when what is committed is out of date. The entity schemas
in it are generated from the TypeScript types the handlers actually return, and
the `security` of each operation is read from `src/access/route-policy.ts` by
calling it — neither is transcribed, so neither can drift from the server.

This file stays the one to read. The spec says what the shapes are; the prose
here says why they are that shape, which is the half no generator can produce.
Coverage is partial and deliberately so: `src/openapi/operations.ts` keeps a
`PENDING` list of routes not yet described, and a test asserts that every route
is in exactly one of the two lists, so a gap is visible rather than silent.

### `GET /api/items/import/sources` — `catalog.read`

```json
{
  "sources": [
    { "host": "mistama.com", "label": "mistama.com", "manuals": false },
    { "host": "bosch-diy.com", "label": "bosch-diy.com", "manuals": true },
    { "host": "bosch-professional.com", "label": "bosch-professional.com", "manuals": true },
    { "host": "skileurope.com", "label": "skileurope.com", "manuals": true },
    { "host": "stanleyworks.pl", "label": "stanleyworks.pl", "manuals": false },
    { "host": "lidl.pl", "label": "lidl.pl", "manuals": true },
    { "host": "nac.com.pl", "label": "nac.com.pl", "manuals": true },
    { "host": "gardena.com", "label": "gardena.com", "manuals": false },
    { "host": "qbricksystem.com", "label": "qbricksystem.com", "manuals": false },
    { "host": "ceneo.pl", "label": "ceneo.pl", "manuals": false }
  ]
}
```

The pages this server can read — two shops, seven makers' own sites and one
price comparison site. One
list, including the one that sells boxes: it used to be two registries under
two routes, because a case was a table of its own and the scripts answered
different shapes. They answer the same shape now, and **which sort of card a
page describes is the page's own answer** rather than a question the dialog
has to ask. The address is remembered without its analytics tail:
`?_gl=…` and `utm_*` say nothing about the product.
`manuals` says whether that page publishes documents at all: a shop sells the
item and leaves the manual to the maker, so a screen asking for one offers only
the sources that have any. The import dialog lists them before asking for an address,
so it never offers a source this installation does not have.

### `POST /api/items/import` — `catalog.write`

`{ "url": "https://mistama.com/…" }` — a product page, read into a card.

`201 { item, imported }`, where `imported` is what came with it:

```json
{
  "imported": {
    "photos": 16,
    "photosFailed": 0,
    "attributes": 12,
    "attributesFailed": [],
    "manuals": 0,
    "manualsFailed": 0,
    "sourceUrl": "https://mistama.com/…"
  }
}
```

Every imported card gets a **`referenceUrl`** holding the address it was read
from, so what the import said can be checked against what the page says today.
It is a field on the card rather than a line on its spec sheet: every imported
card has exactly one and no card has two, which is the shape of a column — and
on the sheet it sorted among the voltages, where anybody editing a row could
rename the thing three screens read.

The manuals come too, at most 8 of them, where the page publishes any — most
shops publish none. They go through the same path as
`POST /api/items/:id/manuals`, so a PDF that will not download is reported
rather than failing the card.

The **kind** comes from the importer, because the page is where the answer is:
qbricksystem.com sells boxes and nothing else, so a card imported from it
arrives as `kind: "case"` and a card imported from a tool shop as
`kind: "tool"`. ceneo.pl lists all three, so its importer reads the kind off the
path the site files the page under: tools, the workshop and the garden are
`tool`, boxes are `case`, and everything else it lists — the washing machine,
the coffee machine, the television — is `appliance`. That is where an
appliance card comes from now; before it, one was a tool card somebody changed
the kind of afterwards.

The card is created with `condition: "new"` and **no serial number** — that
identifies one physical machine, and the page describes a model. Parameters and
photographs are added after it, and neither failing loses the card: what could
not be read is reported beside it rather than instead of it. At most 20 photos.

`400` when the address is missing or belongs to a shop this server cannot read —
the message names the ones it can. `422` when the page could not be fetched, or
when there is no product on it. Expect the call to take around ten seconds for a
gallery of a dozen photographs: each one is fetched, converted and stored.

### `POST /api/items/:id/import` — `catalog.write`

`{ "url": "https://…" }` — reading the page again into a card that exists.
Answers like the import above: `200 { item, imported }`.

What the page knows, it **overwrites**: the maker, the model, the category, the
description, the whole spec sheet and the documents. What it cannot know, it
leaves alone: the **name** somebody gave this card, the **serial number** of
this particular machine, its **condition**, the **kind** — a card in an
organizer or carrying label slots cannot change it, and a page is not worth
undoing that for — and the **photographs**, which somebody may well have taken
themselves. `imported.photos` is therefore always
0 here, which is a statement rather than an omission.

Parameters and manuals are **cleared and written again** rather than merged. A
page is the source of truth for what a machine is, so a parameter the maker has
dropped should leave the card; keeping the old rows and adding to them would
preserve exactly the ones that are wrong. A parameter typed in by hand goes the
same way — the dialog says so before it happens.

Same refusals as the import: `400` for an address this server cannot read,
`422` when the page cannot be fetched or holds no product. None of them touch
the card.

### `POST /api/items` — `catalog.write`

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
`good`. `201 { item }`. `409` if another card already claims that serial
number (blank serial numbers are exempt).

### `GET /api/items/:id` — `catalog.read`

`200 { item }` or `404`. A single item carries `attributes` as well — what this
particular machine is — which the list deliberately does not:

```json
{
  "attributes": [
    { "id": 5, "name": "Napięcie sieciowe", "value": "230 V" },
    { "id": 6, "name": "Prędkość obrotowa", "value": "300 obr./min" }
  ]
}
```

In the order they were typed, which is the order a spec sheet is copied in. A
grid of cards shows a name, a maker and a condition, so sending every card's
parameters to draw it would be paying for what nobody reads — every **single**
item answer carries them, including `POST /api/items` (empty) and a duplicate.

### `PATCH /api/items/:id` — `catalog.write`

Send only what changes. `""` clears a field; omitting it leaves it alone. The
name cannot be cleared. `200 { item }`, `404`, or `409` on a duplicate serial.

### `POST /api/items/:id/duplicate` — `catalog.write`

Another card just like this one. `201 { item }`.

Everything is copied except the **serial number**, which starts blank: it
identifies one physical machine, and the unique index would refuse a second
card claiming it. Which is the point — a crew with three identical grinders
wants three cards, and the difference between them is the number on the plate.

The photos come along as links to the same pictures, main photo included. Two
of the same model look the same, and since the pairing is a row this costs a
row rather than a second file.

### `DELETE /api/items/:id` — `catalog.write`

`200 { "ok": true }` or `404` if it was already gone.

The photographs go with it — but only the ones nothing else holds. One that
another card shows, or that is a maker's logo, stays. `GET .../photos?exclusive=1`
answers which those are, which is what the delete confirmation counts before
asking.

### The item object

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

### `GET /api/items/:id/manuals` — `catalog.read`

`200 { manuals }` — the PDFs kept beside this item, oldest attachment first.
Each carries `title`, `byteSize`, `source` (`upload` \| `url` \| `import`),
`sourceUrl`, `createdBy`, `createdAt` and a `url` to read it at.

### `POST /api/items/:id/manuals` — `catalog.write`

Two request shapes on one route.

**The bytes.** `content-type: application/pdf` with the file as the body, and
`?name=` carrying the file name so the card can call it something before
anybody types a title.

**An address.** `{ "url": "https://…/instrukcja.pdf", "title"? }` — fetched
under the same rules a photo URL is: no local network, no redirect into one, a
timeout, and a ceiling of 40 MB read as the bytes arrive.

`201 { manual }`. `415` when the bytes are not a PDF — the header and the
extension are both claims, and an error page served under a `.pdf` address is
the common one this catches. `409` when this card already keeps that exact
file: the checksum is the identity, so the same document from two directions is
one row.

### `POST /api/items/:id/manuals/from-page` — `catalog.write`

`{ "url": "https://…" }` — every manual a product page publishes, at most 8.
Read by the same importers as `POST /api/items/import`, so an address from a
page this server cannot read is refused in the same words.

`201 { manuals, failed }` — one document that will not download does not lose
the others. `422` when the page publishes none.

`400` for an address this server cannot read **and** for one it can read but
that publishes no documents — `mistama.com` is refused here by name rather than
fetched and then reported empty, since that round trip helps nobody.

### `PATCH /api/items/:id/manuals/:manualId` — `catalog.write`

`{ "title": "Instrukcja obsługi" }` → `200 { manual }`. Blank is a `400`:
"instrukcja_pl_v2_final" is a poor title and an empty one is not a title.

### `DELETE /api/items/:id/manuals/:manualId` — `catalog.write`

`200 { "ok": true }`. Takes the manual off **this** card; the document itself
goes when no card keeps it any more.

### `GET /api/manuals` — `catalog.read`

The library: every manual there is, whichever item keeps it. `?q=` matches the
title **and** the items it belongs to — a document called "Instrukcja obsługi"
is findable only by the machine it is for. `?limit=` 1–200 (24), `?offset=`.

`200 { items, total, limit, offset }`, newest first. Each item is a manual plus
`items: [{ id, name }]` — the cards that keep it, which is the question this
screen exists to answer, and one query rather than one per row.

### `PATCH /api/manuals/:id` — `catalog.write`

`{ "title": "…" }` → `200 { manual }`. Renaming from the library, where the
document is not being looked at through any one card.

### `POST /api/manuals/delete` — `catalog.write`

`{ "ids": [1, 2] }`, at most 50 → `200 { deleted, items }`. Off every card at
once and off the disk. A different decision from
`DELETE /api/items/:id/manuals/:manualId`, which takes one off **one** card and
leaves the file where another card still keeps it. `items` names the cards that
lost something, so the screen can say so.

### `POST /api/items/:id/manuals/attach` — `catalog.write`

`{ "ids": [1, 2] }` → `201 { attached, manuals }`. Documents the catalog
already has, put onto another card: one manual, several machines.

### `GET /api/manuals/:id/file` — `catalog.read`

The PDF, `inline`. By the manual's own id rather than through a card, because
several cards share one document and none of them owns it.

### `POST /api/items/:id/attributes` — `catalog.write`

`{ "name": "Napięcie sieciowe", "value": "230 V" }` — one parameter of this
item. Both halves are required and neither may be blank: a parameter with no
name says nothing, and one with no value is a question rather than an answer.
The value carries its unit (`"230 V"`, not `230`), because half of these have
no unit anybody agrees on and a number without one cannot be read.

`201 { item }` — the whole card, so a screen showing the list does not have to
merge one row into a list it already holds, the same as a case answering with
itself when a label slot is added. `404` when there is no such item, `409` when
this card already lists that parameter: the second "napięcie" is somebody
correcting the first, not a second fact about the machine. Names are compared
trimmed, case-folded and with runs of spaces collapsed.

### `PATCH /api/items/:id/attributes/:attributeId` — `catalog.write`

`{ "name"?, "value"? }` — send either half or both; sending neither is a `400`
rather than an answer with the row unchanged, which would look like it saved.
`200 { item }`, `404` when the parameter is not this item's — which is the same
answer as one that never existed — and `409` on a name the card already lists.

### `DELETE /api/items/:id/attributes/:attributeId` — `catalog.write`

`200 { item }` or `404`. Deleting the last parameter leaves an empty list, not
a card without the field.

## Saying which build is calling

```
X-ToolTrack-Client: mobile/1.4.2
```

Optional, and every client that exists today sends nothing. Two things follow
from sending it.

Each build is **logged once**, the first time it calls. That is how this server
answers "is anybody still on the old version", which is what decides when a
deprecated field may finally be removed.

And when `TOOLTRACK_MIN_CLIENT` names a floor for that client, a build under it
gets **426 `CLIENT_TOO_OLD`** with `minimum` in the body — before
authenticating, so an app that cannot be answered is told to update rather than
sent to a login screen it will come back from and fail anyway. The `public`
routes never answer 426: `/healthz`, `/api/version` and this contract stay
reachable to any build.

A header this server cannot read is treated as absent, not as old.

## Cases

A case is the box the items live in, and it is **a card like any other**.
`catalog.tool_case` is gone and so is `/api/cases/*`: a box had a name, a
maker, a model, a note, the page it was read from and a spec sheet, which is
what a card is — so it is an item with `kind: "case"`, listed by
`GET /api/items?kind=case`, read by `GET /api/items/:id`, written by the same
POST and PATCH every other card is.

Two things are still only a box's, and both hang off the item routes:

- **label slots**, below — `POST /api/items/:id/label-slots`, refused with
  `409 ITEM_IS_NOT_A_CASE` on a drill;
- the **importer** that reads qbricksystem.com, which is now one of the ten
  sources `POST /api/items/import` accepts.

Everything a spec sheet states about a box is a **parameter**, not a column. A
case had eleven of those columns — three outside measurements, three inside, a
diagonal, a capacity, a load, a barcode, a catalogue number — and they were
columns because a box is mostly measurements, until the next kind of box states
something else and a twelfth column is a migration rather than a row. The sheet
already took a name and a value with its unit:

```json
"attributes": [
  { "id": 41, "name": "Długość zewnętrzna", "value": "450 mm" },
  { "id": 48, "name": "Pojemność", "value": "11 L" },
  { "id": 51, "name": "EAN", "value": "5901238254232" }
]
```

The unit travels in the value, as it does everywhere else. The order is the
order somebody reads a box in: outside, inside, diagonal, what goes in, what it
carries, then the numbers that identify the product.

The EAN and the SKU identify the product, not this box: two identical cases on
the shelf are two rows carrying the same barcode, so neither is unique. That is
the difference from an item's serial number, which is one machine.

`model` is what the maker calls this box, without the maker's own name in
front of it: "PRO Drawer 3 Toolbox 2.0 Expert". It was the range alone — "PRO"
— until that turned out to be a fact about nine boxes rather than about one:
every Qbrick in the workshop is a PRO, so a filter on it filtered nothing and a
label printed from it said nothing. It is the item's own `model` column, which
is why `GET /api/items/models?kind=case` is the filter a shelf of boxes is read
by.

### `GET /api/items/models` — `catalog.read`

`200 { models: [{ model, count }] }` — read from the cards themselves, the same
way the category list is. `?kind=` narrows it, and the boxes screen sends
`kind=case`: a workshop owns nine of the same Qbrick and one of everything
else, so the model is the filter that means something there.

### `POST /api/items/:id/label-slots` — `catalog.write`

Where a label goes on this case: `{ "widthMm": 30, "heightMm": 40 }`. Whole
millimetres, always width by height of the outline, and neither may be zero —
a label with no width is not a label.

`201 { item }` — the whole card, so a screen showing the slots together does
not have to merge one into a list it already holds.

`409 ITEM_IS_NOT_A_CASE` when the card is a tool or an appliance. That is a
constraint rather than a check: `case_label_slot` carries a `kind` fixed to
`'case'` and points at `(id, kind)` on the item, so the database refuses a
drill a place for a sticker — and refuses turning a box that has slots into
something else.

`409 LABEL_SLOT_TAKEN` when this case already has that size: the pair is the
key, and adding it twice is a mistake rather than a second place. The same size
on another case is fine, which is the point of a modular system.

### `DELETE /api/items/:id/label-slots/:slotId` — `catalog.write`

`200 { item }`, or `404` when this card has no such slot.

`labelSlots` is on every item detail answer and is `[]` for everything that is
not a case — which is what one card type costs, and all it costs.

## Photos

A card has any number of photos and at most one **main** photo — the one the
grid shows. The first photo added becomes the main one automatically, and
removing the main one promotes the oldest remaining attachment.

The bytes are always stored by this server. A URL or a search result is a
source, not a link the catalog keeps depending on: a page that disappears next
year must not empty the shed.

Everything in this section used to exist twice, under `/api/items/:id/…` and
under `/api/cases/:id/…`, because a case was a table of its own. One card, one
set of paths.

A **picture** and **a card showing a picture** are two different things. The
photo object is the picture: it has no owner and no `isPrimary`, because the
same photograph can illustrate several cards — an item and the case it lives
in, for one. The per-card routes add `isPrimary`, which
belongs to the pairing.

### `GET /api/items/:id/photos` — `catalog.read`

```json
{ "photos": [{ "id": 3, "url": "/api/items/7/photos/3/file", "isPrimary": true }] }
```

Main photo first, then in the order the pictures were attached to **this**
card. Each entry carries `isPrimary` and the picture's own `contentType`,
`byteSize`, `width`, `height`, `source` (`upload` \| `url` \| `search` \|
`edit`), `sourceUrl`, `attribution`, `derivedFrom`, `createdBy` and
`createdAt`.

`?exclusive=1` narrows the answer to the pictures this card is the only home
of — what deleting the card would take with it. Not the whole gallery: one that
another card shows, or that a maker uses as its logo, survives the card. This
is what the delete confirmation counts before asking.

### `POST /api/items/:id/photos` — `catalog.write`

Two request shapes on one endpoint.

**An uploaded file** — the raw bytes as the body, with the file's own type:

```
POST /api/items/7/photos
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

Refusals worth handling: `409` the same image is already on this item
(compared by checksum of the stored PNG, not by URL), `415` the file is not a
JPEG, PNG, GIF or WebP — decided by reading the file, not by trusting its
content type — and `413` above the size cap. An address pointing into a private network is
refused as a failed item, never fetched.

### `POST /api/items/:id/photos/attach` — `catalog.write`

```json
{ "photoIds": [24, 25] }
```

Puts photos that already exist on this item — the other half of being able to
upload a picture before deciding what it is. Two different things depending on
where the photo is now:

- **unattached** — it is _moved_: it keeps its id and leaves the unassigned
  shelf, which is what "assign" means to the person doing it;
- **on another item** — it is _copied_. The same picture can legitimately
  illustrate two items, and since files are addressed by checksum the copy is a
  row, not another megabyte.

`201 { photos, failed }`; one id that no longer exists does not lose the rest.
`409` when none of them could be attached — already on this card, or gone.

### `GET /api/items/:id/photos/:photoId/file` — `catalog.read`

The bytes, with `cache-control: private, immutable` and the checksum as `ETag`.
Use it directly as an `<img src>`.

### `PATCH /api/items/:id/photos/:photoId` — `catalog.write`

```json
{ "isPrimary": true }
```

The only edit a photo has. Everything else about it is a fact about the file.

### `DELETE /api/items/:id/photos/:photoId` — `catalog.write`

`200 { "ok": true }`. Takes the picture off **this** card. If no other card
shows it, the picture and its file go too — a bin on a card has to mean the
photograph is gone, not that it moved to a library nobody asked to fill.

Deleting a whole item or case does the same for everything it showed: its
pairings go with it, and the pictures no other card uses go with those.

### `POST /api/items/:id/photos/:photoId/cutout` — `catalog.write`

Take this photo and give back the thing in it without its background — without
the workbench, the case or the hands holding it. The screens call it "wycinanie
tła", which is what every service that does it calls it too: what the method
recognises is the background, not the drill.

`201 { photo, provider }`. It **adds** a photo rather than replacing one: the
original stays, the new one carries `source: "edit"` and `derivedFrom` with
the original's id, and it does not become the main photo on its own — whether
a cutout beats the photograph is a judgement for whoever sees both.

Three refusals, and they mean different things:

- `422` — the background of this photograph cannot be found. The default method
  needs a plain light one; a picture taken on a workbench has none. Try another
  photo, or point the server at an AI provider.
- `503` — the configured service is unavailable or the feature is switched off.
  Nothing to do with this photo.
- `409` — the result is byte-identical to a photo already on the card, which
  means its background was cut out once before. The local method is deterministic, so this
  is how a second press answers.

Takes seconds rather than milliseconds. Clients should show progress on the
photo it was started from.

### The cutout screen: `preview` → `commit`

One-click is not always what you want. These two split the same work so a
person can see the result before anything is written.

**`POST /api/items/:id/photos/:photoId/cutout/preview`** — `catalog.write`

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

#### The same screen for a picture on no card

**`POST /api/photos/:id/cutout/preview`**, **`GET /api/photos/:id/cutout/preview/:checksum`**
and **`POST /api/photos/:id/cutout/commit`** — `catalog.write` — are the same
three, addressed by the picture rather than by a card that shows it.

They exist because the first three cannot answer for a picture nobody has
placed: a **brand's logo**, which is on no card and never will be, and anything
still on the unassigned shelf. A logo is the picture most worth cutting a
background out of, so the wand in the library had one obvious thing it could
not do.

The body, the answer and every refusal are the same, with one difference:
`commit` here writes a picture of nothing in particular rather than one of a
card, so **there is no `409` about a card**. The same bytes twice is the same
row, the way a second upload of one file is.

### `GET /api/items/:id/photo-suggestions` — `catalog.write`

`?source=page` answers from the **product page this card was imported from**
instead of from the engines: the address is the card's `referenceUrl`, so it is
the one source that cannot come back with somebody else's machine.
`providers: ["page"]`, and each suggestion is attributed to the page's host.

`422` when the card has no such address, when this server cannot read that
page, or when the page cannot be fetched. Items only — a case is not imported
from anywhere.

Up to ten images found on the web for this item. `?q=` overrides the query,
which otherwise is the item's brand and model.

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
best engine here for an item it sells and useless for one it does not. Its
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

A brand is a maker: one row, many items. The logo is a picture from the same
library everything else draws from, linked one to one — a brand has at most one
logo, and a picture is the logo of at most one brand.

Items carry the maker twice on purpose, for now: `brand` is the text the card
shows and the catalog searches, `brandId` points at the row. Creating or
editing an item matches the typed name against the brands, case-insensitively,
and points the card at one when it recognises it — a name it does not know
points at nothing rather than inventing a brand from a typo.

### `GET /api/brands` — `catalog.read`

| Parameter | Meaning           | Default |
| --------- | ----------------- | ------- |
| `q`       | Name or notes     | —       |
| `sort`    | `name` or `items` | `name`  |
| `order`   | `asc` or `desc`   | `asc`   |
| `limit`   | 1–500             | 100     |
| `offset`  | ≥ 0               | 0       |

`200 { items, total, limit, offset }`. Each item carries `logoUrl` and
`itemCount`, both aggregates of the one query, so the screen costs one
statement rather than two per row.

### `POST /api/brands` — `catalog.write`

`{ "name": "Makita", "notes": "", "color": "0 158 224" }` → `201 { brand }`.
`409` when the name is taken: "Bosch" and "BOSCH" typed on two days are the same
company, and two rows would split its items in half.

`color` is the maker's leading colour and is optional. It arrives as
`#rrggbb`, as `rrggbb`, or as three numbers — `"18 36 71"`, `"18,36,71"`,
`"rgb(18, 36, 71)"` — because that is how a brand book gives it, and comes back
as lowercase `#rrggbb`, which CSS can use directly. One stored form means two
spellings of the same colour cannot both exist. Empty means nobody has said,
which is not the same as black. A channel outside 0–255, or anything that is
not a colour, is a `400` rather than a silently dropped field.

### `GET|PATCH|DELETE /api/brands/:id` — `catalog.read` / `catalog.write`

A `PATCH` takes `name`, `notes` and `color`. **Renaming touches nothing else**:
a card points at the maker and reads the name through a join, so the new name is
on every card that points here as soon as this answers. It used to rewrite the
name on each of them in the same transaction, because a card carried it as text
beside the pointer; collapsing the maker to `brand_id` is what took that away.

`DELETE` removes the row. The items stay and simply stop pointing at it —
`brand` reads `null` on them afterwards. Deleting the grouping is not a claim
about who made them.

### `PUT /api/brands/:id/logo` — `catalog.write`

`{ "photoId": 48 }` → `200 { brand }`. Setting it twice replaces it. `404` when
the picture does not exist, `409` when it is already another brand's logo — the
one-to-one rule refuses rather than moving it.

### `DELETE /api/brands/:id/logo` — `catalog.write`

`200 { brand }`, with `logoUrl: null`. The picture itself stays in the library.

## Addresses

Where the kit is: a workshop, a yard, a site, a van. A thing of its own rather
than a line typed on fifty cards — fifty spellings of "Budowa Mokotów" is a
catalog where "what is on the Mokotów site" cannot be asked.

Only `name` is required, and it is the part a picker shows: a crew says
"magazyn", not a postcode. The postal half — `street`, `building`, `unit`,
`postalCode`, `city` — is for when somebody has to drive there, and every field
of it is optional, because a yard on a site has a name and no street.

Every answer carries `itemCount` and `organizerCount`, on the list as well as
on one address. That is what makes the list readable and what a delete
confirmation has to say out loud.

### `GET /api/addresses` — `catalog.read`

| Parameter | Meaning                             | Default |
| --------- | ----------------------------------- | ------- |
| `q`       | Name, city, street, postcode, notes | —       |
| `sort`    | `name`, `city`, `items`             | `name`  |
| `order`   | `asc` or `desc`                     | `asc`   |
| `limit`   | 1–500                               | 100     |
| `offset`  | Records to skip                     | 0       |

`200 { items, total, limit, offset }`.

### `POST /api/addresses` — `catalog.write`

```json
{
  "name": "Magazyn",
  "street": "Puławska",
  "building": "12A",
  "unit": "3",
  "postalCode": "02-566",
  "city": "Warszawa",
  "color": "#d0392a",
  "notes": "Klucz u kierownika."
}
```

`201 { address }`. `409 ADDRESS_NAME_TAKEN` when a place is already called
that — folded and trimmed, so "Magazyn" and "magazyn " are one place.

### `GET /api/addresses/:id` — `catalog.read`

`200 { address }` or `404`.

### `PATCH /api/addresses/:id` — `catalog.write`

Any subset of the create body. `200 { address }`, `404`, `409`.

### `DELETE /api/addresses/:id` — `catalog.write`

`200 { ok: true, cleared: { items, organizers } }`.

The items and arrangements that were there **stay in the catalog** and stop
pointing at anything — closing a site must not take the kit with it. `cleared`
says how many lost their place, because "delete" on a list of places reads as
tidying up and forty cards quietly losing their location does not.

### Saying where something is

There is no endpoint for it. An item is at one place and an arrangement is at
one place, so it is **`addressId`** on each — set by the `PATCH` that already
edits them, cleared with `null`.

```
PATCH /api/items/7        { "addressId": 3 }
PATCH /api/organizers/2   { "addressId": null }
```

`404 ADDRESS_NOT_FOUND` when the id names no place.

`GET /api/items?addressId=3` is what is at a place, and `?addressId=none` the
items nobody has located — a different question, and the one a tidy-up starts
from.

The two are **independent**: an item in an arrangement carries its own address,
and it can disagree with the arrangement's. That is on purpose — a drill taken
to a site while its box stays in the workshop is two places, and the catalog
records both rather than choosing which one to call the lie.

## Organizer

Which items live in which case. An organizer row is one arrangement: a case, a
name, and an ordinal **number** — the one painted on the box and said out loud,
deliberately not the id.

The rules, all of them in the database rather than in a handler:

- one case per organizer, and **a case may hold several organizers** (a toolbox
  with three drawers is three arrangements of the same box);
- **an item is in at most one organizer**, by a unique index on the link table's
  `item_id`;
- deleting an item takes it out of its organizer and changes nothing else;
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
case's main photo) and every item in it (each with its own), so the list screen
can draw a tile per organizer without a request per row.

`caseId` is what a case's delete confirmation asks with.

### `POST /api/organizers` — `catalog.write`

```json
{ "name": "Wiertarki", "caseId": 2, "description": "", "itemIds": [7, 9] }
```

`name` and `caseId` are required; `itemIds` is optional, because the wizard
lets somebody set a case aside before deciding what goes in it. `number` may be
given, and when it is not the server takes the next free one — inside the same
transaction, so two people creating at once cannot both read the same maximum.

`201 { organizer }`. `409` when the number is taken or one of the items is
already in another organizer — moving an item out of somebody else's
arrangement is a decision, not something to do silently. `404` when the case
does not exist.

### `GET|PATCH|DELETE /api/organizers/:id` — `catalog.read` / `catalog.write`

A `PATCH` takes any of `name`, `description`, `number`, `caseId`. `caseId`
cannot be cleared: an arrangement of nothing is not an arrangement.

`DELETE` removes the arrangement only. The items and the case stay; they simply
stop being connected.

### `POST /api/organizers/:id/items` — `catalog.write`

```json
{ "itemIds": [7, 9] }
```

`200 { organizer }`, or `409` if one of them is already somewhere else.

### `DELETE /api/organizers/:id/items/:itemId` — `catalog.write`

Takes one item out. `200 { ok: true }`, or `404` if it was not in there.

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
items filling the top, the organizer's name under them, a rule, and the item
names in caps along the bottom — the same drawing as the Qbrick item stickers,
so a label from here sits on the shelf next to one from there. Both lines of
type are options; a card with neither is the pictures alone. The arrangement of
the pictures is chosen, not fixed: every split into rows and columns is
measured and the one that draws them largest wins, because a row that suits a
200 × 60 lid is hopeless on a 30 × 40 front. Names that do not fit shrink, and
then the tail becomes "+N więcej".

`withTitle` and `withNames` say whether each line is there at all.

`namesSource` says where the line under the rule comes from: `items` (the item
names, the default), `models` (their model numbers) or `text` (`namesText`).
The models are what is written on the machine and what a spare belt is ordered
by — "POF 1200 F5" identifies a box more sharply than "Frezarka
górnowrzecionowa", which is a category. Duplicates are dropped and an item with
no model recorded is skipped. An unknown value is treated as `items` rather
than refused, because the same field is read back out of jsonb on a redraw and
a row can hold anything; below it, the answer picks a column name.

Omitting `namesSource` means the old rule — a `namesText` is a typed line, its
absence is the item names — which is what labels made before the choice
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

`photoIds` must belong to items in this organizer — checked in the database,
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
options are for: a label made before an item was added, or before a maker got
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

### `GET /api/labels/sheet` — `catalog.read`

`?ids=14,16,27` — the chosen labels ganged onto A4, as `application/pdf`,
`inline`. Two hundred at a time at most, which is the highest `limit` the label
list accepts: "show everything, tick everything, print it" must not end in a
refusal. Each label is drawn from scratch — fifty take about three seconds, and
a full two hundred is tens of seconds of one request.

A label that cannot be drawn, because its pictures have gone missing since, is
left out rather than failing the sheet; one that no page can hold is left out
by the layout. Either way the count is written under the title on every page,
because a sheet of a hundred and ninety-four looks exactly like one of two
hundred. Only when nothing at all could be drawn is the answer an error
(`422`).

This is what a **batch** is printed from. The per-label file wraps one sticker
in a margin with crop marks around it, which is right for printing one and
wrong for printing thirty: thirty margins is most of a sheet of paper. The
sheet puts the artwork alone, side by side, with a hairline where the scissors
go, a header saying to print at 100% without fitting to the page, and a
measured 100 mm ruler at the foot of every page.

The measurements are the sibling Qbrick project's `arkusz_zbiorczy`, so a sheet
from here and one from there are cut the same way. A label wider than the paper
allows — a 200 mm lid against 190 mm between the margins — goes on sideways;
turning it costs nothing, since the sticker is cut out either way.

Nothing is stored. The sheet is a view of labels that already exist, and a
stored one would be a second thing to redraw whenever any of them changed. For
the same reason it is `no-store`: the same ids draw a different sheet the
moment one of the labels is redrawn.

The artwork is drawn again from each label's options rather than taken from its
file, so a sheet can never show something a label no longer says. A label that
cannot be drawn is left out and the rest are still ganged; `422` when that
leaves nothing, and `404` when none of the ids is a label.

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
items. A separate surface from `/api/items/:id/photos` because it answers a
different question — what did we import — and it exists for the cleanup after
a batch that pulled in the wrong pictures.

### `GET /api/photos` — `catalog.read`

| Parameter  | Meaning                                                                   | Default |
| ---------- | ------------------------------------------------------------------------- | ------- |
| `q`        | Matches the **item** — name, brand, model. A photo has no name of its own | —       |
| `source`   | `upload`, `url`, `search` or `edit`                                       | —       |
| `assigned` | `true` for photos that belong to an item, `false` for those still waiting | both    |
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
        { "kind": "item", "id": 9, "name": "Szlifierka kątowa", "isPrimary": true },
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
The kind is part of it because item 4 and case 4 are different cards that
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
admin. Item cards the account created stay, with `createdBy` set to `null`.

## Service

- `GET /healthz` — liveness only, never touches Postgres.
- `GET /api/version` — `{ version, commit, startedAt }`.
