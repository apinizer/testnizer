/**
 * MST-114..150 — Protocol advanced journeys (WS, SSE, GQL, gRPC, Socket.IO, MCP)
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openNewDropdownItem } from '../../helpers/ui/bootstrap'
import { getTestServerUrls } from '../../helpers/test-servers'
import { fillMonaco } from '../../helpers/ui/monaco'

uiTest.describe('Tier 12 — Protocol advanced [MST-114..150]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('MST-114 WebSocket connect + text echo', async ({ window }) => {
    const { ws } = getTestServerUrls()
    await openNewDropdownItem(window, /WebSocket/i)
    await window.getByTestId('ws-url').fill(ws)
    await window.getByTestId('ws-connect').click()
    await expect(window.getByTestId('ws-disconnect')).toBeVisible({ timeout: 15_000 })
    await fillMonaco(window, 'ws-composer', '{"msg":"tier12-ws"}')
    await window.getByTestId('ws-send').click()
    await expect(window.getByText(/tier12-ws/).first()).toBeVisible({ timeout: 15_000 })
    await window.getByTestId('ws-disconnect').click()
  })

  uiTest('MST-122 SSE connect receives tick events', async ({ window }) => {
    const { sse } = getTestServerUrls()
    await openNewDropdownItem(window, /SSE/i)
    await window.getByTestId('sse-url').fill(sse)
    await window.getByTestId('sse-connect').click()
    await expect(window.getByText(/tick/i).first()).toBeVisible({ timeout: 15_000 })
    await window.getByTestId('sse-disconnect').click()
  })

  uiTest('MST-127 GraphQL query execute', async ({ window }) => {
    const { graphql } = getTestServerUrls()
    await openNewDropdownItem(window, /GraphQL/i)
    await window.getByTestId('graphql-url').fill(graphql)
    await fillMonaco(window, 'graphql-query-editor', '{ hello(name: "MST127") }')
    await window.getByTestId('graphql-run').click()
    await expect(window.getByText(/MST127|hello/i).first()).toBeVisible({ timeout: 15_000 })
  })

  uiTest('MST-132 gRPC unary invoke', async ({ window }) => {
    const { grpc, http } = getTestServerUrls()
    await openNewDropdownItem(window, /gRPC/i)
    await window.getByTestId('grpc-address').fill(grpc)
    await window.getByRole('button', { name: /From URL/i }).click()
    await window.getByPlaceholder(/example\.com.*proto/i).fill(`${http}/fixtures/echo.proto`)
    await window.getByRole('button', { name: /Load from URL/i }).click()
    await expect(window.getByTestId('grpc-method-select')).toHaveValue(/UnaryEcho/i, { timeout: 15_000 })
    await fillMonaco(window, 'grpc-request-editor', '{"message":"tier12-grpc"}')
    await window.getByTestId('grpc-execute').click()
    await expect(window.getByTestId('grpc-response-status')).toContainText(/OK/i, { timeout: 20_000 })
  })

  uiTest('MST-141 Socket.IO connect + emit echo', async ({ window }) => {
    const { socketio } = getTestServerUrls()
    await openNewDropdownItem(window, /Socket\.IO/i)
    await window.getByTestId('socketio-url').fill(socketio)
    await window.getByTestId('socketio-connect').click()
    await expect(window.getByTestId('socketio-emit')).toBeVisible({ timeout: 15_000 })
    await window.getByPlaceholder(/event/i).first().fill('ping')
    await window.getByTestId('socketio-emit').click()
    await expect(window.getByText(/pong|echo|welcome/i).first()).toBeVisible({ timeout: 15_000 })
  })

  uiTest('MST-146 MCP HTTP connect + callTool', async ({ window }) => {
    const { mcp } = getTestServerUrls()
    await openNewDropdownItem(window, /MCP/i)
    await window.getByTestId('mcp-url').fill(mcp)
    await window.getByTestId('mcp-connect').click()
    await expect(window.getByTestId('mcp-connect')).toHaveText('Disconnect', { timeout: 15_000 })
    await window.getByTestId('mcp-tool-echo').click()
    await window.getByTestId('mcp-invoke').click()
    await expect(window.getByText(/"type":\s*"text"/i).first()).toBeVisible({ timeout: 10_000 })
  })
})
