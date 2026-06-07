/**
 * MST-301 P0  Headers key autocomplete
 * MST-302 P0  Headers value autocomplete (Content-Type values)
 * MST-303 P1  Headers value variable autocomplete ({{env var}})
 *
 * Covers the KeyValueTable autocomplete UX in the Headers tab:
 *   • Key column: prefix/substring match against STANDARD_HTTP_HEADERS
 *     (lib/http-headers.ts → filterHeaderSuggestions). Panel + items carry
 *     data-testid="kv-autocomplete" / "kv-autocomplete-item".
 *   • Value column: context-sensitive header-value list
 *     (filterHeaderValueSuggestions) shown via the same portal.
 *   • Value column: {{var}} expression triggers VariableAutocompleteInput's
 *     own portal (data-testid="var-autocomplete" + [data-suggestion-item]),
 *     listing active-environment variables.
 *
 * Worker-shared Electron: unique names (uid), all locators scoped to the
 * autocomplete portals or the active row — no global getByText.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../../helpers/ui/bootstrap'
import {
  openEnvModal,
  closeEnvModal,
  addVariable,
  setActiveEnvironment,
  createEnvironment,
} from '../../helpers/ui/env'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — Headers autocomplete [MST-301, MST-302, MST-303]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  /**
   * MST-301 — Key column autocomplete.
   * Type "cont" in an empty header key cell → suggestion panel appears →
   * click the "Content-Type" suggestion → the key input value becomes
   * exactly "Content-Type".
   */
  uiTest('MST-301 key column suggests and applies a standard header name', async ({ window }) => {
    await openHttpRequestTab(window)
    await window.getByTestId('req-tab-headers').click()

    // Ensure at least one editable row exists (the first row may be empty
    // already, but adding is idempotent for the test's purposes).
    const firstRow = window.getByTestId('kv-row-0')
    if (!(await firstRow.isVisible().catch(() => false))) {
      await window.getByTestId('kv-add-row').click()
    }

    const keyInput = firstRow.getByTestId('kv-key')
    await keyInput.click()
    await keyInput.fill('cont')

    // Suggestion portal must appear and contain a Content-Type entry.
    const panel = window.getByTestId('kv-autocomplete')
    await expect(panel).toBeVisible({ timeout: 5_000 })
    const item = panel.getByTestId('kv-autocomplete-item').filter({ hasText: 'Content-Type' })
    await expect(item.first()).toBeVisible({ timeout: 5_000 })

    // Items use onMouseDown — dispatch a real click after ensuring visibility.
    await item.first().scrollIntoViewIfNeeded()
    await item.first().dispatchEvent('mousedown')

    await expect(keyInput).toHaveValue('Content-Type', { timeout: 5_000 })
    await expect(panel).toBeHidden({ timeout: 5_000 })
  })

  /**
   * MST-302 — Value column autocomplete for a recognised header.
   * With key=Content-Type, focusing the empty value cell surfaces the full
   * value list (incl. application/json). Typing "json" filters the list; a
   * selection fills the value.
   */
  uiTest('MST-302 value column suggests Content-Type values and filters on type', async ({ window }) => {
    await openHttpRequestTab(window)
    await window.getByTestId('req-tab-headers').click()

    const firstRow = window.getByTestId('kv-row-0')
    if (!(await firstRow.isVisible().catch(() => false))) {
      await window.getByTestId('kv-add-row').click()
    }

    // Set the key to a header that has value suggestions.
    const keyInput = firstRow.getByTestId('kv-key')
    await keyInput.click()
    await keyInput.fill('Content-Type')
    // The key-name popup may show; dismiss it so it doesn't shadow the value
    // popup assertions.
    await window.keyboard.press('Escape')

    // Focus the (empty) value cell → full Content-Type value list appears.
    const valueInput = firstRow.getByTestId('kv-value').locator('input')
    await valueInput.click()

    const panel = window.getByTestId('kv-autocomplete')
    await expect(panel).toBeVisible({ timeout: 5_000 })
    await expect(
      panel.getByTestId('kv-autocomplete-item').filter({ hasText: 'application/json' }).first(),
    ).toBeVisible({ timeout: 5_000 })

    // Type "json" → the list filters down to json-bearing values.
    await valueInput.fill('json')
    await expect(panel).toBeVisible({ timeout: 5_000 })
    const jsonItem = panel.getByTestId('kv-autocomplete-item').filter({ hasText: 'application/json' })
    await expect(jsonItem.first()).toBeVisible({ timeout: 5_000 })
    // "text/plain" (no "json") must be filtered out of the panel.
    await expect(
      panel.getByTestId('kv-autocomplete-item').filter({ hasText: 'text/plain' }),
    ).toHaveCount(0)

    // Select the suggestion → value cell fills with the full token.
    await jsonItem.first().scrollIntoViewIfNeeded()
    await jsonItem.first().dispatchEvent('mousedown')

    await expect(valueInput).toHaveValue('application/json', { timeout: 5_000 })
  })

  /**
   * MST-303 — Variable autocomplete in the value column.
   * After creating + activating an environment variable, typing "{{" in the
   * value cell shows the variable autocomplete (VariableAutocompleteInput);
   * selecting the variable inserts "{{varName}}".
   */
  uiTest('MST-303 value column {{ triggers active-environment variable autocomplete', async ({ window }) => {
    const tag = uid()
    const envName = `EnvHdr-303-${tag}`
    const varKey = `hdrVar303${tag.replace(/[^a-z0-9]/gi, '')}`

    // Create + activate an environment with one variable.
    await openEnvModal(window)
    await createEnvironment(window, envName)
    await addVariable(window, { key: varKey, initialValue: 'application/json', currentValue: 'application/json' })
    await setActiveEnvironment(window)
    await closeEnvModal(window)

    await openHttpRequestTab(window)
    await window.getByTestId('req-tab-headers').click()

    const firstRow = window.getByTestId('kv-row-0')
    if (!(await firstRow.isVisible().catch(() => false))) {
      await window.getByTestId('kv-add-row').click()
    }

    // A neutral key so the value popup isn't a header-value list.
    const keyInput = firstRow.getByTestId('kv-key')
    await keyInput.click()
    await keyInput.fill('X-Custom-303')
    await window.keyboard.press('Escape')

    // Type "{{" in the value cell → VariableAutocompleteInput dropdown opens.
    const valueInput = firstRow.getByTestId('kv-value').locator('input')
    await valueInput.click()
    await valueInput.fill('{{')

    const varPanel = window.getByTestId('var-autocomplete')
    await expect(varPanel).toBeVisible({ timeout: 5_000 })
    const varItem = varPanel.locator('[data-suggestion-item]').filter({ hasText: varKey })
    await expect(varItem.first()).toBeVisible({ timeout: 5_000 })

    // Suggestion items use onMouseDown — dispatch directly to avoid the
    // outside-click handler closing the popup before the click lands.
    await varItem.first().scrollIntoViewIfNeeded()
    await varItem.first().dispatchEvent('mousedown')

    await expect(valueInput).toHaveValue(`{{${varKey}}}`, { timeout: 5_000 })
  })
})
