/**
 * Tester finding 10 — Cmd/Ctrl+Enter did not run a GraphQL query. The chord's
 * one dispatch (`run-active-request.ts`) sent every non-MCP tab through the
 * HTTP request store, and with the cursor in the query editor Monaco took the
 * chord for "insert line below" and stopped it before the window listener.
 *
 * Against the local e2e GraphQL server (`tests/e2e/servers/graphql-server.ts`:
 * `hello(name)` + `echo(input)`) and the local HTTP echo server — no outside
 * network: Run a two-field query, drop a field, press the chord with the
 * cursor in the query editor, and the response changes (and the query gains
 * no line). The palette's Send does the same. On an HTTP tab the chord in the
 * URL field still sends.
 */
import { expect, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  commandPaletteInput,
  dismissOverlays,
  ensureCanonicalProject,
  expectNoErrorBoundary,
  navigateSidebar,
  openCommandPalette,
  openHttpRequestTab,
  openNewDropdownItem,
} from '../helpers/ui/bootstrap'
import { getTestServerUrls, localHttpBin } from '../helpers/test-servers'
import { fillMonaco, monacoEditor } from '../helpers/ui/monaco'
import { pressModShortcut } from '../helpers/ui/keyboard'

const SHOTS = 'test-results/screens'

/** The GraphQL response body (scoped: Generate Code is a read-only editor too). */
function gqlResponse(window: Page) {
  return window.getByTestId('graphql-response-body')
}

/** Put the caret at the end of the query, inside Monaco — the reported repro. */
async function caretInQueryEditor(window: Page): Promise<void> {
  await monacoEditor(window, 'graphql-query-editor').locator('.view-lines').click()
  await window.keyboard.press('End')
}

uiTest.describe('Tester finding 10 — Cmd/Ctrl+Enter runs the active protocol', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
    await closeAllTabs(window)
  })

  uiTest.afterEach(async ({ window }) => {
    await closeAllTabs(window).catch(() => {})
  })

  uiTest('GraphQL: the chord in the query editor runs the query', async ({ window }) => {
    const { graphql } = getTestServerUrls()
    await openNewDropdownItem(window, /GraphQL/i)
    await window.getByTestId('graphql-url').fill(graphql)

    // 1. Send with the button: both fields come back.
    await fillMonaco(window, 'graphql-query-editor', '{ hello(name: "Mod") echo(input: "two") }')
    await window.getByTestId('graphql-run').click()
    await expect(gqlResponse(window)).toContainText('Hello Mod', { timeout: 15_000 })
    await expect(gqlResponse(window)).toContainText('echo')
    await window.screenshot({ path: `${SHOTS}/74-graphql-run-button.png` })

    // 2. Drop a field, caret in the editor, chord: only `hello` comes back.
    await fillMonaco(window, 'graphql-query-editor', '{ hello(name: "Chord") }')
    await caretInQueryEditor(window)
    await pressModShortcut(window, 'Enter')
    await expect(gqlResponse(window)).toContainText('Hello Chord', { timeout: 15_000 })
    await expect(gqlResponse(window)).not.toContainText('echo')
    // Monaco's own Ctrl/Cmd+Enter (insert line below) did not run as well.
    await expect(monacoEditor(window, 'graphql-query-editor').locator('.view-line')).toHaveCount(1)
    // No HTTP send of a stale slice: an HTTP response pane never appeared.
    await expect(window.getByTestId('res-tab-body')).toHaveCount(0)
    await window.screenshot({ path: `${SHOTS}/74-graphql-mod-enter.png` })

    // 3. The palette's Send is the same dispatch.
    await fillMonaco(window, 'graphql-query-editor', '{ echo(input: "palette") }')
    await openCommandPalette(window)
    await commandPaletteInput(window).fill('Send request')
    // By label: Enter would run whatever ranks first for the typed text.
    await window
      .getByTestId('command-palette')
      .locator('[cmdk-item]')
      .filter({ hasText: /^Send request/ })
      .first()
      .click()
    await expect(gqlResponse(window)).toContainText('palette', { timeout: 15_000 })
    await expect(gqlResponse(window)).not.toContainText('Hello')
    await window.screenshot({ path: `${SHOTS}/74-graphql-palette-send.png` })
    await expectNoErrorBoundary(window)
  })

  uiTest('HTTP: the chord in the URL field still sends', async ({ window }) => {
    await openHttpRequestTab(window)
    const url = window.getByTestId('url-input')
    await url.click()
    await url.fill(`${localHttpBin()}/get?probe=mod-enter`)
    await pressModShortcut(window, 'Enter')

    const body = window.getByTestId('res-tab-body')
    const failed = window.getByTestId('response-error')
    await expect(body.or(failed)).toBeVisible({ timeout: 30_000 })
    await expect(failed).toHaveCount(0)
    await expect(window.getByTestId('response-status')).toContainText('200')
    await expect(window.getByText('mod-enter').first()).toBeVisible({ timeout: 10_000 })
    await window.screenshot({ path: `${SHOTS}/74-http-mod-enter.png` })
    await expectNoErrorBoundary(window)
  })
})
