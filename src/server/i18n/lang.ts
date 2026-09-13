// Which language an answer is written in.
//
// Pure; see i18n/index.ts for where the language of the request in hand comes
// from. The key of every message is the Polish message itself, the same
// arrangement as the web client's: there is no key namespace to invent, an
// untranslated message goes out in Polish rather than as a raw key, and the
// code reads the way the answer reads.

export const LANGS = ['pl', 'en'] as const

export type Lang = (typeof LANGS)[number]

export const DEFAULT_LANG: Lang = 'pl'

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value)
}

// `Accept-Language: en-GB,en;q=0.9,pl;q=0.8` — the client's order of
// preference, and the first one this API can actually write. Anything else
// gets Polish, which is what the crew this serves reads.
export function parseAcceptLanguage(header: null | string | undefined): Lang {
  if (!header) return DEFAULT_LANG

  const wanted = header
    .split(',')
    .map((part) => {
      const [tag, ...parameters] = part.trim().split(';')
      const quality = parameters
        .map((parameter) => /^q=([\d.]+)$/i.exec(parameter.trim())?.[1])
        .find(Boolean)

      return { quality: quality === undefined ? 1 : Number(quality), tag: tag.trim().toLowerCase() }
    })
    // A tag the client scored zero is one it asked not to be given.
    .filter((entry) => Number.isFinite(entry.quality) && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality)

  for (const { tag } of wanted) {
    const base = tag.split('-')[0]
    if (isLang(base)) return base
  }

  return DEFAULT_LANG
}

// `{name}` filled in from an object. A message carrying a value takes a
// placeholder rather than being glued together from pieces: word order is not
// the same in both languages, and a sentence assembled at the seams can only
// be right in one of them.
export function interpolate(text: string, values: Record<string, number | string> = {}): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name]
    return value === undefined ? whole : String(value)
  })
}
