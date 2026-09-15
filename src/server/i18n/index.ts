// The language of the request in hand.
//
// A handler is a function from a Request to a Response and nothing else — that
// is the shape the whole routing table is built on — so the language cannot be
// a parameter threaded through every handler, every store and every body
// parser without changing all three. It is ambient instead: the http adapter
// runs each request inside `withLanguage`, and `t` reads it from there.
//
// Outside a request there is no store and `t` answers in Polish, which is what
// a script, a test, or the schema item gets, and what this API said before it
// said anything else.

import { AsyncLocalStorage } from 'node:async_hooks'

import { EN } from './catalog'
import { DEFAULT_LANG, interpolate, type Lang } from './lang'

const store = new AsyncLocalStorage<Lang>()

export function withLanguage<T>(lang: Lang, run: () => T): T {
  return store.run(lang, run)
}

export function currentLang(): Lang {
  return store.getStore() ?? DEFAULT_LANG
}

// The Polish message is the key. Nothing in the catalog means the Polish goes
// out as it is — right for the crew, honest for anybody else, and never a raw
// key in front of somebody trying to work out what went wrong.
export function t(text: string, values?: Record<string, number | string>): string {
  const lang = currentLang()
  const message = lang === 'pl' ? text : (EN[text] ?? text)

  return values ? interpolate(message, values) : message
}

export { DEFAULT_LANG, isLang, LANGS, parseAcceptLanguage, type Lang } from './lang'
