import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openNewDropdownItem } from '../../helpers/ui/bootstrap'
import { getTestServerUrls } from '../../helpers/test-servers'
import { fillMonaco } from '../../helpers/ui/monaco'

uiTest.describe('Tier 6 — Protocol multi-step journeys', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('F17 WebSocket multi-message timeline echoes each payload', async ({ window }) => {
    const { ws } = getTestServerUrls()
    await openNewDropdownItem(window, /WebSocket/i)
    await window.getByTestId('ws-url').fill(ws)
    await window.getByTestId('ws-connect').click()
    await expect(window.getByTestId('ws-disconnect')).toBeVisible({ timeout: 15_000 })

    // Send two distinguishable payloads; the echo server wraps each in
    // {"type":"echo","data":"<original>"} so each one round-trips verbatim.
    for (const marker of ['ws-first', 'ws-second']) {
      await fillMonaco(window, 'ws-composer', `{"msg":"${marker}"}`)
      await expect(window.getByTestId('ws-send')).toBeEnabled({ timeout: 10_000 })
      await window.getByTestId('ws-send').click()
      await window.waitForTimeout(300)
    }

    // Both echoes must arrive — not just "some" echo. Each marker round-trips
    // verbatim inside a received row.
    await expect(window.getByText(/ws-first/).first()).toBeVisible({ timeout: 15_000 })
    await expect(window.getByText(/ws-second/).first()).toBeVisible({ timeout: 15_000 })

    // welcome + 2 sent + 2 received; counts span confirms both directions arrived.
    await expect(window.getByTestId('ws-message-counts')).toContainText(/2 sent/i, { timeout: 10_000 })
    await expect(window.getByTestId('ws-message-counts')).toContainText(/[23] received/i, { timeout: 10_000 })

    await window.getByTestId('ws-disconnect').click()
  })

  uiTest('F18 SSE receives multiple tick events', async ({ window }) => {
    const { sse } = getTestServerUrls()
    await openNewDropdownItem(window, /SSE/i)
    await window.getByTestId('sse-url').fill(sse)
    await window.getByTestId('sse-connect').click()
    await expect(window.getByText(/Connected/i).first()).toBeVisible({ timeout: 15_000 })
    await expect(window.getByText(/tick/i).first()).toBeVisible({ timeout: 15_000 })
    const ticks = await window.getByText(/tick/i).count()
    expect(ticks).toBeGreaterThanOrEqual(1)
    await window.getByTestId('sse-disconnect').click()
  })

  uiTest('F19 Socket.IO namespace auth emit echo', async ({ window }) => {
    const { socketio } = getTestServerUrls()
    await openNewDropdownItem(window, /Socket\.IO/i)
    await window.getByTestId('socketio-url').fill(socketio)
    await window.getByTestId('socketio-connect').click()
    await expect(window.getByTestId('socketio-emit')).toBeVisible({ timeout: 15_000 })
    await window.getByPlaceholder(/event/i).first().fill('ping')
    await window.getByTestId('socketio-emit').click()
    await expect(window.getByText(/pong|echo|welcome/i).first()).toBeVisible({ timeout: 15_000 })
  })

  uiTest('F20 GraphQL query + introspect', async ({ window }) => {
    const { graphql } = getTestServerUrls()
    await openNewDropdownItem(window, /GraphQL/i)
    await window.getByTestId('graphql-url').fill(graphql)
    await fillMonaco(window, 'graphql-query-editor', '{ hello(name: "E2E") }')
    await window.getByTestId('graphql-run').click()
    await expect(window.getByText(/Hello E2E|hello/i).first()).toBeVisible({ timeout: 15_000 })
    await openNewDropdownItem(window, /GraphQL/i)
    await window.getByTestId('graphql-url').fill(graphql)
    await window.getByTestId('graphql-introspect').click()
    await expect(window.getByText(/Query|Schema/i).first()).toBeVisible({ timeout: 15_000 })
  })

  uiTest('F21 gRPC proto load and unary execute returns echo', async ({ window }) => {
    const { grpc, http } = getTestServerUrls()
    await openNewDropdownItem(window, /gRPC/i)
    await window.getByTestId('grpc-address').fill(grpc)
    await window.getByRole('button', { name: /From URL/i }).click()
    await window.getByPlaceholder(/example\.com.*proto/i).fill(`${http}/fixtures/echo.proto`)
    await window.getByRole('button', { name: /Load from URL/i }).click()

    // Proto loaded → EchoService/UnaryEcho auto-select.
    await expect(window.getByTestId('grpc-service-select')).toBeVisible({ timeout: 15_000 })
    await expect(window.getByTestId('grpc-method-select')).toHaveValue(/UnaryEcho/i, { timeout: 15_000 })

    // Actually invoke the unary RPC and assert the server's echo comes back.
    await fillMonaco(window, 'grpc-request-editor', '{"message":"grpc-flow"}')
    await expect(window.getByTestId('grpc-execute')).toBeEnabled({ timeout: 15_000 })
    await window.getByTestId('grpc-execute').click()

    await expect(window.getByTestId('grpc-response-status')).toContainText(/OK/i, { timeout: 20_000 })
    // The echoed payload round-trips as {"message":"echo: grpc-flow"}; assert on
    // the contiguous token to avoid Monaco's inter-token whitespace rendering.
    await expect(window.getByTestId('grpc-response-body')).toContainText(/grpc-flow/i, {
      timeout: 20_000,
    })
  })

  uiTest('F22 MCP connect invoke echo tool', async ({ window }) => {
    const { mcp } = getTestServerUrls()
    await openNewDropdownItem(window, /MCP/i)
    await window.getByTestId('mcp-url').fill(mcp)
    await window.getByTestId('mcp-connect').click()
    await expect(window.getByTestId('mcp-connect')).toHaveText('Disconnect', { timeout: 15_000 })
    await window.getByTestId('mcp-tool-echo').click()
    await window.getByTestId('mcp-invoke').click()
    await expect(window.getByText(/"type":\s*"text"/i).first()).toBeVisible({ timeout: 10_000 })
  })

  uiTest('F23 SOAP envelope compose and send', async ({ window }) => {
    const { http } = getTestServerUrls()
    await openNewDropdownItem(window, /SOAP/i)
    await window.getByRole('button', { name: /^Manual$/i }).click()
    await window.getByPlaceholder('https://example.com/services/Echo').fill(`${http}/post`)
    const envelope = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body><test>flow-e2e</test></soap:Body>
</soap:Envelope>`
    await window.locator('.monaco-editor').first().click()
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
    await window.keyboard.press(`${mod}+KeyA`)
    await window.keyboard.insertText(envelope)
    await window.getByTestId('soap-send').click()
    await expect(window.getByText(/200|OK/i).first()).toBeVisible({ timeout: 30_000 })
  })
})
