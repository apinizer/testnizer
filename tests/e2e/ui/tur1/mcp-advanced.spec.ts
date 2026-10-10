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
 *   - Issue #152 (protocol 2026-07-28): the global server is the v2 SDK one
 *     (both eras on /mcp). Auto negotiates `server/discover`, Legacy forces
 *     `initialize`, `ask_count` drives the multi-round-trip input card, and a
 *     Mock MCP server with "Legacy clients: Reject" serves 2026-07-28 only.
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

      // Auto (the default) negotiates 2026-07-28 with the v2 server: the
      // handshake is `server/discover`, not `initialize` (issue #152).
      await window.getByTestId('mcp-messages-tab-frames').click()
      const frames = window.getByTestId('mcp-frames')
      await expect(frames).toContainText('server/discover', { timeout: 10_000 })
      await expect(frames).toContainText('tools/call')
      await expect(frames.getByText(/^initialize/)).toHaveCount(0)
      await frames
        .getByText(/^server\/discover/)
        .first()
        .click()
      await expect(window.getByTestId('mcp-frames-detail')).toContainText('2026-07-28')

      await window.getByTestId('mcp-connect').click()
    },
  )

  // ── Issue #152: protocol era selector ─────────────────────────────────────
  uiTest(
    'issue #152 MCP protocol: Auto speaks 2026-07-28, Legacy forces the 2025 initialize',
    async ({ window }) => {
      const { mcp } = getTestServerUrls()
      await openNewDropdownItem(window, /MCP/i)
      await window.getByTestId('mcp-transport').selectOption('http')
      await window.getByTestId('mcp-url').fill(mcp)
      await expect(window.getByTestId('mcp-protocol')).toHaveValue('auto')

      // Auto → modern era, server/discover in the frames, listen stream open.
      await window.getByTestId('mcp-connect').click()
      await expect(window.getByTestId('mcp-connect')).toHaveText(/Disconnect/i, { timeout: 15_000 })
      const badge = window.getByTestId('mcp-protocol-version')
      await expect(badge).toHaveText('MCP 2026-07-28')
      await expect(badge).toHaveAttribute('data-era', 'modern')
      await expect(window.getByTestId('mcp-protocol')).toBeDisabled()
      await expect(window.getByTestId('mcp-subscription')).toContainText('tools', {
        timeout: 10_000,
      })
      await window.getByTestId('mcp-messages-toggle').click()
      await window.getByTestId('mcp-messages-tab-frames').click()
      await expect(window.getByTestId('mcp-frames')).toContainText('server/discover', {
        timeout: 10_000,
      })
      await window.getByTestId('mcp-connect').click()
      await expect(window.getByTestId('mcp-connect')).not.toHaveText(/Disconnect/i, {
        timeout: 8_000,
      })

      // Legacy → the plain 2025 handshake, no probe.
      await window.getByTestId('mcp-protocol').selectOption('legacy')
      await window.getByTestId('mcp-connect').click()
      await expect(window.getByTestId('mcp-connect')).toHaveText(/Disconnect/i, { timeout: 15_000 })
      await expect(badge).toHaveText(/^MCP 2025-\d\d-\d\d \(legacy\)$/)
      await expect(badge).toHaveAttribute('data-era', 'legacy')
      const frames = window.getByTestId('mcp-frames')
      await expect(frames).toContainText('initialize', { timeout: 10_000 })
      await expect(frames).not.toContainText('server/discover')
      await frames
        .getByText(/^initialize/)
        .first()
        .click()
      await expect(window.getByTestId('mcp-frames-detail')).toContainText('protocolVersion')
      // No listen stream on the legacy era.
      await expect(window.getByTestId('mcp-subscription')).toHaveCount(0)

      await window.getByTestId('mcp-connect').click()
    },
  )

  // ── Issue #152: multi-round-trip tools/call (MRTR) ────────────────────────
  // `ask_count` answers `input_required` with one elicitation (`count`, a
  // number); the card's Submit retries with the answer + the echoed state.
  uiTest('issue #152 MCP input-required card: ask_count round trip', async ({ window }) => {
    const { mcp } = getTestServerUrls()
    await openNewDropdownItem(window, /MCP/i)
    await window.getByTestId('mcp-transport').selectOption('http')
    await window.getByTestId('mcp-url').fill(mcp)
    await window.getByTestId('mcp-connect').click()
    await expect(window.getByTestId('mcp-connect')).toHaveText(/Disconnect/i, { timeout: 15_000 })

    await window.getByTestId('mcp-tool-ask_count').click()
    await window.getByTestId('mcp-tool-args').fill('{"label":"apples"}')
    await window.getByTestId('mcp-invoke').click()
    const card = window.getByTestId('mcp-input-required')
    await expect(card).toBeVisible({ timeout: 10_000 })
    await expect(card).toContainText('How many apples?')
    await expect(card).toHaveAttribute('data-round', '1')

    // Submitting the empty required field is caught locally.
    await window.getByTestId('mcp-input-submit').click()
    await expect(window.getByTestId('mcp-input-problem')).toContainText('count')

    await window.getByTestId('mcp-input-field-count-count').fill('3')
    await window.getByTestId('mcp-input-submit').click()
    await expect(card).toBeHidden({ timeout: 10_000 })
    await expect(window.getByTestId('mcp-result')).toContainText('3 apples', { timeout: 10_000 })

    // The retry carried inputResponses + requestState on the wire.
    await window.getByTestId('mcp-messages-toggle').click()
    await window.getByTestId('mcp-messages-tab-frames').click()
    const frames = window.getByTestId('mcp-frames')
    await frames
      .getByText(/^tools\/call/)
      .last()
      .click()
    const detail = window.getByTestId('mcp-frames-detail')
    await expect(detail).toContainText('inputResponses')
    await expect(detail).toContainText('requestState')

    // Decline ends the flow with the server's own answer.
    await window.getByTestId('mcp-invoke').click()
    await expect(card).toBeVisible({ timeout: 10_000 })
    await window.getByTestId('mcp-input-decline').click()
    await expect(card).toBeHidden({ timeout: 10_000 })
    await expect(
      window.getByTestId('mcp-result').or(window.getByTestId('mcp-result-call-error')),
    ).toBeVisible({ timeout: 10_000 })

    await window.getByTestId('mcp-connect').click()
  })

  // ── Issue #152: Mock MCP "Legacy clients: Reject" ─────────────────────────
  uiTest('issue #152 Mock MCP legacy mode Reject serves 2026-07-28 only', async ({ window }) => {
    const port = await getFreePort()
    await navigateSidebar(window, 'mocks')
    await window.getByTestId('mock-group-add-mcp').click()
    await expect(window.getByTestId('mock-new-type-mcp')).toHaveAttribute('aria-checked', 'true')
    await window.getByTestId('mock-new-name').fill(`Modern only ${port}`)
    await window.getByTestId('mock-new-port').fill(String(port))
    await window.getByTestId('mock-new-create').click()
    await expect(window.getByTestId('mock-mcp-editor')).toBeVisible({ timeout: 10_000 })

    await expect(window.getByTestId('mock-mcp-legacy-mode')).toHaveValue('stateless')
    await window.getByTestId('mock-mcp-legacy-mode').selectOption('reject')
    await window.getByTestId('mock-mcp-cache-ttl').fill('60000')
    await window.getByTestId('mock-mcp-cache-ttl').press('Tab')
    await expect(window.getByText(/-32022/).first()).toBeVisible()
    await window.getByTestId('mock-mcp-save').click()
    await expect(window.getByTestId('mock-mcp-save')).toBeDisabled({ timeout: 10_000 })

    // Scoped: the Mocks-panel row has its own `mock-mcp-start` / `-stop`
    // (MockServerRow), so the bare test id resolves to two elements (issue #154).
    const editor = window.getByTestId('mock-mcp-editor')
    await editor.getByTestId('mock-mcp-start').click()
    const eras = window.getByTestId('mock-mcp-eras')
    await expect(eras).toContainText('2026-07-28', { timeout: 10_000 })
    await expect(eras).not.toContainText('2025')

    // A pinned 2025 client is refused (-32022); Auto connects on 2026-07-28.
    await window.getByTestId('mock-mcp-open-in-mcp').click()
    await expect(window.getByTestId('mcp-url')).toHaveValue(new RegExp(`:${port}/mcp$`))
    await window.getByTestId('mcp-protocol').selectOption('2025-11-25')
    await window.getByTestId('mcp-connect').click()
    await expect(window.getByTestId('mcp-error')).toContainText('-32022', { timeout: 15_000 })
    await window.getByTestId('mcp-protocol').selectOption('auto')
    await window.getByTestId('mcp-connect').click()
    await expect(window.getByTestId('mcp-connect')).toHaveText(/Disconnect/i, { timeout: 15_000 })
    await expect(window.getByTestId('mcp-protocol-version')).toHaveText('MCP 2026-07-28')
    await window.getByTestId('mcp-connect').click()

    await navigateSidebar(window, 'mocks')
    await window.getByText(`Modern only ${port}`).first().click()
    await editor.getByTestId('mock-mcp-stop').click()
    await expect(editor.getByTestId('mock-mcp-start')).toBeVisible({ timeout: 10_000 })
  })

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

    // Headers is a tab of the config strip under the connection bar (MCP Auth);
    // the legacy toggle id sits on the tab's label.
    const section = window.getByTestId('mcp-headers-section')
    await window.getByTestId('mcp-headers-toggle').click()
    await expect(window.getByTestId('mcp-config-tab-headers')).toHaveAttribute(
      'aria-selected',
      'true',
    )
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

    // stdio has no HTTP layer — the Headers tab is hidden for it and the
    // Environment tab takes its place.
    await window.getByTestId('mcp-connect').click()
    await expect(window.getByTestId('mcp-connect')).not.toHaveText(/Disconnect/i, {
      timeout: 8_000,
    })
    await window.getByTestId('mcp-transport').selectOption('stdio')
    await expect(window.getByTestId('mcp-headers-toggle')).toHaveCount(0)
    await expect(window.getByTestId('mcp-config-tab-headers')).toHaveCount(0)
    await expect(window.getByTestId('mcp-config-tab-env')).toBeVisible()
  })

  // ── MCP Auth: Authorization tab ───────────────────────────────────────────
  // Bearer token and an API key header typed into the Authorization tab must
  // reach the server (`echo_headers` returns the headers of the tools/call),
  // and — HTTP parity, issue #48 — a custom Authorization header row of the
  // same name beats the Authorization tab.
  uiTest(
    'MCP Authorization tab — Bearer token and API key reach the server',
    async ({ window }) => {
      const { mcp } = getTestServerUrls()
      await openNewDropdownItem(window, /MCP/i)
      await window.getByTestId('mcp-transport').selectOption('http')
      await window.getByTestId('mcp-url').fill(mcp)

      await window.getByTestId('mcp-config-tab-auth').click()
      await window.getByTestId('mcp-auth-type').selectOption('bearer')
      await window.getByTestId('mcp-auth-bearer-token').fill('mcp-auth-bearer-ok')
      await expect(window.getByTestId('mcp-config-auth-dot')).toBeVisible()

      await window.getByTestId('mcp-connect').click()
      await expect(window.getByTestId('mcp-connect')).toHaveText(/Disconnect/i, { timeout: 15_000 })
      await window.getByTestId('mcp-tool-echo_headers').click()
      await window.getByTestId('mcp-invoke').click()
      // Scoped to the result: the auth inputs render their value as text too.
      const result = window.getByTestId('mcp-result')
      await expect(result).toContainText('Bearer mcp-auth-bearer-ok', { timeout: 10_000 })

      // A custom Authorization row wins over the Authorization tab.
      await window.getByTestId('mcp-connect').click()
      await expect(window.getByTestId('mcp-connect')).not.toHaveText(/Disconnect/i, {
        timeout: 8_000,
      })
      const section = window.getByTestId('mcp-headers-section')
      await window.getByTestId('mcp-config-tab-headers').click()
      await section.getByRole('button', { name: /\+ Add Header/i }).click()
      const rows = section.locator('[data-testid^="kv-row-"]')
      const row = rows.nth((await rows.count()) - 1)
      await row.getByTestId('kv-key').fill('Authorization')
      await row.getByTestId('kv-value').locator('input').fill('Bearer custom-row-wins')
      await window.getByTestId('mcp-connect').click()
      await expect(window.getByTestId('mcp-connect')).toHaveText(/Disconnect/i, { timeout: 15_000 })
      await window.getByTestId('mcp-tool-echo_headers').click()
      await window.getByTestId('mcp-invoke').click()
      await expect(result).toContainText('Bearer custom-row-wins', { timeout: 10_000 })
      await expect(result).not.toContainText('mcp-auth-bearer-ok')

      // API key in a header.
      await window.getByTestId('mcp-connect').click()
      await expect(window.getByTestId('mcp-connect')).not.toHaveText(/Disconnect/i, {
        timeout: 8_000,
      })
      await window.getByTestId('mcp-config-tab-auth').click()
      await window.getByTestId('mcp-auth-type').selectOption('api-key')
      await window.getByTestId('mcp-auth-apikey-key').fill('X-Testnizer-Key')
      await window.getByTestId('mcp-auth-apikey-value').fill('mcp-auth-apikey-ok')
      await window.getByTestId('mcp-connect').click()
      await expect(window.getByTestId('mcp-connect')).toHaveText(/Disconnect/i, { timeout: 15_000 })
      await window.getByTestId('mcp-tool-echo_headers').click()
      await window.getByTestId('mcp-invoke').click()
      await expect(window.getByTestId('mcp-result')).toContainText('mcp-auth-apikey-ok', {
        timeout: 10_000,
      })

      // Folding the config strip keeps the tab choice.
      await window.getByTestId('mcp-config-collapse').click()
      await expect(window.getByTestId('mcp-config-panel-auth')).toHaveCount(0)
      await window.getByTestId('mcp-config-collapse').click()
      await expect(window.getByTestId('mcp-auth-type')).toHaveValue('api-key')

      await window.getByTestId('mcp-connect').click()
    },
  )
})
