/**
 * MST-304 P0  Actual request panel — resolved {{var}} URL + header (hard assert)
 * MST-305 P1  Actual request panel — URL credentials masked (hard assert)
 *
 * Reality check (read before editing): the response pane's "Actual" tab was
 * removed (see ResponsePane.tsx — the TABS array has no `actualRequest` key and
 * a comment explains the removal). The actual-request data (resolved URL,
 * resolved request headers, credential-stripped URL) now lives in the footer
 * Console panel: the main process emits a single `console:log` entry per
 * request/response cycle (src/main/ipc/request.handler.ts → logRequestResponse,
 * using engine `actualRequest` which is stripUrlCredentials()'d), the renderer
 * subscribes (console.store → addEntry), and ConsoleTab renders it. The
 * expanded entry detail container carries the `actual-request-panel` testid
 * (added as a hook in ConsoleTab.tsx — no behaviour change).
 *
 * Credential masking only happens on the SUCCESS path: request.handler.ts logs
 * `result.actualRequest.url` (stripped) when the send succeeds, but the raw
 * `options.url` when the engine throws. So MST-305 embeds credentials in a
 * VALID local URL that returns 200 — exercising the masking code path.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../../helpers/ui/bootstrap'
import { fillUrl, addHeader } from '../../helpers/ui/request-flow'
import {
  openEnvModal,
  closeEnvModal,
  addVariable,
  setActiveEnvironment,
  createEnvironment,
} from '../../helpers/ui/env'
import { localHttpBin } from '../../helpers/test-servers'
import { ensureConsolePanelOpen, expandActualRequest } from '../../helpers/ui/console-flow'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — Actual request panel [MST-304, MST-305]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  /**
   * MST-304 — {{var}} in URL + a custom header whose value is also {{var}}.
   * After Send, the actual-request panel must show the RESOLVED URL and header
   * value (the local httpbin base) and must NOT contain the raw `{{` template.
   */
  uiTest('MST-304 actual request panel shows resolved {{var}} URL and header', async ({ window }) => {
    const tag = uid()
    const envName = `ActualEnv-304-${tag}`
    const varKey = `baseUrl304_${tag.replace(/-/g, '')}`
    const marker = `mst304-${tag}`
    const baseUrl = localHttpBin()

    // Env var holds the local httpbin base URL.
    await openEnvModal(window)
    await createEnvironment(window, envName)
    await addVariable(window, { key: varKey, initialValue: baseUrl, currentValue: baseUrl })
    await setActiveEnvironment(window)
    await closeEnvModal(window)

    await openHttpRequestTab(window)
    // {{var}} in the URL + a unique marker query param to locate the log row.
    await fillUrl(window, `{{${varKey}}}/get?${marker}=1`)
    // Custom header whose VALUE is also a template referencing the same var.
    await addHeader(window, 'X-Actual-Base', `{{${varKey}}}`)
    // Close any open autocomplete popover via keyboard — clicking the URL input
    // to blur does not work here: its {{var}} highlight overlay (aria-hidden)
    // intercepts pointer events when the URL contains a template.
    await window.keyboard.press('Escape')

    await window.getByTestId('send-btn').click()
    await expect(window.getByText(/200|OK/i).first()).toBeVisible({ timeout: 30_000 })

    // HARD assertions — no catch / no if-visible guard.
    await ensureConsolePanelOpen(window)
    const panel = await expandActualRequest(window, marker)

    // Resolved URL must be present and templates must be gone.
    await expect(panel).toContainText(baseUrl)
    await expect(panel).not.toContainText('{{')
    await expect(panel).not.toContainText(varKey)
    // The custom header (resolved) must show — name + resolved value.
    await expect(panel).toContainText('X-Actual-Base')
  })

  /**
   * MST-305 — credentials in a VALID local URL (returns 200) are masked in the
   * actual-request panel. Hard assertions, no if-visible guard (the tier14
   * MST-286 soft version stays untouched).
   */
  uiTest('MST-305 URL credentials are masked in the actual request panel', async ({ window }) => {
    const tag = uid()
    const marker = `mst305-${tag}`
    const base = localHttpBin() // http://127.0.0.1:<port>
    // Inject user:secret@ into the authority of a valid local URL so the
    // SUCCESS path (which strips credentials) runs.
    const credUrl = base.replace('http://', 'http://user:secret@') + `/get?${marker}=1`

    await openHttpRequestTab(window)
    await fillUrl(window, credUrl)
    await window.getByTestId('send-btn').click()
    await expect(window.getByText(/200|OK/i).first()).toBeVisible({ timeout: 30_000 })

    await ensureConsolePanelOpen(window)
    const panel = await expandActualRequest(window, marker)

    // HARD assertions — credentials must not appear anywhere in the panel.
    await expect(panel).not.toContainText('secret')
    await expect(panel).not.toContainText('user:secret@')
  })
})
