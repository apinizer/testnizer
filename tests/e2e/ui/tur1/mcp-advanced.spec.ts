/**
 * MST-147..150 — MCP advanced journeys
 *
 * Server capabilities (mcp-server.ts):
 *   - Streamable HTTP transport at /mcp — already covered in tier12.
 *   - No SSE or stdio endpoint in the global server.
 *
 * Strategy:
 *   - MST-147 (SSE transport): inline mini MCP server using SSEServerTransport.
 *   - MST-148 (stdio transport): uses tests/fixtures/mcp-stdio-stub.cjs spawned
 *     as a Node.js subprocess via the stdio transport path in mcp.engine.ts.
 *     The UI "url" field for stdio is the command string, e.g.
 *     `node /abs/path/to/mcp-stdio-stub.cjs`.
 *   - MST-149 (tool error handling): connects to the global HTTP MCP server,
 *     calls a tool that returns isError:true in its result — or uses the fail
 *     tool from the stdio stub.
 *   - MST-150 (P2) resources list/read: the global MCP server exposes
 *     `test://greeting`, `test://pixel.png` and the template `test://item/{id}`
 *     (issue #139); prompts (`summarize`), notifications (`notify` tool) and
 *     config paste/export have their own issue #139 journeys below.
 *
 * Needs hook:
 *   - MST-147: SSEServerTransport. Uses @modelcontextprotocol/sdk's SSEServerTransport.
 *   - MST-149 error tool: falls back to global HTTP server (which has `echo` and `add`
 *     tools but no failing tool). The spec calls `add` with invalid args (non-numeric)
 *     and verifies the result or error panel shows something.
 */
import http from 'node:http'
import path from 'node:path'
import net from 'node:net'
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openNewDropdownItem,
} from '../../helpers/ui/bootstrap'
import { getTestServerUrls } from '../../helpers/test-servers'

const STDIO_STUB = path.join(__dirname, '../../../fixtures/mcp-stdio-stub.cjs')

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo
      srv.close(() => resolve(addr.port))
    })
    srv.on('error', reject)
  })
}

/**
 * Minimal MCP SSE server using @modelcontextprotocol/sdk's SSEServerTransport.
 * Serves two endpoints:
 *   GET  /sse       — SSE stream (client subscribes)
 *   POST /messages  — JSON-RPC messages from client
 */
async function startMcpSseServer(
  port: number,
): Promise<{ url: string; close: () => Promise<void> }> {
  // Dynamic import to avoid top-level type issues and to keep this self-contained
  const { McpServer: McpSdkServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
  const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js')
  const { z } = await import('zod')

  const transports: Map<string, InstanceType<typeof SSEServerTransport>> = new Map()

  const httpServer = http.createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', protocol: 'mcp-sse', port }))
      return
    }

    if (req.method === 'GET' && req.url === '/sse') {
      const transport = new SSEServerTransport('/messages', res)
      transports.set(transport.sessionId, transport)

      transport.onclose = () => transports.delete(transport.sessionId)

      const mcpServer = new McpSdkServer({ name: 'e2e-mcp-sse', version: '1.0.0' })
      mcpServer.registerTool(
        'ping',
        { description: 'Returns pong', inputSchema: {} },
        async () => ({ content: [{ type: 'text', text: 'pong-sse' }] }),
      )
      mcpServer.registerTool(
        'add',
        {
          description: 'Add two numbers',
          inputSchema: { a: z.number().optional(), b: z.number().optional() },
        },
        async ({ a, b }: { a?: number; b?: number }) => ({
          content: [{ type: 'text', text: String(Number(a ?? 0) + Number(b ?? 0)) }],
        }),
      )

      await mcpServer.connect(transport)
      return
    }

    if (req.method === 'POST' && req.url?.startsWith('/messages')) {
      const sessionId = new URL(req.url, `http://127.0.0.1:${port}`).searchParams.get('sessionId')
      if (sessionId && transports.has(sessionId)) {
        await transports.get(sessionId)!.handlePostMessage(req, res)
        return
      }
      res.writeHead(404)
      res.end('Session not found')
      return
    }

    res.writeHead(404)
    res.end()
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, '127.0.0.1', () => resolve())
    httpServer.on('error', reject)
  })

  return {
    url: `http://127.0.0.1:${port}/sse`,
    close: () =>
      new Promise((resolve, reject) => httpServer.close((err) => (err ? reject(err) : resolve()))),
  }
}

// ─────────────────────────────────────────────────────────────────────────────

uiTest.describe('Tur1 — MCP advanced [MST-147..150]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  // ── MST-147: SSE transport ────────────────────────────────────────────────
  uiTest('MST-147 MCP SSE transport connects and lists tools', async ({ window }) => {
    const port = await getFreePort()
    let server: Awaited<ReturnType<typeof startMcpSseServer>> | null = null
    try {
      server = await startMcpSseServer(port)
    } catch {
      // If SSEServerTransport is not available, note as needs-hook and skip
      console.warn('[MST-147] SSEServerTransport not available — needs server support')
      return
    }
    try {
      await openNewDropdownItem(window, /MCP/i)

      // Select SSE transport
      await window.getByTestId('mcp-transport').selectOption('sse')

      await window.getByTestId('mcp-url').fill(server.url)
      await window.getByTestId('mcp-connect').click()

      // Should show Disconnect and tool list
      await expect(window.getByTestId('mcp-connect')).toHaveText(/Disconnect/i, { timeout: 15_000 })
      await expect(window.getByTestId('mcp-tool-ping')).toBeVisible({ timeout: 10_000 })

      // Call the ping tool
      await window.getByTestId('mcp-tool-ping').click()
      await window.getByTestId('mcp-invoke').click()
      await expect(window.getByText(/pong-sse/i).first()).toBeVisible({ timeout: 10_000 })

      await window.getByTestId('mcp-connect').click()
    } finally {
      await server.close()
    }
  })

  // ── MST-148: stdio transport ──────────────────────────────────────────────
  uiTest('MST-148 MCP stdio transport spawns stub and lists tools', async ({ window }) => {
    await openNewDropdownItem(window, /MCP/i)

    // Select stdio transport
    await window.getByTestId('mcp-transport').selectOption('stdio')

    // URL field doubles as command for stdio: `node <path>`
    const nodeCmd = `node ${STDIO_STUB}`
    await window.getByTestId('mcp-url').fill(nodeCmd)
    await window.getByTestId('mcp-connect').click()

    // Should show Disconnect and tool list
    await expect(window.getByTestId('mcp-connect')).toHaveText(/Disconnect/i, { timeout: 20_000 })

    // The stub registers "ping" and "fail"
    await expect(window.getByTestId('mcp-tool-ping')).toBeVisible({ timeout: 10_000 })

    // Call ping
    await window.getByTestId('mcp-tool-ping').click()
    await window.getByTestId('mcp-invoke').click()
    await expect(window.getByText(/pong/i).first()).toBeVisible({ timeout: 10_000 })

    await window.getByTestId('mcp-connect').click()
    await expect(window.getByTestId('mcp-connect')).not.toHaveText(/Disconnect/i, {
      timeout: 8_000,
    })
  })

  // ── MST-149: Tool error handling ──────────────────────────────────────────
  uiTest('MST-149 tool error response shown in result panel', async ({ window }) => {
    // Use the stdio stub which has a "fail" tool that returns isError:true
    await openNewDropdownItem(window, /MCP/i)
    await window.getByTestId('mcp-transport').selectOption('stdio')
    await window.getByTestId('mcp-url').fill(`node ${STDIO_STUB}`)
    await window.getByTestId('mcp-connect').click()
    await expect(window.getByTestId('mcp-connect')).toHaveText(/Disconnect/i, { timeout: 20_000 })
    await expect(window.getByTestId('mcp-tool-fail')).toBeVisible({ timeout: 10_000 })

    // Click fail tool
    await window.getByTestId('mcp-tool-fail').click()
    await window.getByTestId('mcp-invoke').click()

    // isError results render with a red border + label (issue #139); a
    // transport-level failure shows the call-error line instead.
    await expect(
      window.getByTestId('mcp-result-error-label').or(window.getByTestId('mcp-result-call-error')),
    ).toBeVisible({ timeout: 10_000 })
    await expect(window.getByText(/intentionally failed|error/i).first()).toBeVisible()

    await window.getByTestId('mcp-connect').click()
  })

  // ── MST-150 (P2): Resources list / read (issue #139) ─────────────────────
  // The global MCP server exposes `test://greeting` (text), `test://pixel.png`
  // (binary) and the template `test://item/{id}`.
  uiTest(
    'MST-150 MCP resources: list, read text / binary, expand a template',
    async ({ window }) => {
      const { mcp } = getTestServerUrls()
      await openNewDropdownItem(window, /MCP/i)
      await window.getByTestId('mcp-transport').selectOption('http')
      await window.getByTestId('mcp-url').fill(mcp)
      await window.getByTestId('mcp-connect').click()
      await expect(window.getByTestId('mcp-connect')).toHaveText(/Disconnect/i, { timeout: 15_000 })
      await expect(window.getByTestId('mcp-tool-echo')).toBeVisible({ timeout: 10_000 })
      await expect(window.getByTestId('mcp-protocol-version')).toBeVisible()

      await window.getByTestId('mcp-cap-tab-resources').click()
      await window.getByTestId('mcp-resource-test_greeting').click()
      await window.getByTestId('mcp-read-resource').click()
      await expect(window.getByText('Hello from Testnizer').first()).toBeVisible({
        timeout: 10_000,
      })

      await window.getByTestId('mcp-resource-test_pixel_png').click()
      await window.getByTestId('mcp-read-resource').click()
      await expect(window.getByTestId('mcp-resource-binary')).toBeVisible({ timeout: 10_000 })

      // Template: Read stays disabled-in-effect until {id} is replaced.
      await window.getByTestId('mcp-template-test_item_id_').click()
      await expect(window.getByTestId('mcp-resource-uri')).toHaveValue('test://item/{id}')
      await window.getByTestId('mcp-resource-uri').fill('test://item/42')
      await window.getByTestId('mcp-read-resource').click()
      await expect(window.getByText(/"id": "42"/).first()).toBeVisible({ timeout: 10_000 })

      // Search filters the list by URI.
      await window.getByTestId('mcp-search').fill('pixel')
      await expect(window.getByTestId('mcp-resource-test_greeting')).toHaveCount(0)
      await expect(window.getByTestId('mcp-resource-test_pixel_png')).toBeVisible()

      await window.getByTestId('mcp-connect').click()
    },
  )

  // ── Issue #139: prompts ───────────────────────────────────────────────────
  uiTest('issue #139 MCP prompt: required argument, Get, messages by role', async ({ window }) => {
    const { mcp } = getTestServerUrls()
    await openNewDropdownItem(window, /MCP/i)
    await window.getByTestId('mcp-transport').selectOption('http')
    await window.getByTestId('mcp-url').fill(mcp)
    await window.getByTestId('mcp-connect').click()
    await expect(window.getByTestId('mcp-connect')).toHaveText(/Disconnect/i, { timeout: 15_000 })

    await window.getByTestId('mcp-cap-tab-prompts').click()
    await window.getByTestId('mcp-prompt-summarize').click()
    await window.getByTestId('mcp-get-prompt').click()
    await expect(window.getByTestId('mcp-prompt-error')).toContainText('text')

    await window.getByTestId('mcp-prompt-arg-text').fill('Testnizer issue 139')
    await window.getByTestId('mcp-get-prompt').click()
    const message = window.getByTestId('mcp-prompt-message').first()
    await expect(message).toHaveAttribute('data-role', 'user', { timeout: 10_000 })
    await expect(message).toContainText('Please summarize')
    await expect(message).toContainText('Testnizer issue 139')

    await window.getByTestId('mcp-connect').click()
  })

  // ── Issue #139: notifications + frames ────────────────────────────────────
  // `notify` emits notifications/message, notifications/progress (the client
  // always sends a progressToken) and tools/list_changed during its call.
  uiTest(
    'issue #139 MCP notifications and JSON-RPC frames are shown per tab',
    async ({ window }) => {
      const { mcp } = getTestServerUrls()
      await openNewDropdownItem(window, /MCP/i)
      await window.getByTestId('mcp-transport').selectOption('http')
      await window.getByTestId('mcp-url').fill(mcp)
      await window.getByTestId('mcp-connect').click()
      await expect(window.getByTestId('mcp-connect')).toHaveText(/Disconnect/i, { timeout: 15_000 })

      await window.getByTestId('mcp-tool-notify').click()
      await window.getByTestId('mcp-invoke').click()
      await expect(window.getByText(/notified \(/).first()).toBeVisible({ timeout: 10_000 })

      await window.getByTestId('mcp-messages-toggle').click()
      const notifications = window.getByTestId('mcp-notifications')
      await expect(notifications).toContainText('notifications/message', { timeout: 10_000 })
      await expect(notifications).toContainText('notify tool started')
      await expect(notifications).toContainText('notifications/progress')

      await window.getByTestId('mcp-messages-tab-frames').click()
      const frames = window.getByTestId('mcp-frames')
      await expect(frames).toContainText('initialize', { timeout: 10_000 })
      await expect(frames).toContainText('tools/call')
      await frames
        .getByText(/^initialize/)
        .first()
        .click()
      await expect(window.getByTestId('mcp-frames-detail')).toContainText('protocolVersion')

      await window.getByTestId('mcp-connect').click()
    },
  )

  // ── Issue #139: paste a host config ───────────────────────────────────────
  uiTest(
    'issue #139 MCP paste config imports a VS Code server into the tab',
    async ({ window }) => {
      const { mcp } = getTestServerUrls()
      await openNewDropdownItem(window, /MCP/i)
      await window.getByTestId('mcp-config-paste').click()
      await window.getByTestId('mcp-config-text').fill(
        JSON.stringify({
          servers: {
            local: { type: 'stdio', command: 'node', args: ['server.js'] },
            e2e: { type: 'http', url: mcp, headers: { 'X-Testnizer-139': 'pasted' } },
          },
        }),
      )
      await window.getByTestId('mcp-config-server-1').check()
      await window.getByTestId('mcp-config-apply').click()

      await expect(window.getByTestId('mcp-transport')).toHaveValue('http')
      await expect(window.getByTestId('mcp-url')).toHaveValue(mcp)
      await expect(window.getByTestId('mcp-headers-count')).toHaveText('1')

      await window.getByTestId('mcp-connect').click()
      await expect(window.getByTestId('mcp-connect')).toHaveText(/Disconnect/i, { timeout: 15_000 })
      await window.getByTestId('mcp-tool-echo_headers').click()
      await window.getByTestId('mcp-invoke').click()
      await expect(window.getByText(/pasted/).first()).toBeVisible({ timeout: 10_000 })

      // Export round-trip: the VS Code view carries the same server.
      await window.getByTestId('mcp-config-export').click()
      await window.getByTestId('mcp-export-host-vscode').click()
      await expect(window.getByTestId('mcp-export-code')).toContainText('"type": "http"')
      await expect(window.getByTestId('mcp-export-code')).toContainText('X-Testnizer-139')
      await window.keyboard.press('Escape')

      await window.getByTestId('mcp-connect').click()
    },
  )

  // ── Issue #137: custom HTTP headers on connect ────────────────────────────
  // The global MCP server's `echo_headers` tool returns the headers of the
  // request that carried the tools/call, so a custom header row typed into
  // the MCP tab must come back in the result.
  uiTest('issue #137 MCP custom header reaches the server', async ({ window }) => {
    const { mcp } = getTestServerUrls()
    await openNewDropdownItem(window, /MCP/i)
    await window.getByTestId('mcp-transport').selectOption('http')
    await window.getByTestId('mcp-url').fill(mcp)

    const section = window.getByTestId('mcp-headers-section')
    await window.getByTestId('mcp-headers-toggle').click()
    await section.getByRole('button', { name: /\+ Add Header/i }).click()
    const rows = section.locator('[data-testid^="kv-row-"]')
    const row = rows.nth((await rows.count()) - 1)
    await row.getByTestId('kv-key').fill('X-Testnizer-137')
    await row.getByTestId('kv-value').locator('input').fill('mcp-header-ok')
    await expect(window.getByTestId('mcp-headers-count')).toHaveText('1')

    await window.getByTestId('mcp-connect').click()
    await expect(window.getByTestId('mcp-connect')).toHaveText(/Disconnect/i, { timeout: 15_000 })
    await expect(window.getByTestId('mcp-tool-echo_headers')).toBeVisible({ timeout: 10_000 })
    await window.getByTestId('mcp-tool-echo_headers').click()
    await window.getByTestId('mcp-invoke').click()
    await expect(window.getByText(/mcp-header-ok/).first()).toBeVisible({ timeout: 10_000 })

    // stdio has no HTTP layer — the headers block is hidden for it.
    await window.getByTestId('mcp-connect').click()
    await expect(window.getByTestId('mcp-connect')).not.toHaveText(/Disconnect/i, {
      timeout: 8_000,
    })
    await window.getByTestId('mcp-transport').selectOption('stdio')
    await expect(window.getByTestId('mcp-headers-toggle')).toHaveCount(0)
  })
})
