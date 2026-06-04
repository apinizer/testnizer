/**
 * Smoke tests for `settings:*` IPC handlers.
 *
 * The handler lazy-loads `electron-store` so we mock that with a minimal
 * in-memory shim.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock } from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => makeElectronMock())

// Minimal electron-store stub: stores everything in a plain object.
class FakeStore {
  store: Record<string, unknown>
  constructor(opts: { defaults?: Record<string, unknown> }) {
    this.store = { ...(opts.defaults ?? {}) }
  }
  get(key: string): unknown {
    return this.store[key]
  }
  set(key: string, value: unknown): void {
    this.store[key] = value
  }
  clear(): void {
    this.store = {}
  }
}
vi.mock('electron-store', () => ({ default: FakeStore }))

const { registerSettingsHandlers } = await import('../../../src/main/ipc/settings.handler')

beforeEach(() => {
  harness.reset()
  registerSettingsHandlers()
})

describe('settings:getAll + set + get', () => {
  it('returns the defaults with success envelope', async () => {
    const res = (await harness.invoke('settings:getAll')) as {
      success: boolean
      data?: Record<string, unknown>
    }
    expect(res.success).toBe(true)
    expect(res.data?.theme).toBe('light')
  })

  it('round-trips a settings value', async () => {
    const setRes = (await harness.invoke('settings:set', 'theme', 'dark')) as {
      success: boolean
    }
    expect(setRes.success).toBe(true)
    const got = (await harness.invoke('settings:get', 'theme')) as {
      success: boolean
      data?: unknown
    }
    expect(got.success).toBe(true)
    expect(got.data).toBe('dark')
  })
})

describe('settings:setAll + reset', () => {
  it('bulk-sets settings and returns the merged state', async () => {
    const res = (await harness.invoke('settings:setAll', {
      fontSize: 16,
      language: 'tr',
    })) as { success: boolean; data?: { fontSize: number; language: string } }
    expect(res.success).toBe(true)
    expect(res.data?.fontSize).toBe(16)
    expect(res.data?.language).toBe('tr')
  })

  it('resets settings to defaults', async () => {
    await harness.invoke('settings:set', 'theme', 'dark')
    const res = (await harness.invoke('settings:reset')) as { success: boolean }
    expect(res.success).toBe(true)
  })
})
