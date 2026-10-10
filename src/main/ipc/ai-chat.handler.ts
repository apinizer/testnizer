import { ipcMain, BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import {
  effectiveMaxTokens,
  streamChatRound,
  type AiProvider,
  type AiWireMessage,
} from '../protocols/ai-chat.engine'
import {
  AI_SERVER_OAUTH,
  runAiTurn,
  stdioCommandLineOf,
  type AiLoopDeps,
  type AiToolServerSpec,
  type AiTrustAnswer,
} from '../protocols/ai-chat-loop'
import { logRequestResponse, logEvent } from '../lib/console-logger'
import { getAiKey, setAiKey } from '../lib/ai-chat-keys'
import { initialMessages, parseToolsPayload } from '../lib/ai-chat-payload'
import {
  isStdioServerTrusted,
  trustStdioServer,
  type StdioTrustSubject,
} from '../lib/mcp-stdio-trust'
import { AI_MAX_TOKENS_CAP } from '../../shared/ai-limits'
import { MCP_DEFAULT_TIMEOUT_MS } from '../../shared/request-settings'
import type { AiApprovalDecision, AiChatStreamEvent } from '../../shared/ai-chat-types'
import { registerAiConversationHandlers } from './ai-conversation.handler'
import {
  aiScrubberFor,
  scrubAiText,
  scrubCallMetrics,
  scrubTurnMetrics,
} from '../lib/ai-chat-scrub'
import { stdioEnvDisplay } from '../../shared/ai-stdio-env'

interface AiChatSendPayload {
  provider: AiProvider
  url?: string
  apiKey?: string
  model: string
  /** Older payload: the whole transcript, flat. */
  messages?: unknown
  /** Newer payload (issue #180): system prompt, earlier turns, this prompt. */
  system?: string
  history?: unknown
  prompt?: string
  /** Tools config (issue #180) — parsed defensively (`ai-chat-payload.ts`). */
  tools?: unknown
  /** User-defined headers (issue #120) — never logged, may carry credentials. */
  headers?: Record<string, string>
  temperature?: number
  maxTokens?: number
}

/**
 * Sampling temperature from the renderer, checked in main (issues #188/#189):
 * a finite number in 0..2 (every supported provider's range). Anything else
 * — NaN, Infinity, a string, out of range — is ignored → provider default.
 */
export function sanitizeTemperature(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 2 ? v : undefined
}

/**
 * `max_tokens` from the renderer: an integer ≥ 1, clamped to
 * `AI_MAX_TOKENS_CAP` (shared with the renderer field, which already rejects
 * larger values — the clamp only guards a payload that bypassed it).
 * Anything else is ignored → provider default.
 */
export function sanitizeMaxTokens(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return undefined
  return Math.min(v, AI_MAX_TOKENS_CAP)
}

interface TrustGate {
  subject: StdioTrustSubject
  resolve: (answer: AiTrustAnswer) => void
}

interface ActiveStream {
  controller: AbortController
  windowId: number
  /** The webContents that started the Send — its reload / crash / close ends the stream. */
  senderId: number
  /** Tool calls waiting for the user's approval: callId → resolver. */
  approvals: Map<string, (d: AiApprovalDecision | 'cancelled') => void>
  /** Untrusted stdio servers waiting for "Trust and connect": serverId → gate. */
  trustGates: Map<string, TrustGate>
}

// Track in-flight streams so the renderer can cancel by messageId.
const activeStreams = new Map<string, ActiveStream>()

function emit(windowId: number, channel: string, payload: unknown): void {
  const win = BrowserWindow.fromId(windowId)
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
}

/** Settle every question of a stream as cancelled (Stop / tab close / end). */
function settleQuestions(active: ActiveStream): void {
  for (const resolve of active.approvals.values()) resolve('cancelled')
  active.approvals.clear()
  for (const gate of active.trustGates.values()) gate.resolve('cancelled')
  active.trustGates.clear()
}

// ─── Owning renderer lifecycle (issue #180) ──────────────────────────────────
// A Send outlives nothing: when the renderer that started it reloads, crashes
// or closes, nobody can answer its approval / trust questions or Stop it. Its
// streams are aborted (the loop's `finally` closes the MCP sessions and stdio
// children), every pending question settles as denied/cancelled, and its
// trust tickets are dropped.

/** The slice of `WebContents` this module needs (tests pass an EventEmitter). */
interface SenderLike {
  id: number
  on?: (event: string, listener: (...args: unknown[]) => void) => unknown
}

const watchedSenders = new Set<number>()

/** A full main-frame navigation (reload / new page) — not an in-page hash / history change. */
export function isFullMainFrameNavigation(
  details: unknown,
  isInPlace?: unknown,
  isMainFrame?: unknown,
): boolean {
  const d = details && typeof details === 'object' ? (details as Record<string, unknown>) : {}
  const sameDocument = typeof d.isSameDocument === 'boolean' ? d.isSameDocument : isInPlace === true
  const mainFrame = typeof d.isMainFrame === 'boolean' ? d.isMainFrame : isMainFrame !== false
  return mainFrame && !sameDocument
}

/** Abort every stream (and drop every trust ticket) of one renderer. Returns streams ended. */
export function endSenderStreams(senderId: number): number {
  let n = 0
  for (const [messageId, active] of activeStreams) {
    if (active.senderId !== senderId) continue
    active.controller.abort()
    settleQuestions(active)
    activeStreams.delete(messageId)
    n++
  }
  for (const [token, ticket] of trustTickets) {
    if (ticket.senderId === senderId) trustTickets.delete(token)
  }
  return n
}

function watchSender(sender: SenderLike | undefined): void {
  if (!sender || typeof sender.on !== 'function' || watchedSenders.has(sender.id)) return
  const id = sender.id
  watchedSenders.add(id)
  sender.on('destroyed', () => {
    endSenderStreams(id)
    watchedSenders.delete(id)
  })
  sender.on('render-process-gone', () => endSenderStreams(id))
  sender.on(
    'did-start-navigation',
    (details: unknown, _url: unknown, inPlace: unknown, main: unknown) => {
      if (isFullMainFrameNavigation(details, inPlace, main)) endSenderStreams(id)
    },
  )
}

// ─── Tools tab trust tickets (issue #180) ───────────────────────────────────
// "Load tools" on an untrusted stdio server shows a card and issues a
// one-time ticket for EXACTLY the subject shown. "Trust and connect" redeems
// it: main trusts and connects that subject — never a config the renderer
// rebuilds at click time (an edit in between, or a different environment,
// would otherwise trust a command the user never saw). Same rule as Send,
// where the trust gate holds main's own subject.

interface TrustTicket {
  subject: StdioTrustSubject
  spec: AiToolServerSpec
  senderId: number
  expiresAt: number
}

export const TRUST_TICKET_TTL_MS = 10 * 60_000
const trustTickets = new Map<string, TrustTicket>()

function issueTrustTicket(
  subject: StdioTrustSubject,
  spec: AiToolServerSpec,
  senderId: number,
): string {
  const now = Date.now()
  for (const [token, t] of trustTickets) if (t.expiresAt <= now) trustTickets.delete(token)
  const token = randomUUID()
  trustTickets.set(token, { subject, spec, senderId, expiresAt: now + TRUST_TICKET_TTL_MS })
  return token
}

/** Remove and return a valid ticket of this sender, or null (unknown / used / expired / other window). */
function redeemTrustTicket(token: unknown, senderId: number): TrustTicket | null {
  if (typeof token !== 'string' || !token) return null
  const ticket = trustTickets.get(token)
  if (!ticket) return null
  trustTickets.delete(token)
  if (ticket.expiresAt <= Date.now() || ticket.senderId !== senderId) return null
  return ticket
}

export const AI_TRUST_TICKET_EXPIRED =
  'This trust prompt is no longer valid. Load tools again to review the server before trusting it.'

/** The trust subject of a stdio server spec. */
function subjectOf(spec: AiToolServerSpec, projectId: string | undefined): StdioTrustSubject {
  return {
    projectId,
    command: spec.connect.command,
    args: spec.connect.args,
    url: spec.connect.url,
    env: spec.connect.env,
  }
}

const senderIdOf = (event: unknown): number => {
  const sender = (event as { sender?: { id?: unknown } } | undefined)?.sender
  return typeof sender?.id === 'number' ? sender.id : -1
}

/** Connect-phase bound: the call timeout, never below the shared default; `0` = none. */
export function connectTimeoutOf(callTimeoutMs: number | undefined): number {
  if (callTimeoutMs === 0) return 0
  return Math.max(callTimeoutMs ?? MCP_DEFAULT_TIMEOUT_MS, MCP_DEFAULT_TIMEOUT_MS)
}

/** Real side effects of the loop; tests replace pieces via `setAiLoopDepsForTests`. */
async function defaultDeps(): Promise<AiLoopDeps> {
  // Loaded lazily: the MCP SDK is heavy and a chat without tools never needs it.
  const mcp = await import('../protocols/mcp.engine')
  return {
    streamRound: streamChatRound,
    // Connect + tools/list get at least the shared default — Run's rule
    // (`mcpCallOnce`): a short CALL timeout must not fail a slow stdio spawn.
    openSession: (connect, signal, timeoutMs) =>
      mcp.mcpOpenDetachedSession({
        connect,
        signal,
        timeoutMs: connectTimeoutOf(timeoutMs),
      }),
    callTool: (id, name, args, opts) => mcp.mcpSessionCallTool(id, name, args, opts),
    closeSession: (id) => mcp.mcpDisconnect(id),
    isTrusted: isStdioServerTrusted,
  }
}

/** One detached connect → tools/list → disconnect. */
async function listToolsOf(
  spec: AiToolServerSpec,
): Promise<Array<{ name: string; description?: string }>> {
  const deps = await loopDeps(true)
  const controller = new AbortController()
  const session = await deps.openSession(spec.connect, controller.signal, spec.timeoutMs)
  await deps.closeSession(session.connectionId).catch(() => {})
  return session.tools.map((t) => ({
    name: t.name,
    ...(t.description ? { description: t.description } : {}),
  }))
}

let depsOverride: Partial<AiLoopDeps> | null = null

/** Test seam: replace loop dependencies (`null` restores the real ones). */
export function setAiLoopDepsForTests(deps: Partial<AiLoopDeps> | null): void {
  depsOverride = deps
}

async function loopDeps(needsMcp: boolean): Promise<AiLoopDeps> {
  const base: AiLoopDeps = needsMcp
    ? await defaultDeps()
    : {
        streamRound: streamChatRound,
        openSession: () => Promise.reject(new Error('no MCP servers')),
        callTool: () => Promise.resolve({ error: 'no MCP servers' }),
        closeSession: () => Promise.resolve(),
        isTrusted: isStdioServerTrusted,
      }
  return { ...base, ...(depsOverride ?? {}) }
}

export function registerAiChatHandlers(): void {
  registerAiConversationHandlers()

  // ─── Send prompt + stream response ───────────────────────────
  ipcMain.handle('aichat:send', async (event, payload: AiChatSendPayload) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) {
        return { success: false, error: 'No window found for this request' }
      }

      const messageId = randomUUID()
      const controller = new AbortController()
      const active: ActiveStream = {
        controller,
        windowId: win.id,
        senderId: senderIdOf(event),
        approvals: new Map(),
        trustGates: new Map(),
      }
      activeStreams.set(messageId, active)
      watchSender(event.sender as unknown as SenderLike)

      const messages: AiWireMessage[] = initialMessages(
        payload as unknown as Record<string, unknown>,
      )
      const tools = parseToolsPayload(payload.tools)
      const lastUser = [...messages].reverse().find((m) => m.role === 'user')
      const promptPreview = lastUser && 'content' in lastUser ? lastUser.content.slice(0, 200) : ''
      const started = Date.now()
      const targetUrl = payload.url ?? `${payload.provider}://chat/completions`
      // Never trust generation settings from IPC — validated here, once, and
      // only the sanitized values reach the engine and the console log.
      const temperature = sanitizeTemperature(payload.temperature)
      const maxTokens = sanitizeMaxTokens(payload.maxTokens)
      const sentMaxTokens = effectiveMaxTokens(payload.provider, maxTokens)
      const event_ = (e: AiChatStreamEvent): void => emit(win.id, 'aichat:event', e)
      // A provider's error text can echo the key or a header back (issue #180):
      // scrubbed before it reaches the renderer, the turn or the console.
      const scrub = aiScrubberFor({ apiKey: payload.apiKey, headers: payload.headers })
      const cleanError = (text: string): string => scrubAiText(text, scrub)

      // Drive streaming in the background — the IPC call resolves immediately
      // with the messageId so the renderer can route subsequent chunk events.
      void (async () => {
        let chunkCount = 0
        let fullText = ''
        let truncated = false
        try {
          const deps = await loopDeps(!!tools)
          const result = await runAiTurn(
            {
              stream: {
                provider: payload.provider,
                url: payload.url,
                apiKey: payload.apiKey,
                headers: payload.headers,
                model: payload.model,
                temperature,
                maxTokens,
              },
              messages,
              ...(tools ? { tools } : {}),
            },
            deps,
            {
              signal: controller.signal,
              onText: (delta) => {
                chunkCount++
                fullText += delta
                emit(win.id, 'aichat:chunk', { messageId, delta })
              },
              onTruncated: () => {
                truncated = true
              },
              onPart: (part) => event_({ messageId, kind: 'part', part }),
              onCall: (metrics) =>
                event_({ messageId, kind: 'call', metrics: scrubCallMetrics(metrics, scrub) }),
              askApproval: (part) =>
                new Promise((resolve) => {
                  if (controller.signal.aborted) return resolve('cancelled')
                  active.approvals.set(part.id, resolve)
                }),
              askStdioTrust: (_notice, subject) =>
                new Promise((resolve) => {
                  if (controller.signal.aborted) return resolve('cancelled')
                  const serverId = _notice.serverId ?? ''
                  active.trustGates.set(serverId, { subject, resolve })
                }),
              onToolRun: (info) =>
                logEvent({
                  protocol: 'ai',
                  category: 'event',
                  message: `AI tool ${info.server}/${info.tool} ${info.ok ? 'ok' : 'failed'}`,
                  direction: 'out',
                  durationMs: info.durationMs,
                }),
            },
          )

          const elapsed = Date.now() - started
          const metrics = scrubTurnMetrics(result.turn.metrics, scrub)
          const totalBytes = Buffer.byteLength(fullText, 'utf-8')
          // Token counts only when every call reported them — never a 0 for "unknown".
          const usageMeta: Record<string, number> = {}
          if (metrics?.usageReported) {
            for (const k of ['inputTokens', 'outputTokens', 'totalTokens'] as const) {
              const v = metrics[k]
              if (typeof v === 'number') usageMeta[k] = v
            }
          }
          if (result.outcome === 'cancelled') {
            emit(win.id, 'aichat:cancelled', { messageId, ...(metrics ? { metrics } : {}) })
            logEvent({
              protocol: 'ai',
              category: 'event',
              message: `AI ${payload.provider}/${payload.model} cancelled (${chunkCount} chunks, ${fullText.length} chars)`,
              direction: 'in',
              durationMs: elapsed,
              sizeBytes: totalBytes,
              meta: {
                chunks: chunkCount,
                ...(metrics?.ttfbMs != null ? { ttfbMs: metrics.ttfbMs } : {}),
                provider: payload.provider,
                model: payload.model,
              },
            })
          } else if (result.outcome === 'error') {
            const error = cleanError(result.error ?? 'AI chat failed')
            emit(win.id, 'aichat:error', {
              messageId,
              error,
              ...(metrics ? { metrics } : {}),
            })
            logRequestResponse({
              protocol: 'ai',
              method: 'CHAT',
              url: targetUrl,
              status: metrics?.status ?? -1,
              statusText: error,
              durationMs: elapsed,
              requestBody: promptPreview,
              error: { message: error },
              meta: {
                provider: payload.provider,
                model: payload.model,
                messageCount: messages.length,
              },
            })
          } else {
            emit(win.id, 'aichat:done', {
              messageId,
              ...(truncated ? { truncated: true } : {}),
              ...(metrics ? { metrics } : {}),
            })
            logRequestResponse({
              protocol: 'ai',
              method: 'CHAT',
              url: targetUrl,
              status: metrics?.status ?? 200,
              statusText: 'OK',
              durationMs: elapsed,
              sizeBytes: totalBytes,
              requestBody: promptPreview,
              responseBody: fullText,
              meta: {
                provider: payload.provider,
                model: payload.model,
                messageCount: messages.length,
                // What the request body actually carried (issue #189): no
                // `temperature` key when none was sent (provider default), and
                // the effective `max_tokens` (Anthropic's default included).
                ...(temperature !== undefined ? { temperature } : {}),
                ...(sentMaxTokens !== undefined ? { maxTokens: sentMaxTokens } : {}),
                ...(truncated ? { truncated: true } : {}),
                chunks: chunkCount,
                ...(metrics?.ttfbMs != null ? { ttfbMs: metrics.ttfbMs } : {}),
                rounds: result.rounds,
                ...usageMeta,
                avgChunkBytes: chunkCount > 0 ? Math.round(totalBytes / chunkCount) : 0,
              },
            })
          }
        } catch (e) {
          const err = e as Error
          if (controller.signal.aborted) {
            emit(win.id, 'aichat:cancelled', { messageId })
          } else {
            emit(win.id, 'aichat:error', {
              messageId,
              error: cleanError(err?.message ?? String(e)),
            })
          }
        } finally {
          settleQuestions(active)
          activeStreams.delete(messageId)
        }
      })()

      return { success: true, data: { messageId } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Tool-call approval (issue #180) ─────────────────────────
  // The user's answer to an approval card. Only this IPC (a click) approves a
  // call — nothing the model or a tool returns can.
  ipcMain.handle(
    'aichat:approveTool',
    async (_event, messageId: string, callId: string, decision: AiApprovalDecision) => {
      try {
        const active = activeStreams.get(messageId)
        const resolve = active?.approvals.get(callId)
        if (!active || !resolve) return { success: true, data: { applied: false } }
        const d: AiApprovalDecision =
          decision === 'once' || decision === 'conversation' ? decision : 'deny'
        active.approvals.delete(callId)
        resolve(d)
        return { success: true, data: { applied: true } }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Untrusted stdio server: "Trust and connect" / skip (issue #180) ──
  // Trust is recorded HERE, on the user's click, for the exact command main
  // holds (never a renderer-supplied one) — the Send itself never records it.
  ipcMain.handle(
    'aichat:resolveStdioTrust',
    async (_event, messageId: string, serverId: string, decision: 'trust' | 'skip') => {
      try {
        const active = activeStreams.get(messageId)
        const gate = active?.trustGates.get(serverId)
        if (!active || !gate) return { success: true, data: { applied: false } }
        active.trustGates.delete(serverId)
        if (decision === 'trust') {
          await trustStdioServer(gate.subject)
          gate.resolve('trusted')
        } else {
          gate.resolve('skip')
        }
        return { success: true, data: { applied: true } }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Tools tab: list a server's tools (issue #180) ───────────
  // Explicit "Load tools" click: one detached connect → tools/list →
  // disconnect. An untrusted stdio server is NOT spawned — the reply carries
  // the card (command line, env with values / masks / danger flags) and a
  // one-time `trustToken` for exactly that subject. A renderer-supplied
  // "trust" flag is ignored: only `aichat:trustServerTools` (the card's click,
  // redeeming the token) records trust.
  ipcMain.handle(
    'aichat:listServerTools',
    async (event, rawServer: unknown, opts?: { projectId?: unknown }) => {
      try {
        const parsed = parseToolsPayload({
          servers: [rawServer],
          projectId: opts?.projectId,
        })
        const spec = parsed?.servers[0]
        if (!spec) return { success: false, error: 'Invalid MCP server configuration' }
        if (spec.oauth) return { success: false, error: AI_SERVER_OAUTH }
        if (spec.connect.transport === 'stdio') {
          const subject = subjectOf(spec, parsed?.projectId)
          if (!(await isStdioServerTrusted(subject))) {
            const senderId = senderIdOf(event)
            watchSender((event as { sender?: SenderLike } | undefined)?.sender)
            return {
              success: true,
              data: {
                untrusted: {
                  commandLine: stdioCommandLineOf(spec.connect),
                  envNames: Object.keys(spec.connect.env ?? {}),
                  env: stdioEnvDisplay(spec.connect.env),
                  trustToken: issueTrustTicket(subject, spec, senderId),
                },
              },
            }
          }
        }
        return { success: true, data: { tools: await listToolsOf(spec) } }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // The Tools-tab trust card's "Trust and connect": trusts and connects the
  // subject the card showed (the ticket), once.
  ipcMain.handle('aichat:trustServerTools', async (event, trustToken: unknown) => {
    try {
      const ticket = redeemTrustTicket(trustToken, senderIdOf(event))
      if (!ticket) return { success: false, error: AI_TRUST_TICKET_EXPIRED }
      await trustStdioServer(ticket.subject)
      return { success: true, data: { tools: await listToolsOf(ticket.spec) } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Provider API keys at rest (issue #188) ──────────────────
  // Encrypted with safeStorage in main; never in renderer localStorage. The
  // read returns the decrypted key to the renderer that owns the field.
  ipcMain.handle('aichat:getKey', async (_event, scope: string) => {
    try {
      return { success: true, data: await getAiKey(scope) }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('aichat:setKey', async (_event, scope: string, key: string) => {
    try {
      return { success: true, data: await setAiKey(scope, key) }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Cancel an in-flight stream ──────────────────────────────
  // Stop / tab close: aborts the LLM stream, the running tool call (the loop
  // passes the same signal to it) and every pending question.
  ipcMain.handle('aichat:cancel', async (_event, messageId: string) => {
    try {
      const active = activeStreams.get(messageId)
      if (!active) {
        return { success: true, data: { cancelled: false } }
      }
      active.controller.abort()
      settleQuestions(active)
      activeStreams.delete(messageId)
      return { success: true, data: { cancelled: true } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
