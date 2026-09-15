import type { ItemKind } from '../routes/items-input'

// What an importer hands back: one product page, read into the shape of an item
// card. Pure data — nothing here has fetched anything or written a row.
//
// The fields are the card's own, plus the two lists that make an import worth
// doing at all: the parameters off the spec table and the addresses of the
// photographs.

export type ImportedAttribute = {
  name: string
  value: string
}

// A document the page offers beside the product: the manual, a parts diagram.
export type ImportedManual = {
  title: string
  url: string
}

export type ImportedProduct = {
  attributes: ImportedAttribute[]
  brand: string
  category: string
  // What sort of card this page describes. A shop that sells drills answers
  // 'tool'; the maker of the boxes answers 'case'. It is the importer's to
  // decide because the page is what says which — nothing at the route can tell
  // a toolbox from a drill by its address.
  kind: ItemKind
  // The PDFs the page publishes for this product, in the order it lists them.
  // Empty when the page publishes none, which is most shops.
  manuals: ImportedManual[]
  model: string
  name: string
  notes: string
  // Full-size, in the order the page lists them. The first is the shop's own
  // main picture, which is why order is kept: it becomes the card's.
  photoUrls: string[]
  sourceUrl: string
}

export type Importer = {
  // Every host this script can read, including the www. form. The list is
  // what the import dialog offers and what an address is checked against.
  hosts: readonly string[]
  label: string
  // Whether this source publishes documents at all. A shop that sells an item
  // is not obliged to host its manual, and most do not — offering a page as a
  // place to fetch manuals from when it can only ever answer "none" is a
  // promise the screen cannot keep.
  manuals: boolean
  // Pure: the page as text, the address it came from, and a product or nothing.
  // Nothing means "this is not a product page", which is a refusal the person
  // can act on rather than a card full of empty fields.
  parse: (html: string, pageUrl: string) => null | ImportedProduct
}

// What a case importer hands back: one product page, read into the shape of a
// case rather than of an item card.
//
// A separate type rather than a wider `ImportedProduct`, because the two have
// almost nothing in common. An item has a maker, a model and a spec sheet of
// free-text parameters; a case is a box, and what is worth knowing about it is
// measurements with units the catalog stores as numbers. Folding them together
// would mean every field being optional and nothing being checked.
//
// Null is "not stated on the page", which is not zero: a case nobody has
// measured is normal, and a case with no height does not exist.
