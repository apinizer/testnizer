/**
 * MST-155 P1 — AI Chat API key storage (issue #188)
 *
 * The real path, end to end:
 *   1. A key typed into the AI Chat tab's API key field is NOT written to the
 *      renderer's localStorage snapshot (`testnizer-ai-chat`).
 *   2. Main stores it in the `settings` electron-store under `aiChatApiKeys`,
 *      one entry per provider, encrypted with safeStorage (`enc:v1:` blob).
 *      The generic `settings:get` does not decrypt it — the renderer sees
 *      ciphertext only.
 *   3. After a full renderer reload a new AI Chat tab for the same provider
 *      gets the key back from main.
 *
 * Machines without safeStorage encryption (headless Linux CI without
 * libsecret): nothing is written to disk and the editor shows the
 * "kept in memory only" note — the test asserts that branch instead.
 *
 * The earlier version of this spec wrote a made-up `aiChatConfig` settings
 * key that AI Chat never used, so it stayed green while the real key sat in
 * plain text in localStorage.
 */
import { expect, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  bootstrapWorkbench,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openNewDropdownItem,
  waitForApiBridge,
} from '../../helpers/ui/bootstrap'

const uid = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

const STORAGE_KEY = 'testnizer-ai-chat'
const KEYS_SETTING = 'aiChatApiKeys'

async function readStoredKeys(window: Page): Promise<Record<string, unknown>> {
  return window.evaluate(async (k) => {
    const w = window as unknown as {
      api: { settings: { get: (key: string) => Promise<{ success: boolean; data?: unknown }> } }
    }
    const res = await w.api.settings.get(k)
    return (res?.data && typeof res.data === 'object' ? res.data : {}) as Record<string, unknown>
  }, KEYS_SETTING)
}

async function openAiTab(window: Page): Promise<void> {
  await openNewDropdownItem(window, /AI Chat/i)
  await expect(window.getByTestId('ai-api-key')).toBeVisible({ timeout: 10_000 })
}

uiTest.describe('Tur1 — AI Chat secrets [MST-155]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    // new-dropdown-btn yalnızca APIs panelinde — önceki spec başka sayfada
    // bırakmış olabilir (ai-chat-deep ile aynı pollution guard'ı).
    await navigateSidebar(window, 'apis')
  })

  uiTest(
    'MST-155 key typed in the AI tab: not in localStorage, encrypted in settings, back after reload',
    async ({ window }) => {
      const testKey = `sk-e2e-${uid()}`
      await openAiTab(window)
      const keyInput = window.getByTestId('ai-api-key')
      await keyInput.fill(testKey)

      // (1) localStorage never holds the key — not even after the snapshot
      // has been rewritten by later edits.
      await window.getByPlaceholder(/guide the assistant|asistanın|asistanin/i).fill('be brief')
      const snapshot = await window.evaluate((k) => localStorage.getItem(k) ?? '', STORAGE_KEY)
      expect(snapshot).not.toContain(testKey)

      // (2) main's encrypted store (debounced write, 500 ms).
      const memoryNote = window.getByTestId('ai-key-memory-note')
      await expect
        .poll(
          async () => {
            const stored = await readStoredKeys(window)
            return typeof stored.openai === 'string' || (await memoryNote.isVisible())
          },
          { timeout: 10_000 },
        )
        .toBe(true)

      const stored = await readStoredKeys(window)
      const encryptionAvailable = typeof stored.openai === 'string'
      if (encryptionAvailable) {
        const blob = stored.openai as string
        expect(blob.startsWith('enc:v1:')).toBe(true)
        expect(blob).not.toContain(testKey)
      } else {
        // No safeStorage: nothing on disk, the user is told.
        expect(stored.openai).toBeUndefined()
        await expect(memoryNote).toBeVisible()
      }

      // (3) survives a full renderer reload (only when it was stored).
      await window.reload()
      await window.waitForLoadState('domcontentloaded')
      await waitForApiBridge(window)
      await bootstrapWorkbench(window)
      await dismissOverlays(window)
      await ensureCanonicalProject(window)
      await navigateSidebar(window, 'apis')

      const afterReload = await window.evaluate((k) => localStorage.getItem(k) ?? '', STORAGE_KEY)
      expect(afterReload).not.toContain(testKey)

      await openAiTab(window)
      if (encryptionAvailable) {
        await expect(window.getByTestId('ai-api-key')).toHaveValue(testKey, { timeout: 10_000 })
        // Clean up: clearing the field removes the stored entry.
        await window.getByTestId('ai-api-key').fill('')
        await expect
          .poll(async () => (await readStoredKeys(window)).openai, { timeout: 10_000 })
          .toBeUndefined()
      } else {
        await expect(window.getByTestId('ai-api-key')).toHaveValue('')
      }
    },
  )

  uiTest('MST-155 UI API key field is type=password (masked by default)', async ({ window }) => {
    await openAiTab(window)
    const keyInput = window.getByPlaceholder('sk-...')
    await expect(keyInput).toBeVisible({ timeout: 10_000 })
    expect(await keyInput.getAttribute('type')).toBe('password')
  })

  uiTest('MST-155 UI show/hide toggle reveals and masks the key', async ({ window }) => {
    await openAiTab(window)

    const keyInput = window.getByPlaceholder('sk-...')
    await expect(keyInput).toBeVisible({ timeout: 10_000 })
    await keyInput.fill(`sk-visible-${uid()}`)

    // The show/hide button carries title "Show API key" / "Hide API key".
    const toggleBtn = window
      .locator('button[title="Show API key"], button[title="Hide API key"]')
      .first()
    await expect(toggleBtn).toBeVisible({ timeout: 8_000 })

    expect(await keyInput.getAttribute('type')).toBe('password')
    await toggleBtn.click()
    await expect(keyInput).toHaveAttribute('type', 'text')
    await toggleBtn.click()
    await expect(keyInput).toHaveAttribute('type', 'password')

    // Do not leave a stored key behind for later specs.
    await keyInput.fill('')
  })
})
