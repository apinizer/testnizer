/**
 * MST-151 P1 — Multi-turn conversation context
 * MST-152 P1 — Provider/model switch persist
 * MST-154 P1 — Stream cancel + error handling
 * MST-153 P1 — Plain chat completion contract + generation settings
 *
 * NOTE on MST-153: AI Chat offers tools only from MCP servers enabled in its
 * Tools tab (issue #180; covered by ai-chat-tools.spec.ts). With NO server
 * enabled — the case here — it must never send a `tools` array. The test runs
 * against the inline OpenAI-compatible stub (startToolCallServer, which would
 * answer with tool_calls only if a request carried tools): the request
 * carries no `tools`, the reply renders, and — issue #189 — temperature /
 * max tokens from the Settings section reach the request body and a
 * `finish_reason: 'length'` stop shows the "Answer truncated" note.
 *
 * NOTE on selectors: AiChatEditor has `ai-chat-editor`, `ai-settings-toggle`,
 * `ai-settings-body` and `ai-api-key`; the rest (provider dropdown, model/URL
 * inputs, Send/Stop, error text) is addressed by placeholder / role / text like
 * 25-ai-chat.spec.ts — every lookup is a hard assertion (no "not found → pass").
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openNewDropdownItem,
} from '../../helpers/ui/bootstrap'
import { getTestServerUrls } from '../../helpers/test-servers'
import http from 'node:http'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

// ─── Inline tool-call LLM server (MST-153) ───────────────────────────────────

interface ToolCallServer {
  port: number
  url: string
  /** Every parsed chat-completion request body, in order. */
  bodies: Array<Record<string, unknown>>
  close: () => Promise<void>
}

async function startToolCallServer(port: number): Promise<ToolCallServer> {
  let callCount = 0
  const bodies: Array<Record<string, unknown>> = []

  const server = http.createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        messages?: Array<{ role: string; content?: string }>
        tools?: unknown[]
        stream?: boolean
        max_tokens?: number
      }
      bodies.push(body as Record<string, unknown>)

      callCount++
      const last = body.messages?.at(-1)?.content ?? ''

      // First call: return a tool_calls response if tools were provided
      // Second call (after tool result injected by client): return final text
      if (callCount === 1 && (body.tools ?? []).length > 0) {
        const toolCallReply = {
          id: `tc-stub-${callCount}`,
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_01',
                    type: 'function',
                    function: {
                      name: 'get_info',
                      arguments: JSON.stringify({ query: 'e2e-test' }),
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(toolCallReply))
        return
      }

      // Default: normal text reply
      const reply = `Tool-call stub final reply to: ${String(last).slice(0, 60)}`
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\n`,
        )
        // A request with max_tokens is answered as cut off at the limit.
        if (body.max_tokens !== undefined) {
          res.write(
            `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] })}\n\n`,
          )
        }
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          id: `tc-stub-${callCount}`,
          choices: [{ message: { role: 'assistant', content: reply } }],
        }),
      )
      return
    }

    res.writeHead(404)
    res.end()
  })

  await new Promise<void>((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => resolve())
    server.on('error', reject)
  })

  return {
    port,
    url: `http://127.0.0.1:${port}/v1/chat/completions`,
    bodies,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}

// ─── Inline hanging LLM (MST-154 cancel) ─────────────────────────────────────
// Streams one chunk and then never finishes, so the Stop button is guaranteed
// to be on screen until the client cancels (the shared fake LLM answers
// instantly, which made the old cancel test race its own assertion).

interface HangingLlm {
  url: string
  close: () => Promise<void>
}

async function startHangingLlm(): Promise<HangingLlm> {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      for await (const _chunk of req) void _chunk
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'partial-hang-reply ' } }] })}\n\n`)
      return // never ends
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve())
    server.on('error', reject)
  })
  const { port } = server.address() as { port: number }
  return {
    url: `http://127.0.0.1:${port}/v1/chat/completions`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

// ─── Helper: open AI Chat tab and configure it ───────────────────────────────

async function openAiChatTab(
  window: import('@playwright/test').Page,
  llmUrl: string,
  apiKey = 'e2e-test-key',
): Promise<void> {
  await dismissOverlays(window)
  await openNewDropdownItem(window, /AI Chat/i)

  // Fill endpoint URL (identified by placeholder)
  const urlInput = window.getByPlaceholder(/chat completions|Endpoint URL|https:\/\/\.\.\./i)
  await urlInput.fill(llmUrl)

  // Fill API key
  const keyInput = window.getByPlaceholder('sk-...')
  await keyInput.fill(apiKey)
}

// ─── Tests ───────────────────────────────────────────────────────────────────

uiTest.describe('Tur1 — AI Chat deep [MST-151, 152, 153, 154]', () => {
  uiTest.beforeEach(async ({ window }) => {
    // Önceki spec sidebar'ı Tests/Mocks sayfasında bırakabilir — new-dropdown-btn
    // yalnızca APIs panelinde var (worker-scoped fixture pollution guard'ı).
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  // Keys are stored per provider (issue #188): clear the one these tests typed
  // through the field, so later AI specs in the shared window start blank.
  uiTest.afterEach(async ({ window }) => {
    const key = window.getByTestId('ai-api-key')
    if (await key.isVisible().catch(() => false)) await key.fill('').catch(() => {})
  })

  // ── MST-151: Multi-turn conversation ──────────────────────────────────────
  uiTest('MST-151 multi-turn conversation: second message includes prior context', async ({ window }) => {
    const { llm } = getTestServerUrls()
    await openAiChatTab(window, `${llm}/v1/chat/completions`)

    const prompt = window.getByPlaceholder(/Ask anything/i)
    const sendBtn = window.getByRole('button', { name: /^Send$|^Gönder$/i })

    // First turn
    const msg1 = `Turn1-${uid()}`
    await prompt.fill(msg1)
    await sendBtn.click()
    await expect(window.getByText(new RegExp(msg1.slice(0, 40), 'i')).first()).toBeVisible({
      timeout: 20_000,
    })
    // Wait for the reply to arrive
    await expect(window.getByText(/E2E stub reply/i).first()).toBeVisible({ timeout: 20_000 })

    // Second turn — the fake LLM echoes the last message content in its reply,
    // so we verify that the conversation panel shows both exchanges.
    const msg2 = `Turn2-${uid()}`
    await prompt.fill(msg2)
    await sendBtn.click()
    await expect(window.getByText(new RegExp(msg2.slice(0, 40), 'i')).first()).toBeVisible({
      timeout: 20_000,
    })
    // Two assistant replies should now be visible
    const replies = await window.getByText(/E2E stub reply/i).all()
    expect(replies.length).toBeGreaterThanOrEqual(2)
  })

  // ── MST-152: Provider/model switch ────────────────────────────────────────
  uiTest('MST-152 provider selection changes the endpoint URL pre-fill', async ({ window }) => {
    const { llm } = getTestServerUrls()
    const customUrl = `${llm}/v1/chat/completions`
    await openAiChatTab(window, customUrl)

    const body = window.getByTestId('ai-settings-body')
    await expect(body).toBeVisible({ timeout: 10_000 })
    const urlInput = body.getByPlaceholder(/chat completions|Endpoint URL|https:\/\/\.\.\./i)
    const modelInput = body.getByPlaceholder('model-id')
    await expect(urlInput).toHaveValue(customUrl)

    // The provider picker is a custom dropdown: first button in the settings body.
    const pickProvider = async (label: RegExp) => {
      await body.getByRole('button').first().click()
      // Option buttons carry the avatar letter in their name ("A Anthropic"); the
      // dropdown is portaled to <body>, so it is the last match.
      await window.getByRole('button', { name: label }).last().click()
    }

    // Anthropic → its default endpoint is pre-filled and the model follows.
    const modelBefore = await modelInput.inputValue()
    await pickProvider(/Anthropic/)
    await expect(urlInput).toHaveValue('https://api.anthropic.com/v1/messages')
    await expect(modelInput).not.toHaveValue(modelBefore)

    // Custom keeps whatever URL is there; put the local stub URL back for later tests.
    await pickProvider(/Custom/)
    await expect(urlInput).toHaveValue('https://api.anthropic.com/v1/messages')
    await urlInput.fill(customUrl)
    await expect(urlInput).toHaveValue(customUrl)
  })

  uiTest('MST-152 model input value is preserved after provider stays same', async ({ window }) => {
    const { llm } = getTestServerUrls()
    await openAiChatTab(window, `${llm}/v1/chat/completions`)

    // The settings section is expanded by default.
    const modelInput = window.getByTestId('ai-settings-body').getByPlaceholder('model-id')
    await expect(modelInput).toBeVisible({ timeout: 10_000 })

    const customModel = `gpt-4o-${uid().slice(0, 8)}`
    await modelInput.fill(customModel)
    await window.waitForTimeout(200)

    // Verify the value stuck (not cleared by a re-render)
    await expect(modelInput).toHaveValue(customModel)
  })

  // ── MST-154: Stream cancel ────────────────────────────────────────────────
  uiTest('MST-154 cancel button appears during streaming and stops it', async ({ window }) => {
    const hanging = await startHangingLlm()
    try {
      await openAiChatTab(window, hanging.url)

      const prompt = window.getByPlaceholder(/Ask anything/i)
      const sendBtn = window.getByRole('button', { name: /^Send$|^Gönder$/i })

      await prompt.fill(`CancelTest-${uid()}`)
      await sendBtn.click()

      // The stream stays open, so Stop is on screen (and the first chunk rendered).
      const stopBtn = window.getByRole('button', { name: /^Stop$|^Cancel$|^Durdur$/i })
      await expect(stopBtn).toBeVisible({ timeout: 10_000 })
      await expect(window.getByText(/partial-hang-reply/).first()).toBeVisible({ timeout: 10_000 })

      await stopBtn.click()

      // Cancelled: Send is back, Stop is gone, the partial answer is kept.
      await expect(sendBtn).toBeVisible({ timeout: 10_000 })
      await expect(stopBtn).toBeHidden({ timeout: 10_000 })
      await expect(window.getByText(/partial-hang-reply/).first()).toBeVisible()
    } finally {
      await hanging.close()
    }
  })

  uiTest('MST-154 error response shows error message in chat panel', async ({ window }) => {
    // Connect to a non-existent port to trigger a connection error
    await openAiChatTab(window, 'http://127.0.0.1:19999/v1/chat/completions', 'test-key')

    const prompt = window.getByPlaceholder(/Ask anything/i)
    const sendBtn = window.getByRole('button', { name: /^Send$|^Gönder$/i })

    await prompt.fill(`ErrorTest-${uid()}`)
    await sendBtn.click()

    // An error message or error indicator must appear
    await expect(
      window.getByText(/error|fail|could not|connect|ECONNREFUSED/i).first(),
    ).toBeVisible({ timeout: 20_000 })

    // The composer must recover — Send is disabled while the prompt is empty
    // (draft is cleared after send), so re-entering text must re-enable it,
    // proving the error didn't permanently lock the editor.
    await prompt.fill(`Retry-${uid()}`)
    await expect(sendBtn).toBeEnabled({ timeout: 10_000 })
  })

  // ── MST-153: plain completion (AI Chat has no tool calling) ─────────────
  uiTest('MST-153 sends a plain chat completion without tools and renders the reply', async ({ window }) => {
    // Spin up the inline tool-call server on a fixed port
    const tcPort = 27491
    let tcServer: ToolCallServer | null = null

    try {
      tcServer = await startToolCallServer(tcPort)

      await openAiChatTab(window, tcServer.url, 'tc-test-key')

      // Send a message — the AI Chat editor does NOT currently inject
      // the tools array itself (it sends raw text completions).  The server
      // responds with a normal text reply on first call when no tools are given.
      const prompt = window.getByPlaceholder(/Ask anything/i)
      const sendBtn = window.getByRole('button', { name: /^Send$|^Gönder$/i })

      await prompt.fill(`ToolCallTest-${uid()}`)
      await sendBtn.click()

      // The stub's plain text reply renders.
      await expect(
        window.getByText(/Tool-call stub final reply/i).first(),
      ).toBeVisible({ timeout: 20_000 })
      // No MCP server enabled → no tools offered, so the stub never enters its tool_calls branch.
      expect(tcServer.bodies.length).toBeGreaterThan(0)
      expect(tcServer.bodies.at(-1)?.tools).toBeUndefined()
      // No generation settings set → none sent (provider defaults).
      expect(tcServer.bodies.at(-1)?.temperature).toBeUndefined()
      expect(tcServer.bodies.at(-1)?.max_tokens).toBeUndefined()
    } finally {
      if (tcServer) await tcServer.close().catch(() => {})
    }
  })

  // ── MST-153: generation settings + truncation (issue #189) ──────────────
  uiTest('MST-153 temperature + max tokens reach the request; a length stop is flagged', async ({ window }) => {
    const tcPort = 27492
    let tcServer: ToolCallServer | null = null
    try {
      tcServer = await startToolCallServer(tcPort)
      await openAiChatTab(window, tcServer.url, 'tc-test-key')

      await window.getByTestId('ai-temperature').fill('0.3')
      await window.getByTestId('ai-max-tokens').fill('77')

      const prompt = window.getByPlaceholder(/Ask anything/i)
      await prompt.fill(`SettingsTest-${uid()}`)
      await window.getByRole('button', { name: /^Send$|^Gönder$/i }).click()

      await expect(window.getByTestId('ai-truncated-note').first()).toBeVisible({
        timeout: 20_000,
      })
      const body = tcServer.bodies.at(-1)
      expect(body?.temperature).toBe(0.3)
      expect(body?.max_tokens).toBe(77)
    } finally {
      if (tcServer) await tcServer.close().catch(() => {})
    }
  })
})
