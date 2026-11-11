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
 *
 * Sibling flows, each with the caret inside the protocol's Monaco editor: the
 * HTTP body, the SOAP envelope (HTTP echo `/post`), the WebSocket composer
 * (ws-echo; the chord first connects from the URL field, then sends without
 * disconnecting) and the gRPC message (local EchoService.UnaryEcho). No editor
 * gains a line from Monaco's own Ctrl/Cmd+Enter.
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
import { modKey, pressModShortcut } from '../helpers/ui/keyboard'
import { setBodyType, setHttpMethod } from '../helpers/ui/request-flow'

const SHOTS = 'test-results/screens'

/** The GraphQL response body (scoped: Generate Code is a read-only editor too). */
function gqlResponse(window: Page) {
  return window.getByTestId('graphql-response-body')
}

/** Waits for the HTTP / SOAP response pane, failing with the transport error if one shows. */
async function expectResponse(window: Page, text: string): Promise<void> {
  const body = window.getByTestId('res-tab-body')
  const failed = window.getByTestId('response-error')
  await expect(body.or(failed)).toBeVisible({ timeout: 30_000 })
  await expect(failed).toHaveCount(0)
  await expect(window.getByTestId('response-status')).toContainText('200')
  await body.click()
  await expect(window.getByTestId('res-body-content')).toContainText(text, { timeout: 15_000 })
}

/** Caret at the end of the last line of an editor, then the chord. */
async function chordInEditor(window: Page, editor: ReturnType<typeof monacoEditor>): Promise<void> {
  await editor.locator('.view-lines').click()
  await window.keyboard.press('End')
  await pressModShortcut(window, 'Enter')
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

  uiTest('HTTP: the chord in the body editor sends and adds no line', async ({ window }) => {
    await openHttpRequestTab(window)
    await window.getByTestId('url-input').fill(`${localHttpBin()}/post`)
    await setHttpMethod(window, 'POST')
    await setBodyType(window, 'json', '{"probe":"body-chord"}')
    const editor = monacoEditor(window, 'body-raw-editor')
    await expect(editor.locator('.view-line')).toHaveCount(1)

    await chordInEditor(window, editor)
    await expectResponse(window, 'body-chord')
    await expect(editor.locator('.view-line')).toHaveCount(1)
    await window.screenshot({ path: `${SHOTS}/74-http-body-mod-enter.png` })
    await expectNoErrorBoundary(window)
  })

  uiTest('SOAP: the chord in the envelope editor sends the SOAP request', async ({ window }) => {
    await openNewDropdownItem(window, /SOAP/i)
    await window.getByRole('button', { name: /^Manual$/i }).click()
    await window
      .getByPlaceholder('https://example.com/services/Echo')
      .fill(`${localHttpBin()}/post`)
    await window.getByTestId('soap-detail-tab-body').click()

    // Manual mode has one editable editor: the envelope (the response is read-only).
    const editor = window.locator('[data-monaco-readonly="false"] .monaco-editor').first()
    await editor.click()
    await window.keyboard.press(`${modKey()}+KeyA`)
    await window.keyboard.insertText(
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><t>soap-chord</t></soap:Body></soap:Envelope>',
    )
    await expect(editor.locator('.view-line')).toHaveCount(1)

    await chordInEditor(window, editor)
    await expectResponse(window, 'soap-chord')
    await expect(editor.locator('.view-line')).toHaveCount(1)
    await window.screenshot({ path: `${SHOTS}/74-soap-mod-enter.png` })
    await expectNoErrorBoundary(window)
  })

  uiTest(
    'WebSocket: the chord connects, then sends the composer and stays connected',
    async ({ window }) => {
      const { ws } = getTestServerUrls()
      await openNewDropdownItem(window, /WebSocket/i)
      const url = window.getByTestId('ws-url')
      await url.fill(ws)
      try {
        // Not connected: the chord is Connect (from the URL field — once, not twice).
        await url.click()
        await pressModShortcut(window, 'Enter')
        await expect(window.getByTestId('ws-disconnect')).toBeVisible({ timeout: 15_000 })
        await window.screenshot({ path: `${SHOTS}/74-ws-connect.png` })

        // Connected: the chord in the composer sends the message; ws-echo echoes it.
        await fillMonaco(window, 'ws-composer', '{"probe":"ws-chord"}')
        const editor = monacoEditor(window, 'ws-composer')
        await chordInEditor(window, editor)
        await expect(
          window.locator('[data-testid="ws-message"][data-direction="received"]', {
            hasText: 'ws-chord',
          }),
        ).toHaveCount(1, { timeout: 15_000 })
        await expect(
          window.locator('[data-testid="ws-message"][data-direction="sent"]', {
            hasText: 'ws-chord',
          }),
        ).toHaveCount(1)
        // The send key never disconnects, and the composer gained no line.
        await expect(window.getByTestId('ws-disconnect')).toBeVisible()
        await expect(editor.locator('.view-line')).toHaveCount(1)
        await window.screenshot({ path: `${SHOTS}/74-ws-send.png` })
      } finally {
        await window
          .getByTestId('ws-disconnect')
          .click({ timeout: 2_000 })
          .catch(() => {})
      }
      await expectNoErrorBoundary(window)
    },
  )

  uiTest('gRPC: the chord in the message editor invokes the unary method', async ({ window }) => {
    const { grpc, http } = getTestServerUrls()
    await openNewDropdownItem(window, /gRPC/i)
    await window.getByTestId('grpc-address').fill(grpc)
    await window.getByRole('button', { name: /From URL/i }).click()
    await window.getByPlaceholder(/example\.com.*proto/i).fill(`${http}/fixtures/echo.proto`)
    await window.getByRole('button', { name: /Load from URL/i }).click()
    await expect(window.getByTestId('grpc-execute')).toBeEnabled({ timeout: 15_000 })

    await fillMonaco(window, 'grpc-request-editor', '{"message":"grpc-chord"}')
    const editor = monacoEditor(window, 'grpc-request-editor')
    await chordInEditor(window, editor)
    await expect(window.getByTestId('grpc-response-body')).toContainText('echo: grpc-chord', {
      timeout: 15_000,
    })
    await expect(editor.locator('.view-line')).toHaveCount(1)
    await window.screenshot({ path: `${SHOTS}/74-grpc-mod-enter.png` })
    await expectNoErrorBoundary(window)
  })
})
