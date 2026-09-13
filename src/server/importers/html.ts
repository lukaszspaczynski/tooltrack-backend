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

export function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;| /g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&oacute;/g, 'ó')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
}
