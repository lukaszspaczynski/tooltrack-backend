import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { ROUTES } from '../src/server/route-list'

const API_MD = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'api.md'), 'utf8')

// What api.md documents, read in the four ways it writes a route down.
//
// The file has conventions, and they are good ones for prose even though they
// are awkward to compare against a list:
//
//   ### `GET /api/tools`                    a heading per route
//   ### `GET|PATCH|DELETE /api/brands/:id`  three routes that read as one
//   **`POST /api/{tools,cases}/:id/photos`** the two parallel families at once
//   **`GET .../cutout/preview/:checksum`**   a suffix, under a section heading
//
// So they are expanded here rather than banned there. A test that made the
// documentation worse to make itself simpler would be the wrong way round.

const HEADINGS = /^(?:###\s+|\*\*)`([A-Z|]+)\s+([^`]+)`/gm
const BULLETS = /^-\s+`([A-Z]+)\s+(\/[^`]+)`\s+—/gm

function expandBraces(path: string): string[] {
  const braces = /\{([^}]+)\}/.exec(path)
  if (!braces) return [path]

  return braces[1]
    .split(',')
    .map((option) => path.replace(braces[0], option.trim()))
    .flatMap(expandBraces)
}

function documented(served: Set<string>): Set<string> {
  const routes = new Set<string>()

  const add = (methods: string, path: string) => {
    for (const method of methods.split('|')) {
      for (const expanded of expandBraces(path.trim())) {
        // A suffix stands for every route that ends in it. The section heading
        // above supplies the rest for a person; for this test, the route table
        // does.
        if (expanded.startsWith('...')) {
          const suffix = expanded.slice('...'.length)
          for (const route of served) {
            if (route.startsWith(`${method} `) && route.endsWith(suffix)) routes.add(route)
          }
          continue
        }

        routes.add(`${method} ${expanded}`)
      }
    }
  }

  for (const heading of API_MD.matchAll(HEADINGS)) add(heading[1], heading[2])
  // The two that are a bullet rather than a heading, because neither has
  // anything to say beyond its one line.
  for (const bullet of API_MD.matchAll(BULLETS)) add(bullet[1], bullet[2])

  return routes
}

test('every route the server answers is written down in api.md', () => {
  // The spec says what the shapes are; this file says why they are that shape,
  // and a route missing from it is a route nobody wrote the reasoning for.
  // Without this test the two drift silently, and the prose is the half a
  // person actually reads.
  const served = new Set<string>(ROUTES)
  const missing = [...served].filter((route) => !documented(served).has(route)).sort()

  assert.deepEqual(missing, [])
})

test('api.md documents nothing the server no longer answers', () => {
  const served = new Set<string>(ROUTES)
  const stale = [...documented(served)].filter((route) => !served.has(route)).sort()

  assert.deepEqual(stale, [])
})
