import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { EN } from './catalog'
import { interpolate, parseAcceptLanguage } from './lang'
import { t, withLanguage } from './index'

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sources(path)
    return entry.endsWith('.ts') && !entry.includes('.test.') ? [path] : []
  })
}

// Every message the code asks for by name, plus the notes the settings screen
// reads out of the two definition tables — those are translated by key at the
// point the answer is built, so they are never a literal argument to `t`.
function messagesInSource(): Set<string> {
  const found = new Set<string>()

  for (const path of sources(SERVER)) {
    if (path.endsWith(join('i18n', 'catalog.ts')) || path.endsWith(join('i18n', 'lang.ts'))) {
      continue
    }

    const source = readFileSync(path, 'utf8')
    for (const match of source.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)+)'/g)) {
      found.add(match[1].replace(/\\'/g, "'"))
    }

    if (path.endsWith('search-engines.ts') || path.endsWith('cutout-methods.ts')) {
      for (const entry of source.matchAll(/(?:note|label|keyLabel): '((?:[^'\\]|\\.)+)'/g)) {
        found.add(entry[1].replace(/\\'/g, "'"))
      }
    }

    if (path.endsWith('photo-owner.ts')) {
      for (const entry of source.matchAll(/(?:case|tool): '((?:[^'\\]|\\.)+)'/g)) {
        found.add(entry[1].replace(/\\'/g, "'"))
      }
    }
  }

  return found
}

test('every message a person can read has an English translation', () => {
  const missing = [...messagesInSource()]
    .filter((message) => /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(message) && !(message in EN))
    .sort()

  assert.deepEqual(
    missing,
    [],
    `${missing.length} message(s) would go out in Polish:\n${missing.join('\n')}`,
  )
})

test('the catalog holds nothing the code no longer says', () => {
  const used = messagesInSource()
  const orphans = Object.keys(EN).filter((message) => !used.has(message))

  assert.deepEqual(orphans, [], `unused translations:\n${orphans.join('\n')}`)
})

test('the language of a request is the first one this API can write', () => {
  assert.equal(parseAcceptLanguage('en-GB,en;q=0.9,pl;q=0.8'), 'en')
  assert.equal(parseAcceptLanguage('pl-PL,pl;q=0.9,en;q=0.8'), 'pl')
  // Quality decides, not the order the header happens to be written in.
  assert.equal(parseAcceptLanguage('de;q=1.0,en;q=0.9,pl;q=0.95'), 'pl')
  // A language scored zero is one the client asked not to be given.
  assert.equal(parseAcceptLanguage('en;q=0, pl'), 'pl')
  // Nothing we can write, nothing at all, or nonsense: Polish.
  assert.equal(parseAcceptLanguage('de-DE,fr'), 'pl')
  assert.equal(parseAcceptLanguage(''), 'pl')
  assert.equal(parseAcceptLanguage(null), 'pl')
  assert.equal(parseAcceptLanguage('*'), 'pl')
})

test('a message is written in the language of the request in hand', () => {
  const message = 'Nie ma takiego zdjęcia'

  assert.equal(
    withLanguage('pl', () => t(message)),
    message,
  )
  assert.equal(
    withLanguage('en', () => t(message)),
    'There is no such photo',
  )
  // Outside a request there is no language to read, and Polish is what this
  // API said before it said anything else.
  assert.equal(t(message), message)
})

test('a message carrying a value is not glued together from pieces', () => {
  assert.equal(
    withLanguage('en', () => t('Serwer odpowiedział {status}', { status: 503 })),
    'The server answered 503',
  )
  assert.equal(
    withLanguage('pl', () => t('Plik jest większy niż {mb} MB', { mb: 8 })),
    'Plik jest większy niż 8 MB',
  )
  assert.equal(interpolate('Nic do {czego}', {}), 'Nic do {czego}')
})

test('one request does not overhear another', async () => {
  // Two requests in flight is the normal case, and the store is per-call
  // rather than a module-level variable for exactly this reason.
  const [polish, english] = await Promise.all([
    withLanguage('pl', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return t('Nie ma takiego zdjęcia')
    }),
    withLanguage('en', async () => t('Nie ma takiego zdjęcia')),
  ])

  assert.equal(polish, 'Nie ma takiego zdjęcia')
  assert.equal(english, 'There is no such photo')
})
