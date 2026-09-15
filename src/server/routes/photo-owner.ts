// Who a photo belongs to.
//
// Items and cases carry pictures on exactly the same terms: several per card,
// one of them the main one, uploaded or fetched or found by search, and a
// cutout is a new photo derived from another. Writing that twice would mean
// fixing every photo bug twice, so the photo routes and the photo store take
// an owner instead of an item id.
//
// The pairing lives in a link table, not on the photo row: one picture
// legitimately illustrates several cards, and carrying the owner on the photo
// would mean a row per card and a copy of the attribution with it.
//
// There used to be two of those tables, because a case was a table of its own.
// A case is a card now, so there is one — and the two kinds below survive for
// what is still different about them: the segment in the URL, and the fact
// that `/api/cases/7/photos` must refuse a drill.

export const PHOTO_OWNER_KINDS = ['case', 'item'] as const

export type PhotoOwnerKind = (typeof PHOTO_OWNER_KINDS)[number]

export type PhotoOwner = {
  id: number
  kind: PhotoOwnerKind
}

// The only two places an owner becomes SQL. A value that is not a key of these
// maps cannot reach a query, whatever arrives in the path.
export const OWNER_COLUMNS: Record<PhotoOwnerKind, string> = {
  case: 'item_id',
  item: 'item_id',
}

// Which cards show which pictures. One table now, and the maps are kept rather
// than collapsed because the two kinds still differ in the URL — and because a
// third kind would arrive here rather than in every query.
export const LINK_TABLES: Record<PhotoOwnerKind, string> = {
  case: 'photo_item',
  item: 'photo_item',
}

// The segment each owner occupies in a URL: /api/items/7/photos,
// /api/cases/7/photos. Also how a path is read back into an owner.
export const OWNER_SEGMENTS: Record<PhotoOwnerKind, string> = {
  case: 'cases',
  item: 'items',
}

const SEGMENT_KINDS: Record<string, PhotoOwnerKind> = {
  cases: 'case',
  items: 'item',
}

// What the API calls the thing when it is missing. Polish, because it reaches
// the screen.
export const OWNER_LABELS: Record<PhotoOwnerKind, string> = {
  case: 'Nie ma takiej skrzynki',
  item: 'Nie ma takiego narzędzia',
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
