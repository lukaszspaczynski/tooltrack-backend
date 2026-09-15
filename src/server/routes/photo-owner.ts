// Who a photo belongs to.
//
// There used to be two of these: an item and a case were separate tables, so
// every photo route, every store function and the link table itself came in
// two versions, and the segment in the URL said which. A case is a card now —
// one table, one link table, one set of routes — and what is left of that
// distinction is this module: the id of the card a picture hangs on.
//
// The pairing lives in a link table rather than on the photo row: one picture
// legitimately illustrates several cards, and carrying the owner on the photo
// would mean a row per card and a copy of the attribution with it.
//
// It stays a type rather than becoming a bare number because the photo store
// takes it thirty-odd times, and `photoIdsOf(owner)` reads as what it is where
// `photoIdsOf(7)` reads as an id of something unsaid.

export type PhotoOwner = {
  id: number
}

// The one place an owner becomes SQL, kept as constants so a query cannot
// spell either of them differently.
export const OWNER_COLUMN = 'item_id'
export const LINK_TABLE = 'photo_item'

// The router puts the id in params.id. Anything else is a path that does not
// exist rather than a bad request: answering 400 would tell a client to fix a
// URL it was given by a link.
export function parsePhotoOwner(params: Record<string, string>): null | PhotoOwner {
  const id = parseOwnerId(params.id)
  return id === null ? null : { id }
}

export function parseOwnerId(value: string | undefined): null | number {
  if (!value || !/^\d+$/.test(value)) return null

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export function ownerPath(owner: PhotoOwner): string {
  return `/api/items/${owner.id}`
}

export function sameOwner(a: null | PhotoOwner, b: null | PhotoOwner): boolean {
  return a !== null && b !== null && a.id === b.id
}
