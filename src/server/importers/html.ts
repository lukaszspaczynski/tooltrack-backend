// The two small things every importer needs from a page that was written for a
// browser: text without its tags, and entities as the characters they stand
// for. Shared because a shop writing `&oacute;` and a manufacturer writing
// `&nbsp;` is the same problem twice.

// Tags out, entities in, whitespace to single spaces — including the
// non-breaking ones an editor leaves between a parameter and its value.
export function text(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

// The named entities that actually turn up on the pages this reads: Polish
// letters, the dashes a spec sheet writes a range with, and the units. A page
// that writes "11 000&ndash;30 000" means a range, and leaving the entity in
// puts it on a card as it is written here.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  deg: '°',
  eacute: 'é',
  gt: '>',
  hellip: '…',
  laquo: '«',
  ldquo: '“',
  lt: '<',
  mdash: '—',
  middot: '·',
  nbsp: ' ',
  ndash: '–',
  oacute: 'ó',
  quot: '"',
  raquo: '»',
  rdquo: '”',
  reg: '®',
  rsquo: '’',
  sup2: '²',
  sup3: '³',
  times: '×',
  trade: '™',
  uuml: 'ü',
}

export function decodeEntities(value: string): string {
  return value
    .replace(/ /g, ' ')
    .replace(
      /&([a-z][a-z0-9]*);/gi,
      (whole, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? whole,
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
}
