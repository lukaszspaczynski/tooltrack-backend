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
- [`docs/api.http`](docs/api.http) is every endpoint as a clickable request.
  Log in once and the extension keeps the session cookie for the rest.

Editor behaviour (format on save, organize imports, LF, workspace TypeScript)
is the same as in the RN-App repo, so a save does the same thing in both. The
code style itself is not: this project has no semicolons, and `.prettierrc.json`
is the authority.

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

## Deployment

`Dockerfile` builds a container that runs the TypeScript directly through
`tsx`. It listens on `$PORT` (8080 in the image, 37411 locally) and needs
`DATABASE_URL`, `NODE_ENV=production` and `TOOLTRACK_ALLOWED_ORIGINS`. Pass
`--build-arg TOOLTRACK_COMMIT=$(git rev-parse --short HEAD)` and
`/api/version` will tell you what is running.

`/healthz` is the liveness probe and deliberately never touches Postgres: a
probe that fails during a brief database blip restarts a container that was
about to recover. Database trouble is reported per request, as a 503.
