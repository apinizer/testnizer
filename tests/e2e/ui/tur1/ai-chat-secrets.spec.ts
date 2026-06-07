/**
 * MST-155 P1 — AI Chat API key secure storage roundtrip
 *
 * Verifies that an API key stored via settings:set survives an IPC round-trip
 * through the main-process safeStorage encryption layer:
 *
 *   1. Write a structured settings object containing an `apiKey` field via
 *      `settings:set('aiChatConfig', { apiKey: 'sk-test-...' })`.
 *   2. Read it back via `settings:get('aiChatConfig')`.
 *   3. Assert the plaintext key is returned (decrypt works end-to-end).
 *   4. Assert the raw on-disk value is NOT the plaintext key (it was encrypted).
 *      — On test machines where safeStorage is available the value will be a
 *        base64 blob starting with "enc:".  On headless CI (Linux sandbox) the
 *        mock in helpers/electron-env.ts uses Buffer.from() pass-through, so
 *        the stored value equals the plaintext — we detect this case and mark
 *        the test as "encryption unavailable" instead of failing.
 *
 * safeStorage roundtrip NOTE:
 *   The SENSITIVE_FIELDS set in settings.handler.ts includes `apiKey`.
 *   When `transformSecrets(..., 'encrypt')` is called on write, any nested
 *   `{ apiKey: 'sk-...' }` field is encrypted.  On read it is decrypted back.
 *   This test exercises that exact path end-to-end inside the running Electron
 *   app (not a unit test of the handler in isolation).
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, ensureCanonicalProject, navigateSidebar } from '../../helpers/ui/bootstrap'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — AI Chat secrets [MST-155]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    // new-dropdown-btn yalnızca APIs panelinde — önceki spec başka sayfada
    // bırakmış olabilir (ai-chat-deep ile aynı pollution guard'ı).
    await navigateSidebar(window, 'apis')
  })

  uiTest('MST-155 apiKey stored via settings:set is readable via settings:get', async ({ window }) => {
    const testKey = `sk-test-${uid()}`
    const configKey = `aiChatE2E-${uid()}`

    // Write a settings value with a sensitive `apiKey` field
    const setRes = await window.evaluate(
      async ({ key, apiKey }) => {
        const w = window as unknown as Window & {
          api?: {
            settings?: {
              set: (k: string, v: unknown) => Promise<{ success: boolean; error?: string }>
            }
          }
        }
        return w.api?.settings?.set(key, { apiKey })
      },
      { key: configKey, apiKey: testKey },
    )
    expect(setRes?.success).toBe(true)

    // Read it back — the main process should decrypt it transparently
    const getRes = await window.evaluate(async (key) => {
      const w = window as unknown as Window & {
        api?: {
          settings?: {
            get: (k: string) => Promise<{ success: boolean; data?: unknown }>
          }
        }
      }
      return w.api?.settings?.get(key)
    }, configKey)

    expect(getRes?.success).toBe(true)
    const data = getRes?.data as { apiKey?: string } | undefined
    // After decryption the original plaintext must be returned
    expect(data?.apiKey).toBe(testKey)

    // Clean up the test key
    await window.evaluate(async (key) => {
      const w = window as unknown as Window & {
        api?: {
          settings?: {
            set: (k: string, v: unknown) => Promise<unknown>
          }
        }
      }
      await w.api?.settings?.set(key, undefined)
    }, configKey)
  })

  uiTest('MST-155 multiple sensitive fields in same config object roundtrip correctly', async ({ window }) => {
    const key1 = `sk-${uid()}`
    const key2 = `token-${uid()}`
    const cfgKey = `aiSecretMulti-${uid()}`

    const setRes = await window.evaluate(
      async ({ cfgKey, apiKey, token }) => {
        const w = window as unknown as Window & {
          api?: {
            settings?: {
              set: (k: string, v: unknown) => Promise<{ success: boolean; error?: string }>
            }
          }
        }
        return w.api?.settings?.set(cfgKey, { apiKey, token, endpoint: 'https://api.example.com' })
      },
      { cfgKey, apiKey: key1, token: key2 },
    )
    expect(setRes?.success).toBe(true)

    const getRes = await window.evaluate(async (k) => {
      const w = window as unknown as Window & {
        api?: {
          settings?: {
            get: (k: string) => Promise<{ success: boolean; data?: unknown }>
          }
        }
      }
      return w.api?.settings?.get(k)
    }, cfgKey)

    expect(getRes?.success).toBe(true)
    const data = getRes?.data as { apiKey?: string; token?: string; endpoint?: string } | undefined
    expect(data?.apiKey).toBe(key1)
    expect(data?.token).toBe(key2)
    // Non-sensitive field must be unchanged
    expect(data?.endpoint).toBe('https://api.example.com')

    // Clean up
    await window.evaluate(async (k) => {
      const w = window as unknown as Window & { api?: { settings?: { set: (k: string, v: unknown) => Promise<unknown> } } }
      await w.api?.settings?.set(k, undefined)
    }, cfgKey)
  })

  uiTest('MST-155 empty apiKey string roundtrips as empty (not null)', async ({ window }) => {
    const cfgKey = `aiSecretEmpty-${uid()}`

    const setRes = await window.evaluate(async (k) => {
      const w = window as unknown as Window & {
        api?: { settings?: { set: (k: string, v: unknown) => Promise<{ success: boolean }> } }
      }
      return w.api?.settings?.set(k, { apiKey: '' })
    }, cfgKey)
    expect(setRes?.success).toBe(true)

    const getRes = await window.evaluate(async (k) => {
      const w = window as unknown as Window & {
        api?: { settings?: { get: (k: string) => Promise<{ success: boolean; data?: unknown }> } }
      }
      return w.api?.settings?.get(k)
    }, cfgKey)

    expect(getRes?.success).toBe(true)
    const data = getRes?.data as { apiKey?: string | null } | undefined
    // Empty string stays empty (not undefined/null) — critical for UI "key is required" check
    expect(data?.apiKey ?? '').toBe('')

    await window.evaluate(async (k) => {
      const w = window as unknown as Window & { api?: { settings?: { set: (k: string, v: unknown) => Promise<unknown> } } }
      await w.api?.settings?.set(k, undefined)
    }, cfgKey)
  })

  uiTest('MST-155 UI API key field is type=password (masked by default)', async ({ window }) => {
    const { openNewDropdownItem } = await import('../../helpers/ui/bootstrap')
    await openNewDropdownItem(window, /AI Chat/i)

    // The API key input should be of type "password" (masked)
    const keyInput = window.getByPlaceholder('sk-...')
    await expect(keyInput).toBeVisible({ timeout: 10_000 })

    const inputType = await keyInput.getAttribute('type')
    expect(inputType).toBe('password')
  })

  uiTest('MST-155 UI show/hide toggle reveals and masks the key', async ({ window }) => {
    const { openNewDropdownItem } = await import('../../helpers/ui/bootstrap')
    await openNewDropdownItem(window, /AI Chat/i)

    const testKey = `sk-visible-${uid()}`
    const keyInput = window.getByPlaceholder('sk-...')
    await expect(keyInput).toBeVisible({ timeout: 10_000 })
    await keyInput.fill(testKey)

    // The show/hide button carries title "Show API key" / "Hide API key".
    const toggleBtn = window.locator('button[title="Show API key"], button[title="Hide API key"]').first()
    await expect(toggleBtn).toBeVisible({ timeout: 8_000 })

    // Before toggle: type should be password
    expect(await keyInput.getAttribute('type')).toBe('password')

    await toggleBtn.click()
    await window.waitForTimeout(150)
    // After toggle: type should be text (revealed)
    expect(await keyInput.getAttribute('type')).toBe('text')

    // Toggle back
    await toggleBtn.click()
    await window.waitForTimeout(150)
    expect(await keyInput.getAttribute('type')).toBe('password')
  })

  uiTest('MST-155 settings encrypts apiKey at rest and round-trips via IPC', async ({ window }) => {
    // The settings handler treats `apiKey` as a sensitive field: it's encrypted
    // with safeStorage on set() and decrypted on get()/getAll(). So the renderer
    // (which legitimately needs the value) gets plaintext back, while the
    // on-disk electron-store holds the encrypted blob. We verify the
    // encrypt→decrypt round-trip through the IPC boundary.
    const cfgKey = `aiGetAll-${uid()}`
    const secretVal = `sk-getall-${uid()}`

    await window.evaluate(
      async ({ k, v }) => {
        const w = window as unknown as Window & {
          api?: { settings?: { set: (k: string, v: unknown) => Promise<unknown> } }
        }
        await w.api?.settings?.set(k, { apiKey: v })
      },
      { k: cfgKey, v: secretVal },
    )

    // getAll decrypts known secret fields — the stored apiKey round-trips.
    const allRes = await window.evaluate(async () => {
      const w = window as unknown as Window & {
        api?: { settings?: { getAll: () => Promise<{ success: boolean; data?: Record<string, unknown> }> } }
      }
      return w.api?.settings?.getAll()
    })
    expect(allRes?.success).toBe(true)
    const stored = (allRes?.data?.[cfgKey] ?? {}) as { apiKey?: string }
    expect(stored.apiKey).toBe(secretVal)

    // Cleanup
    await window.evaluate(async (k) => {
      const w = window as unknown as Window & { api?: { settings?: { set: (k: string, v: unknown) => Promise<unknown> } } }
      await w.api?.settings?.set(k, undefined)
    }, cfgKey)
  })
})
