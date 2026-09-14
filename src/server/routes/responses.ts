// The answers that are more than an envelope.
//
// Most routes answer `{ tool }` or `{ case }` — a single key around a value
// that already has a name, where the compiler knows the shape and there is
// nothing to get wrong. These are the others: the ones a handler assembles
// from several facts, which is exactly where a shape can drift from what the
// contract says it is.
//
// They live here rather than in the handlers because the OpenAPI schemas are
// generated from types. Written as a literal, each of these had to be described
// a second time by hand in src/openapi/, and the two could disagree — which is
// how `ToolListItem` and `CaseListItem` came to be missing two fields each.
//
// The rule the rest of the codebase follows: if a handler builds anything other
// than `{ key: <already-named-thing> }`, the shape gets a name here.

import type { Capability, Role, User, UserWithCapabilities } from '../../access/roles'
import type { CardPhoto } from './photos-store'
import type { Manual } from './manuals-store'
import type { Organizer } from './organizers-store'
import type { PhotoOwner } from './photo-owner'
import type { ToolDetail } from './tools-store'

// What a login, a registration and "who am I" all answer with. The account,
// and what its role actually allows — the client renders its menu from the
// capabilities rather than by comparing role strings of its own.
export type SessionResponse = {
  capabilities: Capability[]
  effectiveRole: null | Role
  user: User
}

// A failure that is reported per address rather than for the request: one bad
// link out of ten must not lose the other nine.
export type FailedLink = {
  error: string
  url: string
}

// The same, for a selection of records that already exist.
export type FailedId = {
  error: string
  id: number
}

// What came with an imported card, reported beside it rather than instead of
// it. `photos` is always 0 on a refresh, whose photographs are left alone.
export type ImportOutcome = {
  attributes: number
  attributesFailed: string[]
  manuals: number
  manualsFailed: number
  photos: number
  photosFailed: number
  sourceUrl: string
}

export type ImportResponse = {
  imported: ImportOutcome
  tool: null | ToolDetail
}

// A cutout that has been run but not kept. The checksum is what the commit
// names to turn these bytes into a photograph of the card.
export type CutoutPreview = {
  byteSize: number
  checksum: string
  contentType: string
  height: null | number
  url: string
  width: null | number
}

export type CutoutPreviewResponse = {
  preview: CutoutPreview
  provider: string
}

export type CutoutResponse = {
  photo: CardPhoto
  provider: string
}

// Photographs fetched from addresses: what was stored, and what was not.
export type PhotoImportResponse = {
  failed: FailedLink[]
  photos: CardPhoto[]
}

// Photographs that already existed, put onto a card.
export type PhotoAttachResponse = {
  failed: { id: number; reason: string }[]
  photos: CardPhoto[]
}

// The library's bin. `deleted` can be lower than `requested`: somebody else may
// have removed a photograph between the screen loading and the button being
// pressed, and `promoted` names the cards that now show a different main one.
export type PhotoDeleteResponse = {
  deleted: number
  promoted: PhotoOwner[]
  requested: number
}

export type ManualImportResponse = {
  failed: FailedLink[]
  manuals: Manual[]
}

export type ManualAttachResponse = {
  attached: number
  manuals: Manual[]
}

// What a bulk manual delete took, and off which cards.
export type ManualDeleteResponse = {
  deleted: number
  tools: { id: number; name: string }[]
}

// Redrawing labels: how many were drawn, and which were not, because a label
// whose photographs have gone is the one thing somebody has to act on.
export type LabelRefreshResponse = {
  failed: FailedId[]
  refreshed: number
}

export type OrganizerLabelRefreshResponse = LabelRefreshResponse & {
  organizer: null | Organizer
}

export type UserListResponse = {
  users: UserWithCapabilities[]
}
