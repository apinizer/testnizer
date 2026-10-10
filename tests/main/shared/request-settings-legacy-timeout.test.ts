/**
 * Issue #185 — `readRequestSettings` and the legacy Apinizer `timeoutSeconds`.
 *
 * Rows imported before #185 carry only `timeoutSeconds` (Apinizer seconds).
 * In Apinizer `0` means "use the default", so a legacy 0 must read as NOT SET
 * (inherit) — never as Testnizer's `timeout: 0` = no limit. An explicit
 * Testnizer `timeout: 0` keeps meaning "no limit".
 */
import { describe, it, expect } from 'vitest'
import { readRequestSettings } from '../../../src/shared/request-settings'

describe('readRequestSettings — legacy timeoutSeconds (issue #185)', () => {
  it('timeoutSeconds 0 → not set (inherit)', () => {
    expect(readRequestSettings({ timeoutSeconds: 0 })).toEqual({})
  })

  it('timeoutSeconds > 0 → timeout in ms', () => {
    expect(readRequestSettings({ timeoutSeconds: 15 })).toEqual({ timeout: 15_000 })
  })

  it('explicit timeout 0 still means no limit, and wins over the legacy key', () => {
    expect(readRequestSettings({ timeout: 0 })).toEqual({ timeout: 0 })
    expect(readRequestSettings({ timeout: 0, timeoutSeconds: 15 })).toEqual({ timeout: 0 })
  })
})
