// Default User-Agent helper shared across HTTP-based protocol engines.
//
// Format: `Testnizer/<version>` where `<version>` is sourced from
// `app.getVersion()` when running inside Electron (so packaged builds
// reflect the installed app version), falling back to package.json for
// non-Electron contexts (vitest, scripts, etc).

import { formatDefaultUserAgent, hasHeaderIgnoreCase } from '../../shared/http-auto-headers'

let cached: string | null = null

function readVersion(): string {
  try {
    // Lazy require so test/non-electron callers don't crash.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as { app?: { getVersion?: () => string } }
    const v = electron?.app?.getVersion?.()
    if (typeof v === 'string' && v.length > 0) return v
  } catch {
    // electron unavailable — fall through to package.json
  }
  try {
    // Lazy require so we don't pull JSON into the TS project graph.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('../../../package.json') as { version?: string }
    if (typeof pkg.version === 'string' && pkg.version.length > 0) return pkg.version
  } catch {
    // ignore
  }
  return '0.0.0'
}

export function getDefaultUserAgent(): string {
  if (cached === null) {
    // Format shared with the Headers-tab preview (issue #204).
    cached = formatDefaultUserAgent(readVersion())
  }
  return cached
}

/**
 * Inject the default `User-Agent` header into a header map if the caller
 * has not provided one (case-insensitive). Mutates and returns `headers`.
 */
export function applyDefaultUserAgent(headers: Record<string, string>): Record<string, string> {
  if (!hasHeaderIgnoreCase(headers, 'User-Agent')) {
    headers['User-Agent'] = getDefaultUserAgent()
  }
  return headers
}
