/**
 * AI Chat tool loop (issue #180): one prompt → LLM call → tool calls on the
 * enabled MCP servers → results back to the model → … until the model answers
 * without tools or the round cap is hit.
 *
 * Everything with side effects is injected (`AiLoopDeps`: the LLM stream, the
 * MCP session primitives, the stdio trust check; `AiLoopIo`: abort signal,
 * event sinks and the two user questions — approval and stdio trust), so the
 * loop is unit-tested with fixtures and the handler stays a thin adapter.
 *
 * Rules the loop enforces:
 *  - ONE detached MCP connection per server per Send, closed in `finally`;
 *  - an untrusted stdio server is never spawned before the user answers
 *    "Trust and connect" — and the loop never records trust itself (the
 *    handler does, on the click); trust is re-checked before connecting;
 *  - every tool call asks the user unless "Run tools without asking" is on or
 *    the tool was allowed for this conversation; tool OUTPUT never changes
 *    that (it is untrusted text for the model, nothing more);
 *  - malformed arguments / unknown tools / denials / failures become error
 *    results for the model, never a crash; at most `AI_TOOL_LOOP_MAX_ROUNDS`
 *    LLM calls per prompt, with a visible note;
 *  - Stop aborts the LLM stream, a running tool call and a pending question.
 */
import {
  AI_TOOL_LOOP_MAX_ROUNDS,
  AI_TOOL_RESULT_MAX_CHARS,
  aiToolAllowKey,
  type AiApprovalDecision,
  type AiAssistantTurn,
  type AiCallMetrics,
  type AiNoticePart,
  type AiToolCallPart,
  type AiToolResultPart,
} from '../../shared/ai-chat-types'
import { applyTextDelta, capText, sumTurnMetrics, upsertPart } from '../../shared/ai-chat-turns'
import { buildToolNameTable, type AiToolRef } from '../../shared/ai-tool-names'
import { stdioEnvDisplay } from '../../shared/ai-stdio-env'
import {
  mcpSafeCommandLine,
  tokenizeCommandLine,
  type McpConnectParams,
} from '../../shared/mcp-call'
import type {
  AiRoundEvent,
  AiStreamOptions,
  AiToolDef,
  AiWireMessage,
  AiWireToolCall,
  AiWireToolResult,
} from './ai-chat.engine'
import type { McpDetachedSession, McpSessionCallOutcome, McpTool } from './mcp.engine'
import type { StdioTrustSubject } from '../lib/mcp-stdio-trust'

/** One enabled server of the request's Tools config, resolved by the renderer. */
export interface AiToolServerSpec {
  id: string
  name: string
  connect: McpConnectParams
  /** MCP tool names the user switched off. */
  disabledTools: string[]
  /** The saved MCP request uses OAuth 2.1 — AI Chat cannot sign in. */
  oauth?: boolean
  /** Per-call timeout (ms, 0 = none) — the saved MCP request's own setting. */
  timeoutMs?: number
}

export interface AiTurnTools {
  projectId?: string
  servers: AiToolServerSpec[]
  /** "Run tools without asking" (per tab, session-local). */
  autoApprove: boolean
  /** `aiToolAllowKey` grants of this conversation. */
  allowedTools: string[]
}

export interface AiTurnRequest {
  stream: Omit<AiStreamOptions, 'messages' | 'tools' | 'signal'>
  /** System prompt + earlier turns (text) + this prompt. */
  messages: AiWireMessage[]
  tools?: AiTurnTools
}

export interface AiLoopDeps {
  streamRound: (opts: AiStreamOptions) => AsyncGenerator<AiRoundEvent, void, void>
  openSession: (
    connect: McpConnectParams,
    signal: AbortSignal,
    timeoutMs?: number,
  ) => Promise<McpDetachedSession>
  callTool: (
    connectionId: string,
    name: string,
    args: Record<string, unknown>,
    opts: { signal: AbortSignal; timeoutMs?: number },
  ) => Promise<McpSessionCallOutcome>
  closeSession: (connectionId: string) => Promise<void>
  isTrusted: (subject: StdioTrustSubject) => Promise<boolean>
  now?: () => number
}

export type AiTrustAnswer = 'trusted' | 'skip' | 'cancelled'

export interface AiLoopIo {
  signal: AbortSignal
  onText: (delta: string) => void
  onTruncated: () => void
  onPart: (part: AiToolCallPart | AiToolResultPart | AiNoticePart) => void
  onCall: (metrics: AiCallMetrics) => void
  /** Ask the user about a tool call; resolves 'cancelled' on Stop / tab close. */
  askApproval: (part: AiToolCallPart) => Promise<AiApprovalDecision | 'cancelled'>
  /**
   * Ask the user to trust an untrusted stdio server. The HANDLER records the
   * trust on the user's click; the loop only waits for the answer.
   */
  askStdioTrust: (notice: AiNoticePart, subject: StdioTrustSubject) => Promise<AiTrustAnswer>
  /** A tool call ran (console log). */
  onToolRun?: (info: { server: string; tool: string; ok: boolean; durationMs: number }) => void
}

export interface AiLoopResult {
  turn: AiAssistantTurn
  outcome: 'done' | 'cancelled' | 'error'
  error?: string
  rounds: number
}

// ─── Messages shown to the model / user ─────────────────────────────────────

export const AI_TOOL_DENIED = 'The user denied this tool call.'
export const AI_TOOL_CANCELLED = 'Cancelled by the user.'
export const AI_TOOL_UNKNOWN = (name: string): string =>
  `Unknown tool "${name}". Use only the tools listed in this request.`
export const AI_TOOL_BAD_ARGS = (why: string): string =>
  `The tool arguments are not a valid JSON object (${why}). Call the tool again with valid JSON.`
/**
 * Arguments longer than the stored / shown cap: the approval card could only
 * show a cut-off copy, so the user would approve something they did not see.
 * Such a call is never run — the model gets this error and may retry smaller.
 */
export const AI_TOOL_ARGS_TOO_LARGE = `The tool arguments are longer than ${AI_TOOL_RESULT_MAX_CHARS} characters, so they cannot be shown for approval in full. The call was not run; call the tool again with smaller arguments.`
export const AI_TOOL_INPUT_REQUIRED =
  'The MCP server asked for user input (elicitation / input_required). AI Chat cannot answer interactive requests; this tool call failed.'
export const AI_TOOL_LOOP_CAP_RESULT = `Not run: the limit of ${AI_TOOL_LOOP_MAX_ROUNDS} model calls per prompt was reached.`
export const AI_SERVER_OAUTH =
  'This MCP server uses OAuth 2.1, which needs an interactive sign-in that AI Chat cannot do. Use Bearer with a token variable instead.'

/** An MCP `tools/call` result → the text the model gets (capped). */
export function toolResultText(result: unknown): { text: string; isError: boolean } {
  if (!result || typeof result !== 'object') {
    return { text: JSON.stringify(result ?? null), isError: false }
  }
  const r = result as Record<string, unknown>
  const isError = r.isError === true
  const pieces: string[] = []
  if (Array.isArray(r.content)) {
    for (const item of r.content) {
      if (!item || typeof item !== 'object') continue
      const c = item as Record<string, unknown>
      if (c.type === 'text' && typeof c.text === 'string') pieces.push(c.text)
      else if (c.type === 'image' || c.type === 'audio') {
        const size = typeof c.data === 'string' ? c.data.length : 0
        pieces.push(
          `[${String(c.type)}: ${String(c.mimeType ?? 'unknown type')}, ${size} base64 chars]`,
        )
      } else if (c.type === 'resource') {
        const res = (c.resource ?? {}) as Record<string, unknown>
        pieces.push(typeof res.text === 'string' ? res.text : `[resource ${String(res.uri ?? '')}]`)
      } else if (c.type === 'resource_link') {
        pieces.push(`[resource link ${String(c.uri ?? '')}]`)
      } else {
        pieces.push(JSON.stringify(c))
      }
    }
  }
  if (pieces.length === 0 && r.structuredContent !== undefined) {
    pieces.push(JSON.stringify(r.structuredContent))
  }
  return { text: pieces.join('\n'), isError }
}

/** The command line shown on the trust card (credential flag values masked). */
export function stdioCommandLineOf(connect: McpConnectParams): string {
  const parts =
    connect.command && Array.isArray(connect.args)
      ? [connect.command, ...connect.args]
      : tokenizeCommandLine(connect.command || connect.url || '')
  return mcpSafeCommandLine(parts)
}

interface OpenServer {
  spec: AiToolServerSpec
  session: McpDetachedSession
  tools: McpTool[]
}

interface ToolEntry {
  ref: AiToolRef
  def: McpTool
  open: OpenServer
}

const isAbortError = (err: unknown, signal: AbortSignal): boolean =>
  signal.aborted ||
  (err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message)))

export async function runAiTurn(
  req: AiTurnRequest,
  deps: AiLoopDeps,
  io: AiLoopIo,
): Promise<AiLoopResult> {
  const now = deps.now ?? Date.now
  const { signal } = io
  let turn: AiAssistantTurn = {
    id: '',
    role: 'assistant',
    content: '',
    parts: [],
    timestamp: now(),
  }
  const calls: AiCallMetrics[] = []
  const open: OpenServer[] = []
  const allowed = new Set(req.tools?.allowedTools ?? [])
  const autoApprove = req.tools?.autoApprove === true

  const part = (p: AiToolCallPart | AiToolResultPart | AiNoticePart): void => {
    turn = upsertPart(turn, p)
    io.onPart(p)
  }
  const finish = (
    outcome: AiLoopResult['outcome'],
    rounds: number,
    error?: string,
  ): AiLoopResult => {
    if (calls.length > 0) turn = { ...turn, metrics: sumTurnMetrics(calls) }
    if (error) turn = { ...turn, error }
    return { turn, outcome, rounds, ...(error ? { error } : {}) }
  }

  try {
    // ── Connect the enabled servers (sequential: one trust question at a time) ──
    for (const spec of req.tools?.servers ?? []) {
      if (signal.aborted) return finish('cancelled', 0)
      const noticeId = `server-error:${spec.id}`
      if (spec.oauth) {
        part({
          type: 'notice',
          id: noticeId,
          kind: 'server-error',
          serverId: spec.id,
          server: spec.name,
          message: AI_SERVER_OAUTH,
        })
        continue
      }
      if (spec.connect.transport === 'stdio') {
        const subject: StdioTrustSubject = {
          projectId: req.tools?.projectId,
          command: spec.connect.command,
          args: spec.connect.args,
          url: spec.connect.url,
          env: spec.connect.env,
        }
        if (!(await deps.isTrusted(subject))) {
          const notice: AiNoticePart = {
            type: 'notice',
            id: `stdio:${spec.id}`,
            kind: 'stdio-untrusted',
            serverId: spec.id,
            server: spec.name,
            commandLine: stdioCommandLineOf(spec.connect),
            envNames: Object.keys(spec.connect.env ?? {}),
            env: stdioEnvDisplay(spec.connect.env),
            status: 'pending',
          }
          part(notice)
          const answer = await io.askStdioTrust(notice, subject)
          if (answer === 'cancelled' || signal.aborted) {
            part({ ...notice, status: 'skipped' })
            return finish('cancelled', 0)
          }
          // Re-checked: only a recorded trust lets the command run.
          const trusted = answer === 'trusted' && (await deps.isTrusted(subject))
          part({ ...notice, status: trusted ? 'trusted' : 'skipped' })
          if (!trusted) continue
        }
      }
      try {
        const session = await deps.openSession(spec.connect, signal, spec.timeoutMs)
        const off = new Set(spec.disabledTools)
        open.push({ spec, session, tools: session.tools.filter((t) => !off.has(t.name)) })
      } catch (err) {
        if (isAbortError(err, signal)) return finish('cancelled', 0)
        part({
          type: 'notice',
          id: noticeId,
          kind: 'server-error',
          serverId: spec.id,
          server: spec.name,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // ── Tool table ──
    const entries: Array<{ ref: AiToolRef; def: McpTool; open: OpenServer }> = []
    for (const s of open) {
      for (const def of s.tools) {
        entries.push({
          ref: { serverId: s.spec.id, server: s.spec.name, tool: def.name },
          def,
          open: s,
        })
      }
    }
    const table = buildToolNameTable(entries.map((e) => e.ref))
    const byWire = new Map<string, ToolEntry>()
    const toolDefs: AiToolDef[] = []
    for (const [wire, ref] of table) {
      const entry = entries.find((e) => e.ref === ref)
      if (!entry) continue
      byWire.set(wire, entry)
      const desc = entry.def.description ?? entry.def.title ?? ''
      toolDefs.push({
        name: wire,
        description: `[${ref.server}] ${desc}`.trim().slice(0, 1024),
        inputSchema: entry.def.inputSchema,
      })
    }

    // ── The loop ──
    const messages: AiWireMessage[] = [...req.messages]
    for (let round = 1; round <= AI_TOOL_LOOP_MAX_ROUNDS; round++) {
      if (signal.aborted) return finish('cancelled', round - 1)
      const started = now()
      let roundText = ''
      let end: Extract<AiRoundEvent, { type: 'end' }> | null = null
      try {
        for await (const ev of deps.streamRound({
          ...req.stream,
          messages,
          ...(toolDefs.length > 0 ? { tools: toolDefs } : {}),
          signal,
        })) {
          if (signal.aborted) break
          if (ev.type === 'text') {
            roundText += ev.delta
            turn = applyTextDelta(turn, ev.delta)
            io.onText(ev.delta)
          } else if (ev.type === 'truncated') {
            turn = { ...turn, truncated: true }
            io.onTruncated()
          } else {
            end = ev
          }
        }
      } catch (err) {
        const status =
          err && typeof err === 'object' && typeof (err as { status?: unknown }).status === 'number'
            ? (err as { status: number }).status
            : null
        const aborted = isAbortError(err, signal)
        const metrics: AiCallMetrics = {
          status,
          ttfbMs: null,
          durationMs: now() - started,
          usageReported: false,
          ...(aborted ? {} : { error: err instanceof Error ? err.message : String(err) }),
        }
        calls.push(metrics)
        io.onCall(metrics)
        if (aborted) return finish('cancelled', round)
        return finish('error', round, err instanceof Error ? err.message : String(err))
      }
      const metrics: AiCallMetrics = {
        status: end?.status ?? null,
        ttfbMs: end?.firstContentAt != null ? Math.max(0, end.firstContentAt - started) : null,
        durationMs: now() - started,
        usageReported: !!end?.usage,
        ...(end?.usage ?? {}),
      }
      calls.push(metrics)
      io.onCall(metrics)
      if (signal.aborted || !end) return finish('cancelled', round)

      const toolCalls = end.toolCalls
      if (toolCalls.length === 0) return finish('done', round)

      // Ids unique within the turn (a provider may reuse `call_0` per round).
      const seen = new Set(
        (turn.parts ?? [])
          .filter((p): p is AiToolCallPart => p.type === 'tool_call')
          .map((p) => p.id),
      )
      const wireCalls: AiWireToolCall[] = toolCalls.map((c) => {
        let id = c.id
        // A counter, so a gateway repeating one id many times cannot loop forever.
        for (let n = 1; seen.has(id); n++) id = `${c.id}_${round}_${n}`
        seen.add(id)
        return { id, name: c.name, argsJson: c.argsJson }
      })

      if (round === AI_TOOL_LOOP_MAX_ROUNDS) {
        for (const c of wireCalls) {
          const hit = byWire.get(c.name)
          part(callPart(c, hit?.ref, 'error'))
          part(resultPart(c.id, AI_TOOL_LOOP_CAP_RESULT, true))
        }
        part({
          type: 'notice',
          id: 'loop-cap',
          kind: 'loop-cap',
          message: `Stopped after ${AI_TOOL_LOOP_MAX_ROUNDS} model calls for this prompt.`,
        })
        return finish('done', round)
      }

      messages.push({ role: 'assistant', content: roundText, toolCalls: wireCalls })
      const results: AiWireToolResult[] = []
      let cancelled = false
      for (const c of wireCalls) {
        if (cancelled || signal.aborted) {
          cancelled = true
          const hit = byWire.get(c.name)
          part(callPart(c, hit?.ref, 'error'))
          part(resultPart(c.id, AI_TOOL_CANCELLED, true))
          results.push({ id: c.id, content: AI_TOOL_CANCELLED, isError: true })
          continue
        }
        const r = await runOneCall(c, byWire, { autoApprove, allowed }, deps, io, part)
        results.push({ id: c.id, content: r.content, isError: r.isError })
        if (r.cancelled) cancelled = true
      }
      messages.push({ role: 'tool', results })
      if (cancelled || signal.aborted) return finish('cancelled', round)
    }
    return finish('done', AI_TOOL_LOOP_MAX_ROUNDS)
  } finally {
    await Promise.all(open.map((s) => deps.closeSession(s.session.connectionId).catch(() => {})))
  }
}

function callPart(
  c: AiWireToolCall,
  ref: AiToolRef | undefined,
  status: AiToolCallPart['status'],
): AiToolCallPart {
  return {
    type: 'tool_call',
    id: c.id,
    serverId: ref?.serverId ?? '',
    server: ref?.server ?? '',
    tool: ref?.tool ?? c.name,
    argsJson: capText(c.argsJson).text,
    status,
  }
}

function resultPart(callId: string, text: string, isError: boolean): AiToolResultPart {
  const capped = capText(text)
  return {
    type: 'tool_result',
    callId,
    content: capped.text,
    isError,
    ...(capped.truncated ? { truncated: true } : {}),
  }
}

async function runOneCall(
  c: AiWireToolCall,
  byWire: Map<string, ToolEntry>,
  policy: { autoApprove: boolean; allowed: Set<string> },
  deps: AiLoopDeps,
  io: AiLoopIo,
  part: (p: AiToolCallPart | AiToolResultPart | AiNoticePart) => void,
): Promise<{ content: string; isError: boolean; cancelled?: boolean }> {
  const fail = (
    status: AiToolCallPart['status'],
    text: string,
    ref?: AiToolRef,
    cancelled?: boolean,
  ): { content: string; isError: boolean; cancelled?: boolean } => {
    part(callPart(c, ref, status))
    const r = resultPart(c.id, text, true)
    part(r)
    return { content: r.content, isError: true, ...(cancelled ? { cancelled } : {}) }
  }

  const hit = byWire.get(c.name)
  if (!hit) return fail('error', AI_TOOL_UNKNOWN(c.name))
  // What runs must be what the approval card shows — never a capped copy.
  if (c.argsJson.length > AI_TOOL_RESULT_MAX_CHARS) {
    return fail('error', AI_TOOL_ARGS_TOO_LARGE, hit.ref)
  }

  let args: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(c.argsJson.trim() === '' ? '{}' : c.argsJson)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fail('error', AI_TOOL_BAD_ARGS('not an object'), hit.ref)
    }
    args = parsed as Record<string, unknown>
  } catch (err) {
    return fail(
      'error',
      AI_TOOL_BAD_ARGS(err instanceof Error ? err.message : 'parse error'),
      hit.ref,
    )
  }

  // ── Approval (the user's answer only; nothing a tool returns can grant it) ──
  const key = aiToolAllowKey(hit.ref.serverId, hit.ref.tool)
  if (!policy.autoApprove && !policy.allowed.has(key)) {
    const pending = callPart(c, hit.ref, 'pending-approval')
    part(pending)
    const decision = await io.askApproval(pending)
    if (decision === 'cancelled' || io.signal.aborted) {
      return fail('error', AI_TOOL_CANCELLED, hit.ref, true)
    }
    if (decision === 'deny') return fail('denied', AI_TOOL_DENIED, hit.ref)
    if (decision === 'conversation') policy.allowed.add(key)
  }
  part(callPart(c, hit.ref, 'running'))

  const started = (deps.now ?? Date.now)()
  const outcome = await deps.callTool(hit.open.session.connectionId, hit.ref.tool, args, {
    signal: io.signal,
    ...(hit.open.spec.timeoutMs !== undefined ? { timeoutMs: hit.open.spec.timeoutMs } : {}),
  })
  const durationMs = (deps.now ?? Date.now)() - started
  if (outcome.cancelled || io.signal.aborted) {
    io.onToolRun?.({ server: hit.ref.server, tool: hit.ref.tool, ok: false, durationMs })
    return fail('error', AI_TOOL_CANCELLED, hit.ref, true)
  }
  if (outcome.inputRequired) {
    io.onToolRun?.({ server: hit.ref.server, tool: hit.ref.tool, ok: false, durationMs })
    return fail('error', AI_TOOL_INPUT_REQUIRED, hit.ref)
  }
  if (outcome.error !== undefined) {
    io.onToolRun?.({ server: hit.ref.server, tool: hit.ref.tool, ok: false, durationMs })
    return fail('error', `Tool call failed: ${outcome.error}`, hit.ref)
  }
  const { text, isError } = toolResultText(outcome.result)
  io.onToolRun?.({ server: hit.ref.server, tool: hit.ref.tool, ok: !isError, durationMs })
  part(callPart(c, hit.ref, isError ? 'error' : 'done'))
  const r = resultPart(c.id, text, isError)
  part(r)
  return { content: r.content, isError }
}
