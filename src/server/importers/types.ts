// What an importer hands back: one product page, read into the shape of a tool
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
  brand: string
  category: string
  model: string
  name: string
  notes: string
  attributes: ImportedAttribute[]
  // The PDFs the page publishes for this product, in the order it lists them.
  // Empty when the page publishes none, which is most shops.
  manuals: ImportedManual[]
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
  // Pure: the page as text, the address it came from, and a product or nothing.
  // Nothing means "this is not a product page", which is a refusal the person
  // can act on rather than a card full of empty fields.
  parse: (html: string, pageUrl: string) => null | ImportedProduct
}
