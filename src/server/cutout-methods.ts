// The catalogue of cutout methods: what each one is called, what it needs, and
// what it is good at.
//
// Pure and free of I/O, like the search engine registry it deliberately
// mirrors — the settings screen, the store and the cutout itself all have to
// agree about it.

export const CUTOUT_METHODS = ['local', 'removebg', 'gemini'] as const

export type CutoutMethod = (typeof CUTOUT_METHODS)[number]

export type CutoutMethodDefinition = {
  envKey?: string
  keyLabel: string
  label: string
  method: CutoutMethod
  note: string
  requiresKey: boolean
}

export const CUTOUT_METHOD_DEFINITIONS: readonly CutoutMethodDefinition[] = [
  {
    keyLabel: '',
    label: 'Lokalny skrypt',
    method: 'local',
    note: 'Bez klucza, odpowiedź w ułamku sekundy, przezroczyste tło. Działa na zdjęciach katalogowych — przedmiot na jasnym, jednolitym tle; inne odrzuca.',
    requiresKey: false,
  },
  {
    envKey: 'REMOVE_BG_API_KEY',
    keyLabel: 'Klucz remove.bg',
    label: 'remove.bg',
    method: 'removebg',
    note: 'Usługa zbudowana do wycinania tła. Radzi sobie ze zdjęciami z ręki i z warsztatu, zwraca przezroczyste PNG. Klucz z remove.bg/api, 50 zdjęć miesięcznie za darmo.',
    requiresKey: true,
  },
  {
    envKey: 'GEMINI_API_KEY',
    keyLabel: 'Klucz Gemini',
    label: 'Gemini',
    method: 'gemini',
    note: 'Model ogólny. Zwraca przedmiot na jednolitym białym tle, bez przezroczystości. Klucz z aistudio.google.com — inny niż ten do wyszukiwarki.',
    requiresKey: true,
  },
]

export function isCutoutMethod(value: unknown): value is CutoutMethod {
  return typeof value === 'string' && (CUTOUT_METHODS as readonly string[]).includes(value)
}

export function cutoutMethod(method: CutoutMethod): CutoutMethodDefinition {
  const definition = CUTOUT_METHOD_DEFINITIONS.find((entry) => entry.method === method)
  if (!definition) throw new Error(`Unknown cutout method: ${method}`)
  return definition
}
