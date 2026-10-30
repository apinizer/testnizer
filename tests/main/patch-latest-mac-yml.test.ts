/**
 * Issue #291 — Electron 44 needs macOS 13. The update manifest must stop older
 * Macs from auto-updating into an app that will not launch.
 *
 * electron-updater (6.8.3+, shipped by every release since v1.4.10) compares
 * the manifest's `minimumSystemVersion` with `os.release()` — the DARWIN
 * version on macOS — using semver.lt, and skips the update when the OS is
 * older. These tests run the patched manifest through that same comparison.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import semver from 'semver'
import {
  darwinVersionForMacOS,
  withMinimumSystemVersion,
} from '../../scripts/patch-latest-mac-yml.mjs'

// Shape electron-builder 26 writes for a dual-arch mac build.
const MANIFEST = `version: 1.6.0
files:
  - url: Testnizer-1.6.0-arm64.zip
    sha512: q1w2e3==
    size: 123456789
  - url: Testnizer-1.6.0-x64.zip
    sha512: a1s2d3==
    size: 123456780
  - url: Testnizer-1.6.0-arm64.dmg
    sha512: z1x2c3==
    size: 133456789
path: Testnizer-1.6.0-arm64.zip
sha512: q1w2e3==
releaseDate: '2026-10-27T12:00:00.000Z'
`

/** The check electron-updater 6.8.3 runs (AppUpdater.checkIfUpdateSupported). */
function updaterAcceptsOn(darwinRelease: string, manifestText: string): boolean {
  const info = yaml.load(manifestText) as { minimumSystemVersion?: string }
  if (!info.minimumSystemVersion) return true
  return !semver.lt(darwinRelease, info.minimumSystemVersion)
}

describe('latest-mac.yml minimumSystemVersion', () => {
  it('maps the marketing macOS version to the Darwin kernel version', () => {
    expect(darwinVersionForMacOS('11.0')).toBe('20.0.0')
    expect(darwinVersionForMacOS('13.0')).toBe('22.0.0')
    expect(darwinVersionForMacOS('15')).toBe('24.0.0')
    expect(() => darwinVersionForMacOS('10.15')).toThrow()
  })

  it('an unpatched manifest lets Monterey take the update (the stranding bug)', () => {
    expect(updaterAcceptsOn('21.6.0', MANIFEST)).toBe(true)
  })

  it('the patched manifest skips macOS 11/12 and still updates macOS 13+', () => {
    const patched = withMinimumSystemVersion(MANIFEST, '13.0')
    expect(updaterAcceptsOn('20.6.0', patched)).toBe(false) // Big Sur
    expect(updaterAcceptsOn('21.6.0', patched)).toBe(false) // Monterey
    expect(updaterAcceptsOn('22.0.0', patched)).toBe(true) // Ventura
    expect(updaterAcceptsOn('24.6.0', patched)).toBe(true) // Sequoia
    expect(updaterAcceptsOn('25.1.0', patched)).toBe(true) // Tahoe
  })

  it('keeps every file entry, hash and size byte-for-byte in value', () => {
    const before = yaml.load(MANIFEST) as Record<string, unknown>
    const after = yaml.load(withMinimumSystemVersion(MANIFEST, '13.0')) as Record<string, unknown>
    const { minimumSystemVersion, ...rest } = after
    expect(minimumSystemVersion).toBe('22.0.0')
    expect(rest).toEqual(before)
  })

  it('is idempotent', () => {
    const once = withMinimumSystemVersion(MANIFEST, '13.0')
    expect(withMinimumSystemVersion(once, '13.0')).toBe(once)
  })

  it('refuses a manifest without files', () => {
    expect(() => withMinimumSystemVersion('version: 1.6.0\n', '13.0')).toThrow(/no files/)
  })

  it('reads the floor from the same package.json key that sets LSMinimumSystemVersion', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
    expect(pkg.build.mac.minimumSystemVersion).toBe('13.0')
  })
})
