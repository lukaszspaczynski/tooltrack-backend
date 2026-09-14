// The one table that says what each API route requires. The guard in
// src/server/route-guard.ts is the only caller, and it runs before any handler,
// so a route cannot be reached without appearing here.
//
// It is deliberately a table and not a decorator on each handler: the question
// "what can a viewer reach?" has to be answerable by reading one file, and a
// new route that nobody classified has to be refused rather than exposed.
// That is what the `deny` outcome is — the default, not an error case.

import { hasCapability, isActiveUser, type Capability, type User } from './roles'

export type RouteDomain =
  'auth' | 'brands' | 'cases' | 'organizers' | 'public' | 'settings' | 'tools' | 'users'

export type RouteCheck =
  // Reachable without a session. The handler still decides what it answers.
  | { kind: 'allow' }
  // Needs an active account holding the capability.
  | { kind: 'capability'; capability: Capability }
  // Not classified. Refused.
  | { kind: 'deny' }

export type RouteRequirement = {
  check: RouteCheck
  domain: RouteDomain
}

type Rule = {
  domain: RouteDomain
  methods: Partial<Record<Method, RouteCheck>>
  pattern: RegExp
}

type Method = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'

const READ_CATALOG: RouteCheck = { capability: 'catalog.read', kind: 'capability' }
const WRITE_CATALOG: RouteCheck = { capability: 'catalog.write', kind: 'capability' }
const MANAGE_USERS: RouteCheck = { capability: 'users.manage', kind: 'capability' }
const ALLOW: RouteCheck = { kind: 'allow' }

// Order matters: the first matching pattern decides. `/api/tools/categories`
// sits above `/api/tools/:id` because the id pattern would otherwise swallow
// it and ask for a tool named "categories".
const RULES: readonly Rule[] = [
  {
    domain: 'public',
    methods: { GET: ALLOW },
    pattern: /^\/(?:healthz|api\/version|api\/openapi\.json|api\/docs(?:\/[^/]+)?)$/,
  },
  {
    // Registration, login, logout and "who am I" cannot require a capability:
    // they are how a caller finds out whether it has one. Each handler does
    // its own check — /api/auth/me answers 401 without a session, logout is
    // idempotent, and register always creates a viewer.
    domain: 'auth',
    methods: { GET: ALLOW, PATCH: ALLOW, POST: ALLOW },
    pattern: /^\/api\/auth\/(?:register|login|logout|me|password|language)$/,
  },
  {
    domain: 'tools',
    methods: { GET: READ_CATALOG },
    pattern: /^\/api\/tools\/categories$/,
  },
  {
    // The parameter names in use across the catalog, like the category list
    // above it — and above /api/tools/:id for the same reason.
    domain: 'tools',
    methods: { GET: READ_CATALOG },
    pattern: /^\/api\/tools\/attributes$/,
  },
  {
    // Where this server can read a case from. Offered to anybody who may look
    // at the catalog, for the same reason the tool list is.
    domain: 'cases',
    methods: { GET: READ_CATALOG },
    pattern: /^\/api\/cases\/import\/sources$/,
  },
  {
    domain: 'cases',
    methods: { POST: WRITE_CATALOG },
    pattern: /^\/api\/cases\/import$/,
  },
  {
    // Reading the page again into a case that exists. Above the :id rule, which
    // would otherwise read "import" as one.
    domain: 'cases',
    methods: { POST: WRITE_CATALOG },
    pattern: /^\/api\/cases\/\d+\/import$/,
  },
  {
    // Which shops this server can read. Offered to anybody who may look at the
    // catalog, because the import dialog says it before asking for an address.
    domain: 'tools',
    methods: { GET: READ_CATALOG },
    pattern: /^\/api\/tools\/import\/sources$/,
  },
  {
    // Importing writes a card, its parameters and its photographs, so it asks
    // for what writing a card asks for.
    domain: 'tools',
    methods: { POST: WRITE_CATALOG },
    pattern: /^\/api\/tools\/import$/,
  },
  {
    // Reading the page again into a card that exists. It overwrites most of
    // one, so it asks for the same thing.
    domain: 'tools',
    methods: { POST: WRITE_CATALOG },
    pattern: /^\/api\/tools\/\d+\/import$/,
  },
  {
    // Makers. Part of the catalog like everything else: looking is read,
    // changing is write.
    domain: 'brands',
    methods: { GET: READ_CATALOG, POST: WRITE_CATALOG },
    pattern: /^\/api\/brands$/,
  },
  {
    domain: 'brands',
    methods: { DELETE: WRITE_CATALOG, GET: READ_CATALOG, PATCH: WRITE_CATALOG },
    pattern: /^\/api\/brands\/\d+$/,
  },
  {
    // Pointing a logo at a picture, or taking it away.
    domain: 'brands',
    methods: { DELETE: WRITE_CATALOG, PUT: WRITE_CATALOG },
    pattern: /^\/api\/brands\/\d+\/logo$/,
  },
  {
    // The arrangement of tools in a case. Same split as everything else in the
    // catalog: looking is read, changing is write.
    domain: 'organizers',
    methods: { GET: READ_CATALOG, POST: WRITE_CATALOG },
    pattern: /^\/api\/organizers$/,
  },
  {
    domain: 'organizers',
    methods: { DELETE: WRITE_CATALOG, GET: READ_CATALOG, PATCH: WRITE_CATALOG },
    pattern: /^\/api\/organizers\/\d+$/,
  },
  {
    // Putting a tool into an organizer, or taking it out. Neither touches the
    // tool card, but both change what the catalog says is where.
    domain: 'organizers',
    methods: { POST: WRITE_CATALOG },
    pattern: /^\/api\/organizers\/\d+\/tools$/,
  },
  {
    domain: 'organizers',
    methods: { DELETE: WRITE_CATALOG },
    pattern: /^\/api\/organizers\/\d+\/tools\/\d+$/,
  },
  {
    // The sizes the wizard may offer. Reading, like the organizer itself.
    domain: 'organizers',
    methods: { GET: READ_CATALOG },
    pattern: /^\/api\/organizers\/\d+\/label-slots$/,
  },
  {
    // Drawing a label writes a file and a row.
    domain: 'organizers',
    methods: { POST: WRITE_CATALOG },
    pattern: /^\/api\/organizers\/\d+\/labels$/,
  },
  {
    // Drawing them again writes the same files and rows, so it asks for the
    // same capability as drawing them the first time.
    domain: 'organizers',
    methods: { POST: WRITE_CATALOG },
    pattern: /^\/api\/organizers\/\d+\/labels\/refresh$/,
  },
  {
    // The PDF itself: readable by anyone who may read the catalog, like the
    // bytes of a photo.
    domain: 'organizers',
    methods: { GET: READ_CATALOG },
    pattern: /^\/api\/organizers\/\d+\/labels\/\d+\/file$/,
  },
  {
    // The picture of that PDF, for the list. Same reader, same reasoning.
    domain: 'organizers',
    methods: { GET: READ_CATALOG },
    pattern: /^\/api\/organizers\/\d+\/labels\/\d+\/preview$/,
  },
  {
    domain: 'organizers',
    methods: { DELETE: WRITE_CATALOG },
    pattern: /^\/api\/organizers\/\d+\/labels\/\d+$/,
  },
  {
    // Every label there is, across the organizers. Readable with the catalog,
    // like the labels under an organizer and like the photo library.
    domain: 'organizers',
    methods: { GET: READ_CATALOG },
    pattern: /^\/api\/labels$/,
  },
  {
    // Drawing them again writes files and rows wherever they live, so it asks
    // for the same capability as drawing one inside an organizer.
    domain: 'organizers',
    methods: { POST: WRITE_CATALOG },
    pattern: /^\/api\/labels\/refresh$/,
  },
  {
    // A sheet of labels already drawn. It writes nothing — no row, no file —
    // so it costs what looking at one label's PDF costs.
    domain: 'organizers',
    methods: { GET: READ_CATALOG },
    pattern: /^\/api\/labels\/sheet$/,
  },
  {
    // Same shape as the tool rules, and above the :id pattern for the same
    // reason: otherwise a request for the system list looks like a case named
    // "systems".
    domain: 'cases',
    methods: { GET: READ_CATALOG },
    pattern: /^\/api\/cases\/systems$/,
  },
  {
    domain: 'cases',
    methods: { GET: READ_CATALOG, POST: WRITE_CATALOG },
    pattern: /^\/api\/cases$/,
  },
  {
    domain: 'cases',
    methods: { DELETE: WRITE_CATALOG, GET: READ_CATALOG, PATCH: WRITE_CATALOG },
    pattern: /^\/api\/cases\/[^/]+$/,
  },
  {
    // Where labels go on a case. Changing the case, so the same capability.
    domain: 'cases',
    methods: { POST: WRITE_CATALOG },
    pattern: /^\/api\/cases\/\d+\/label-slots$/,
  },
  {
    domain: 'cases',
    methods: { DELETE: WRITE_CATALOG },
    pattern: /^\/api\/cases\/\d+\/label-slots\/\d+$/,
  },
  {
    domain: 'tools',
    methods: { GET: READ_CATALOG, POST: WRITE_CATALOG },
    pattern: /^\/api\/tools$/,
  },
  {
    domain: 'tools',
    methods: { DELETE: WRITE_CATALOG, GET: READ_CATALOG, PATCH: WRITE_CATALOG },
    pattern: /^\/api\/tools\/[^/]+$/,
  },
  {
    // Duplicating writes a card, so it asks for what writing a card asks for.
    domain: 'tools',
    methods: { POST: WRITE_CATALOG },
    pattern: /^\/api\/tools\/\d+\/duplicate$/,
  },
  {
    // The manuals of a tool. Reading one is reading the card; adding, renaming
    // or binning one is changing it.
    domain: 'tools',
    methods: { GET: READ_CATALOG, POST: WRITE_CATALOG },
    pattern: /^\/api\/tools\/\d+\/manuals$/,
  },
  {
    domain: 'tools',
    methods: { POST: WRITE_CATALOG },
    pattern: /^\/api\/tools\/\d+\/manuals\/from-page$/,
  },
  {
    domain: 'tools',
    methods: { DELETE: WRITE_CATALOG, PATCH: WRITE_CATALOG },
    pattern: /^\/api\/tools\/\d+\/manuals\/\d+$/,
  },
  {
    // The library: every manual there is, whichever tool keeps it. Looking is
    // reading the catalog; renaming one or taking it out of the catalog
    // altogether is changing it.
    domain: 'tools',
    methods: { GET: READ_CATALOG },
    pattern: /^\/api\/manuals$/,
  },
  {
    domain: 'tools',
    methods: { POST: WRITE_CATALOG },
    pattern: /^\/api\/manuals\/delete$/,
  },
  {
    domain: 'tools',
    methods: { PATCH: WRITE_CATALOG },
    pattern: /^\/api\/manuals\/\d+$/,
  },
  {
    // Putting a document the catalog already has onto another card.
    domain: 'tools',
    methods: { POST: WRITE_CATALOG },
    pattern: /^\/api\/tools\/\d+\/manuals\/attach$/,
  },
  {
    // The bytes of a manual, by the document's own id — it belongs to several
    // cards and none of them owns it. Readable by anyone who may read the
    // catalog, like the bytes of a photo.
    domain: 'tools',
    methods: { GET: READ_CATALOG },
    pattern: /^\/api\/manuals\/\d+\/file$/,
  },
  {
    // What this tool is: 230 V, 300 rpm, SDS-plus. Part of the card, so
    // reading one is reading the card and changing one is changing it. The
    // parameters themselves come back with the tool, which is why there is no
    // GET here.
    domain: 'tools',
    methods: { POST: WRITE_CATALOG },
    pattern: /^\/api\/tools\/\d+\/attributes$/,
  },
  {
    domain: 'tools',
    methods: { DELETE: WRITE_CATALOG, PATCH: WRITE_CATALOG },
    pattern: /^\/api\/tools\/\d+\/attributes\/\d+$/,
  },
  {
    // The bytes of a photo. Readable by anyone who may read the catalog — the
    // picture is part of the card.
    domain: 'tools',
    methods: { GET: READ_CATALOG },
    pattern: /^\/api\/(?:tools|cases)\/\d+\/photos\/\d+\/file$/,
  },
  {
    // The cutout writes a new photo, so it needs the capability to write one —
    // and it can cost a call to a paid service, which a viewer must not be
    // able to spend. The preview costs the same call, so it is not cheaper to
    // reach: all three paths ask for the same thing.
    domain: 'tools',
    methods: { POST: WRITE_CATALOG },
    pattern: /^\/api\/(?:tools|cases)\/\d+\/photos\/\d+\/cutout$/,
  },
  {
    domain: 'tools',
    methods: { POST: WRITE_CATALOG },
    pattern: /^\/api\/(?:tools|cases)\/\d+\/photos\/\d+\/cutout\/(?:preview|commit)$/,
  },
  {
    domain: 'tools',
    methods: { GET: WRITE_CATALOG },
    pattern: /^\/api\/(?:tools|cases)\/\d+\/photos\/\d+\/cutout\/preview\/[0-9a-f]{64}$/,
  },
  {
    domain: 'tools',
    methods: { DELETE: WRITE_CATALOG, PATCH: WRITE_CATALOG },
    pattern: /^\/api\/(?:tools|cases)\/\d+\/photos\/\d+$/,
  },
  {
    domain: 'tools',
    methods: { GET: READ_CATALOG, POST: WRITE_CATALOG },
    pattern: /^\/api\/(?:tools|cases)\/\d+\/photos$/,
  },
  {
    // Putting an existing photo on a tool changes the card, so it asks for
    // what changing a card asks for.
    domain: 'tools',
    methods: { POST: WRITE_CATALOG },
    pattern: /^\/api\/(?:tools|cases)\/\d+\/photos\/attach$/,
  },
  {
    // Searching the web costs an API call and only exists to add a photo, so
    // it asks for the capability to add one. A viewer has no use for it.
    domain: 'tools',
    methods: { GET: WRITE_CATALOG },
    pattern: /^\/api\/(?:tools|cases)\/\d+\/photo-suggestions$/,
  },
  {
    // Everyone who may search needs to see which engines are on — that is what
    // tells them why the search button is grey. The list carries no
    // credentials, only whether one is set.
    domain: 'settings',
    methods: { GET: READ_CATALOG },
    pattern: /^\/api\/settings\/search-engines$/,
  },
  {
    // Same split as the engine list: everyone may see which cutout method
    // would run, only an admin may change it or its keys.
    domain: 'settings',
    methods: { GET: READ_CATALOG, PATCH: MANAGE_USERS },
    pattern: /^\/api\/settings\/cutout$/,
  },
  {
    domain: 'settings',
    methods: { PATCH: MANAGE_USERS },
    pattern: /^\/api\/settings\/cutout\/[^/]+$/,
  },
  {
    // The keys are one installation's property. Only an admin changes them.
    domain: 'settings',
    methods: { PATCH: MANAGE_USERS },
    pattern: /^\/api\/settings\/search-engines\/[^/]+$/,
  },
  {
    // Which of the configured engines I search with is my own business, and
    // costs nobody anything to get wrong.
    domain: 'settings',
    methods: { PATCH: WRITE_CATALOG },
    pattern: /^\/api\/me\/search-engines\/[^/]+$/,
  },
  {
    // The whole photo library. Readable with the catalog, because the pictures
    // are the catalog; removable only by someone who may change it.
    domain: 'tools',
    methods: { GET: READ_CATALOG, POST: WRITE_CATALOG },
    pattern: /^\/api\/photos$/,
  },
  {
    // The bytes of any photo, attached to a tool or not.
    domain: 'tools',
    methods: { GET: READ_CATALOG },
    pattern: /^\/api\/photos\/\d+\/file$/,
  },
  {
    domain: 'tools',
    methods: { POST: WRITE_CATALOG },
    pattern: /^\/api\/photos\/delete$/,
  },
  {
    domain: 'users',
    methods: { GET: MANAGE_USERS },
    pattern: /^\/api\/users$/,
  },
  {
    domain: 'users',
    methods: { DELETE: MANAGE_USERS, GET: MANAGE_USERS, PATCH: MANAGE_USERS },
    pattern: /^\/api\/users\/[^/]+$/,
  },
]

export function routeRequirement(pathname: string, method: string): RouteRequirement {
  const normalized = normalizePathname(pathname)
  const rule = RULES.find((candidate) => candidate.pattern.test(normalized))

  if (!rule) return { check: { kind: 'deny' }, domain: domainOf(normalized) }

  // A known path asked with a method it does not implement is not a policy
  // question. It is refused here as `deny`, and index.ts answers 405 for the
  // methods it knows about before the guard is reached.
  const check = rule.methods[method.toUpperCase() as Method] ?? { kind: 'deny' as const }

  return { check, domain: rule.domain }
}

export function satisfiesRequirement(user: null | undefined | User, requirement: RouteRequirement) {
  switch (requirement.check.kind) {
    case 'allow':
      return true
    case 'capability':
      return isActiveUser(user) && hasCapability(user, requirement.check.capability)
    case 'deny':
      return false
  }
}

// Only used to label a refusal in logs, never to decide one.
function domainOf(pathname: string): RouteDomain {
  if (pathname.startsWith('/api/auth/')) return 'auth'
  if (pathname.startsWith('/api/settings/') || pathname.startsWith('/api/me/')) return 'settings'
  if (pathname.startsWith('/api/tools')) return 'tools'
  if (pathname.startsWith('/api/users')) return 'users'
  return 'public'
}

// A trailing slash is the same route. Anything else — casing, encoded
// segments, `..` — is left exactly as the router will see it, because a policy
// that normalizes more than the router does is a policy that can be walked
// around.
function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1)
  return pathname
}
