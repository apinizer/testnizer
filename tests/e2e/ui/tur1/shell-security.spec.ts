/**
 * MST-215..219, MST-291 — Electron shell security core
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'

uiTest.describe('Tur1 — Shell security [MST-215..219, MST-291]', () => {
  uiTest('MST-215 renderer has no Node require()', async ({ window }) => {
    const hasRequire = await window.evaluate(() => typeof (globalThis as { require?: unknown }).require !== 'undefined')
    expect(hasRequire).toBe(false)
  })

  uiTest('MST-216 CSP blocks renderer fetch to external origins', async ({ window }) => {
    const blocked = await window.evaluate(async () => {
      try {
        await fetch('https://example.com/')
        return false
      } catch {
        return true
      }
    })
    expect(blocked).toBe(true)
  })

  uiTest('MST-218 preload bridge exposes core IPC namespaces', async ({ window }) => {
    const keys = await window.evaluate(() => {
      const api = (window as Window & { api?: Record<string, unknown> }).api
      if (!api) return []
      return Object.keys(api).sort()
    })
    expect(keys).toContain('request')
    expect(keys).toContain('settings')
    expect(keys).toContain('workspace')
    expect(keys).toContain('eula')
  })

  uiTest('MST-219 IPC handlers return {success,error?} envelope on failure', async ({ window }) => {
    const res = await window.evaluate(async () => {
      const w = window as Window & {
        api?: { tree?: { move: (p: unknown) => Promise<{ success: boolean; error?: string }> } }
      }
      return w.api?.tree?.move({
        nodeId: '00000000-0000-0000-0000-000000000000',
        nodeType: 'request',
        targetFolderId: '00000000-0000-0000-0000-000000000001',
      })
    })
    expect(res?.success).toBe(false)
    expect(typeof res?.error).toBe('string')
    expect((res?.error ?? '').length).toBeGreaterThan(0)
  })
})
