/**
 * MST-217 — External link shell.openExternal guard
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'

uiTest.describe('Tur1 — Shell window open [MST-217]', () => {
  uiTest('MST-217 app.openExternal allows https and rejects javascript:', async ({ window }) => {
    const ok = await window.evaluate(async () => {
      const w = window as unknown as Window & {
        api?: { app?: { openExternal: (url: string) => Promise<{ success: boolean; error?: string }> } }
      }
      return w.api?.app?.openExternal('https://www.testnizer.com/')
    })
    expect(ok?.success).toBe(true)

    const bad = await window.evaluate(async () => {
      const w = window as unknown as Window & {
        api?: { app?: { openExternal: (url: string) => Promise<{ success: boolean; error?: string }> } }
      }
      return w.api?.app?.openExternal('javascript:alert(1)')
    })
    expect(bad?.success).toBe(false)
  })

  uiTest('MST-217 window.open http(s) is denied in renderer', async ({ window }) => {
    const opened = await window.evaluate(() => {
      // Lexical `window` fixture'ı (Page) DOM window'u gölgeliyor — globalThis kullan.
      const w = (globalThis as unknown as Window).open('https://example.com/', '_blank')
      return w === null
    })
    expect(opened).toBe(true)
  })
})
