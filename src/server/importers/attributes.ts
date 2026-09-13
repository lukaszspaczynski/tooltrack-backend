// What every importer has to do with a spec table once it has read one.

import type { ImportedAttribute } from './types'

// One parameter cannot be listed twice on a card — the database says so — and
// a spec table names two moments of torque, one for hard materials and one for
// soft, or four vibration figures for four ways of holding the machine.
// Neither reading is worth losing, so they become one parameter with both: the
// qualifiers are what tell them apart anyway.
export function mergeDuplicates(attributes: ImportedAttribute[]): ImportedAttribute[] {
  const byName = new Map<string, ImportedAttribute>()

  for (const attribute of attributes) {
    const key = attribute.name.toLocaleLowerCase('pl-PL')
    const seen = byName.get(key)

    if (!seen) {
      byName.set(key, { ...attribute })
      continue
    }

    if (!seen.value.includes(attribute.value)) seen.value = `${seen.value}; ${attribute.value}`
  }

  return [...byName.values()]
}

// "Instrukcja obsługi | GBH 18V-26 (PDF 12.4 MB)" is a label for a button. The
// size is the page's business and the card knows its own; what is left is the
// title.
export function manualTitle(label: string, fallback = 'Instrukcja'): string {
  const written = label
    .replace(/\s*\((?:PDF|pdf)[^)]*\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()

  return written || fallback
}
