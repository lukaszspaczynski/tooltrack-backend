// The release identity of whatever is running, decided in one place so that
// /api/version, logs and a support question all quote the same thing.
//
// The version is the one in package.json, kept here as a literal rather than
// imported: importing package.json ties the server bundle to a file that also
// carries the dependency tree, and this is the only field of it anyone reads.

export const APP_VERSION = '0.1.0'

export type BuildInfo = {
  commit: string
  startedAt: string
  version: string
}

const startedAt = new Date().toISOString()

export function buildInfo(): BuildInfo {
  return {
    commit: process.env.TOOLTRACK_COMMIT?.trim() || 'unknown',
    startedAt,
    version: APP_VERSION,
  }
}
