// Who a photo belongs to.
//
// Tools and cases carry pictures on exactly the same terms: several per card,
// one of them the main one, uploaded or fetched or found by search, and a
// cutout is a new photo derived from another. Writing that twice would mean
// fixing every photo bug twice, so the photo routes and the photo store take
// an owner instead of a tool id.
//
// The pairing lives in a link table per kind, not on the photo row: one
// picture legitimately illustrates several tools, several cases, and a tool
// together with the case it lives in. Two tables rather than one polymorphic
// pair of columns, so the foreign keys are real.

export const PHOTO_OWNER_KINDS = ['case', 'tool'] as const

export type PhotoOwnerKind = (typeof PHOTO_OWNER_KINDS)[number]

export type PhotoOwner = {
  id: number
  kind: PhotoOwnerKind
}

// The only two places an owner becomes SQL. A value that is not a key of these
// maps cannot reach a query, whatever arrives in the path.
export const OWNER_COLUMNS: Record<PhotoOwnerKind, string> = {
  case: 'case_id',
  tool: 'tool_id',
}

// Which cards show which pictures. Two tables rather than one polymorphic
// table, so the foreign keys are real and deleting a case takes its links.
export const LINK_TABLES: Record<PhotoOwnerKind, string> = {
  case: 'photo_case',
  tool: 'photo_tool',
}

// The segment each owner occupies in a URL: /api/tools/7/photos,
// /api/cases/7/photos. Also how a path is read back into an owner.
export const OWNER_SEGMENTS: Record<PhotoOwnerKind, string> = {
  case: 'cases',
  tool: 'tools',
}

const SEGMENT_KINDS: Record<string, PhotoOwnerKind> = {
  cases: 'case',
  tools: 'tool',
}

// What the API calls the thing when it is missing. Polish, because it reaches
// the screen.
export const OWNER_LABELS: Record<PhotoOwnerKind, string> = {
  case: 'Nie ma takiej skrzynki',
  tool: 'Nie ma takiego narzędzia',
}

export function isPhotoOwnerKind(value: unknown): value is PhotoOwnerKind {
  return typeof value === 'string' && Object.hasOwn(OWNER_COLUMNS, value)
}

export function ownerColumn(kind: PhotoOwnerKind): string {
  return OWNER_COLUMNS[kind]
}

export function linkTable(kind: PhotoOwnerKind): string {
  return LINK_TABLES[kind]
}

// The router puts the matched segment in params.owner and the id in params.id.
// Anything else is a path that does not exist rather than a bad request:
// answering 400 would tell a client to fix a URL it was given by a link.
export function parsePhotoOwner(params: Record<string, string>): null | PhotoOwner {
  const kind = SEGMENT_KINDS[params.owner ?? '']
  if (!kind) return null

  const id = parseOwnerId(params.id)
  return id === null ? null : { id, kind }
}

export function parseOwnerId(value: string | undefined): null | number {
  if (!value || !/^\d+$/.test(value)) return null

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export function ownerPath(owner: PhotoOwner): string {
  return `/api/${OWNER_SEGMENTS[owner.kind]}/${owner.id}`
}

export function sameOwner(a: null | PhotoOwner, b: null | PhotoOwner): boolean {
  return a !== null && b !== null && a.kind === b.kind && a.id === b.id
}
