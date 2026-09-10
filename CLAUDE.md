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
