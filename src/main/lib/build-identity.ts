import pkg from '../../../package.json'

/**
 * Which build of the app is running: the package version plus the commit the
 * bundle was built from. Pre-release rounds share a version with each other
 * and with the final release, so the version alone cannot tell two builds
 * apart (see `buildId()` in electron.vite.config.ts).
 */
export interface BuildIdentity {
  version: string
  build: string
}

/**
 * The single owner of the `__BUILD_ID__` guard. electron-vite replaces the
 * constant at build time; under vitest no `define` runs, so the reference is
 * checked with `typeof` and falls back to `'unknown'`.
 */
export function currentBuildIdentity(): BuildIdentity {
  return {
    version: pkg.version || 'unknown',
    build: typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'unknown',
  }
}
