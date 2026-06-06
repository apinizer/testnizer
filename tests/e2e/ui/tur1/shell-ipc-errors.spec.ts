/**
 * MST-219 — IPC error envelope format
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'

uiTest.describe('Tur1 — Shell IPC errors [MST-219]', () => {
  uiTest('MST-219 invalid testSuite get returns success:false envelope', async ({ window }) => {
    const res = await window.evaluate(async () => {
      const w = window as Window & {
        api?: { testSuite?: { get: (id: string) => Promise<{ success: boolean; error?: string }> } }
      }
      return w.api?.testSuite?.get('00000000-0000-0000-0000-000000000000')
    })
    expect(res?.success).toBe(false)
    expect(typeof res?.error).toBe('string')
    expect((res?.error ?? '').length).toBeGreaterThan(0)
  })

  uiTest('MST-219 invalid testSuiteItem get returns success:false envelope', async ({ window }) => {
    const res = await window.evaluate(async () => {
      const w = window as Window & {
        api?: {
          testSuiteItem?: { get: (id: string) => Promise<{ success: boolean; error?: string }> }
        }
      }
      return w.api?.testSuiteItem?.get('00000000-0000-0000-0000-000000000000')
    })
    expect(res?.success).toBe(false)
    expect((res?.error ?? '').length).toBeGreaterThan(0)
  })
})
