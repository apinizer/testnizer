import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openNewDropdownItem } from '../helpers/ui/bootstrap'
import { getTestServerUrls } from '../helpers/test-servers'
import { fillMonaco } from '../helpers/ui/monaco'

uiTest.describe('Protocol editors (deep + local servers)', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('WebSocket connect and receive echo', async ({ window }) => {
    const { ws } = getTestServerUrls()
    await openNewDropdownItem(window, /WebSocket/i)
    await window.getByTestId('ws-url').fill(ws)
    await window.getByTestId('ws-connect').click()
    await expect(window.getByTestId('ws-disconnect')).toBeVisible({ timeout: 15_000 })
    await fillMonaco(window, 'ws-composer', '{"ping":1}')
    await window.getByRole('button', { name: /Send Message/i }).click()
    await expect(window.getByText(/echo|welcome/i).first()).toBeVisible({ timeout: 15_000 })
    await window.getByTestId('ws-disconnect').click()
  })

  uiTest('SSE connect receives events', async ({ window }) => {
    const { sse } = getTestServerUrls()
    await openNewDropdownItem(window, /SSE/i)
    await window.getByTestId('sse-url').fill(sse)
    await window.getByTestId('sse-connect').click()
    await expect(window.getByText(/Connected/i).first()).toBeVisible({ timeout: 15_000 })
    await expect(window.getByText(/tick/i).first()).toBeVisible({ timeout: 15_000 })
    await window.getByTestId('sse-disconnect').click()
  })

  uiTest('Socket.IO emit receives echo', async ({ window }) => {
    const { socketio } = getTestServerUrls()
    await openNewDropdownItem(window, /Socket\.IO/i)
    await window.getByTestId('socketio-url').fill(socketio)
    await window.getByTestId('socketio-connect').click()
    await expect(window.getByTestId('socketio-emit')).toBeVisible({ timeout: 15_000 })
    await window.getByPlaceholder(/event/i).first().fill('ping')
    await window.getByTestId('socketio-emit').click()
    await expect(window.getByText(/pong|echo|welcome/i).first()).toBeVisible({ timeout: 15_000 })
  })

  uiTest('GraphQL run query', async ({ window }) => {
    const { graphql } = getTestServerUrls()
    await openNewDropdownItem(window, /GraphQL/i)
    await window.getByTestId('graphql-url').fill(graphql)
    await fillMonaco(window, 'graphql-query-editor', '{ hello(name: "E2E") }')
    await window.getByTestId('graphql-run').click()
    await expect(window.getByText(/Hello E2E|hello/i).first()).toBeVisible({ timeout: 15_000 })
  })

  uiTest('GraphQL introspect', async ({ window }) => {
    const { graphql } = getTestServerUrls()
    await openNewDropdownItem(window, /GraphQL/i)
    await window.getByTestId('graphql-url').fill(graphql)
    await window.getByTestId('graphql-introspect').click()
    await expect(window.getByText(/Query|Schema/i).first()).toBeVisible({ timeout: 15_000 })
  })

  uiTest('gRPC proto from URL loads services', async ({ window }) => {
    const { grpc, http } = getTestServerUrls()
    await openNewDropdownItem(window, /gRPC/i)
    await window.getByTestId('grpc-address').fill(grpc)
    await window.getByRole('button', { name: /From URL/i }).click()
    await window.getByPlaceholder(/example\.com.*proto/i).fill(`${http}/fixtures/echo.proto`)
    await window.getByRole('button', { name: /Load from URL/i }).click()
    await expect(window.getByTestId('grpc-execute')).toBeEnabled({ timeout: 15_000 })
  })

  uiTest('MCP connect and invoke echo tool', async ({ window }) => {
    const { mcp } = getTestServerUrls()
    await openNewDropdownItem(window, /MCP/i)
    await window.getByTestId('mcp-url').fill(mcp)
    await window.getByTestId('mcp-connect').click()
    await expect(window.getByTestId('mcp-connect')).toHaveText('Disconnect', { timeout: 15_000 })
    await expect(window.getByText(/Tools \(2\)/)).toBeVisible({ timeout: 15_000 })
    await window.getByTestId('mcp-tool-echo').click()
    await window.getByTestId('mcp-invoke').click()
    await expect(window.getByText(/"type":\s*"text"/i).first()).toBeVisible({ timeout: 10_000 })
  })
})
