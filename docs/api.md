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

| Capability                                   | viewer | editor | admin |
| -------------------------------------------- | :----: | :----: | :---: |
| `tools.read` — browse and search the catalog |   ●    |   ●    |   ●   |
| `tools.write` — add, edit, delete tools      |        |   ●    |   ●   |
| `users.manage` — list users, change roles    |        |        |   ●   |

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

### `GET /api/tools` — `tools.read`

Query parameters, all optional:

| Name        | Meaning                                                                    | Default     |
| ----------- | -------------------------------------------------------------------------- | ----------- |
| `q`         | Substring match over name, brand, model, serial number, category and notes | —           |
| `category`  | Exact category, case-insensitive                                           | —           |
| `condition` | One of `new`, `good`, `worn`, `needs_repair`, `retired`                    | —           |
| `sort`      | `updatedAt`, `createdAt` or `name`                                         | `updatedAt` |
| `order`     | `asc` or `desc`                                                            | `desc`      |
| `limit`     | 1–200                                                                      | 50          |
| `offset`    | ≥ 0                                                                        | 0           |

```json
{ "items": [/* tools */], "total": 128, "limit": 50, "offset": 0 }
```

A malformed `limit`, `offset` or `sort` is clamped or ignored rather than
refused — a pasted link should still show the catalog. An unknown `condition`
is a `400`, because silently listing everything would look like an answer.

### `GET /api/tools/categories` — `tools.read`

`{ "categories": [{ "category": "Wiertarki", "count": 12 }] }`, read from the
tools themselves. That is the list to offer in a filter.

### `POST /api/tools` — `tools.write`

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

### `GET /api/tools/:id` — `tools.read`

`200 { tool }` or `404`.

### `PATCH /api/tools/:id` — `tools.write`

Send only what changes. `""` clears a field; omitting it leaves it alone. The
name cannot be cleared. `200 { tool }`, `404`, or `409` on a duplicate serial.

### `DELETE /api/tools/:id` — `tools.write`

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

## Photos

A tool has any number of photos and at most one **main** photo — the one the
catalog grid shows. The first photo added becomes the main one automatically,
and deleting the main one promotes the oldest remaining.

The bytes are always stored by this server. A URL or a search result is a
source, not a link the catalog keeps depending on: a page that disappears next
year must not empty the shed.

### `GET /api/tools/:id/photos` — `tools.read`

```json
{ "photos": [{ "id": 3, "url": "/api/tools/7/photos/3/file", "isPrimary": true }] }
```

Main photo first, then oldest to newest. Each entry carries `contentType`,
`byteSize`, `width`, `height`, `source` (`upload` \| `url` \| `search`),
`sourceUrl`, `attribution`, `createdBy` and `createdAt`.

### `POST /api/tools/:id/photos` — `tools.write`

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

The server fetches each one and stores it. `201 { photos, failed }`: one dead
link out of ten does not lose the other nine, and `failed` says which address
failed and why. Everything failing is a `422`.

Refusals worth handling: `409` the same image is already on this tool
(compared by checksum, not by URL), `415` the file is not a JPEG, PNG, GIF or
WebP — decided by reading the file, not by trusting its content type — and
`413` above the size cap. An address pointing into a private network is
refused as a failed item, never fetched.

### `GET /api/tools/:id/photos/:photoId/file` — `tools.read`

The bytes, with `cache-control: private, immutable` and the checksum as `ETag`.
Use it directly as an `<img src>`.

### `PATCH /api/tools/:id/photos/:photoId` — `tools.write`

```json
{ "isPrimary": true }
```

The only edit a photo has. Everything else about it is a fact about the file.

### `DELETE /api/tools/:id/photos/:photoId` — `tools.write`

`200 { "ok": true }`. The file itself is removed once no other card uses it —
identical images share one file on disk.

### `GET /api/tools/:id/photo-suggestions` — `tools.write`

Up to ten images found on the web for this tool. `?q=` overrides the query,
which otherwise is the tool's brand and model.

```json
{
  "provider": "google",
  "query": "Bosch Professional GWS 180-LI",
  "suggestions": [
    {
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

Nothing is downloaded here — these are links. Saving is `POST /photos` with the
ones that were picked. It asks for `tools.write` rather than `tools.read`
because it costs an API call and exists only to add a photo.

`503` when the search provider is unconfigured, rate-limited or not answering;
the catalog is unaffected, so the client should say so rather than look broken.

## Users — `users.manage`

### `GET /api/users`

`{ "users": [{ ...user, "capabilities": ["tools.read"] }] }`.

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
