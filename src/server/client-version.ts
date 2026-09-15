// Which build of which client is calling, and whether it is too old to be
// allowed to carry on.
//
// The web client is rebuilt from this repo and reloads, so its version is
// whatever was deployed. A phone is not: it is whatever somebody installed,
// and the expand-and-contract rule in CLAUDE.md is what keeps an old one
// working. This is for the times that rule cannot help — when the *meaning* of
// a field changes rather than its name, and no amount of adding covers it.
//
// What it buys is not compatibility. It is a client that says "update me"
// instead of showing a screen that is quietly wrong, which is the difference
// between a person going to the store and a person telephoning the workshop.

// `X-ToolTrack-Client: mobile/1.4.2`. The name says which client family, since
// they are released on different days and have different floors; the version is
// numbers and dots, because a floor comparison on anything cleverer is a
// promise this does not need to make.
export const CLIENT_HEADER = 'x-tooltrack-client'

export type ClientBuild = { name: string; version: string }

// An array when the header arrives twice, which is a client with a bug rather
// than an attack — and either way not a build anybody can name, so it reads as
// no header at all.
export function parseClientHeader(raw: null | string | string[] | undefined): ClientBuild | null {
  if (Array.isArray(raw)) return null

  const match = /^([a-z][a-z0-9-]{0,31})\/(\d+(?:\.\d+){0,3})$/i.exec((raw ?? '').trim())
  if (!match) return null

  return { name: match[1].toLowerCase(), version: match[2] }
}

// `TOOLTRACK_MIN_CLIENT=mobile=1.6.0,web=2.0.0` — the oldest build of each
// client this API will still answer. Unset, or a client not named in it, means
// no floor: a version nobody has decided about must not be refused, or the day
// a second client appears is the day it cannot call anything.
export function clientFloors(raw = process.env.TOOLTRACK_MIN_CLIENT): Map<string, string> {
  const floors = new Map<string, string>()

  for (const entry of (raw ?? '').split(',')) {
    const [name, version] = entry.split('=').map((part) => part.trim())
    if (!name || !version) continue

    const parsed = parseClientHeader(`${name}/${version}`)
    if (parsed) floors.set(parsed.name, parsed.version)
  }

  return floors
}

// The floor this build is under, or null when it may proceed.
//
// A caller that sends no header, or one this does not understand, is let
// through. Every client that exists today is one of those — the header is new —
// and a floor that refused everything unrecognised would take the whole
// catalogue off the web the moment it was set.
export function belowFloor(
  raw: null | string | string[] | undefined,
  floors = clientFloors(),
): (ClientBuild & { minimum: string }) | null {
  const build = parseClientHeader(raw)
  if (!build) return null

  const minimum = floors.get(build.name)
  if (!minimum || compareVersions(build.version, minimum) >= 0) return null

  return { ...build, minimum }
}

// Segment by segment, numerically, with a missing segment counting as zero so
// that `1.6` and `1.6.0` are the same build. Not a general semver comparison:
// there are no prereleases here, and pretending otherwise would be a rule
// nobody tests because nobody produces the input.
export function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)

  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0)
    if (difference !== 0) return difference < 0 ? -1 : 1
  }

  return 0
}

// One line the first time a build is seen, and nothing after that.
//
// This is the half that is useful before any floor is set: the question
// "can we drop the old field yet" is answered by what is in the log rather
// than by guessing, and a line per request would answer nothing while filling
// the disk. Bounded, because the header is a string a caller chooses.
const seen = new Set<string>()
const MAX_REMEMBERED_BUILDS = 500

export function noteClient(raw: null | string | string[] | undefined): void {
  const build = parseClientHeader(raw)
  if (!build) return

  const key = `${build.name}/${build.version}`
  if (seen.has(key)) return

  if (seen.size >= MAX_REMEMBERED_BUILDS) seen.clear()
  seen.add(key)
  console.log(`[client] first seen: ${key}`)
}

// Tests only, so one cannot make another fail by having logged first.
export function forgetSeenClients(): void {
  seen.clear()
}
