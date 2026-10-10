/**
 * The MCP call on a client tab (issues #159, #163, #164, #168, #175): what is
 * saved with the request (capability tab, tool + raw args, resource URI,
 * prompt + args), the per-call id that makes a call cancellable, the result
 * header's meta (status / duration / size), pending 2025-era elicitations and
 * the user's last decline / cancel on an input card. Pure — the store owns
 * routing (by tab / connection id) and the IPC calls.
 */
import type { McpCapabilityTab } from '../types/mcp'
import type { McpCallReply } from '../lib/mcp-call-api'
import type { ArgsProblem } from '../lib/mcp-args-form'
import type { McpTestRun } from '../lib/mcp-send-scripts'
import type { McpSavedCall } from '../../shared/mcp-call'

// The saved-call shape and its tolerant reader are shared with Run
// (`runner.handler.ts`) — one implementation (`src/shared/mcp-call.ts`).
export { readSavedMcpCall } from '../../shared/mcp-call'
export type { McpSavedCall } from '../../shared/mcp-call'

export type McpCallKind = 'tool' | 'resource' | 'prompt'

/** `toolError` = a complete `tools/call` result with `isError: true`. */
export type McpCallStatus = 'ok' | 'toolError' | 'error' | 'cancelled'

export interface McpCallMeta {
  status: McpCallStatus
  durationMs?: number
  sizeBytes?: number
}

/** What the user answered on the last input card of the current call (issue #175). */
export type McpInputOutcome = 'declined' | 'cancelled'

/** A 2025-era `elicitation/create` waiting for the user (issue #168). */
export interface McpPendingElicitation {
  elicitationId: string
  serverName?: string
  message: string
  requestedSchema: Record<string, unknown>
  /** An answer is on its way to main. */
  sending?: boolean
  /** The last answer failed — the card stays for a retry. */
  error?: string
}

/** Saved with the request and kept across Connect / Disconnect. */
export interface McpSavedCallState {
  capabilityTab: McpCapabilityTab
  selectedTool: string | null
  toolArgs: string
  selectedResourceUri: string | null
  resourceUriDraft: string
  selectedPrompt: string | null
  promptArgs: Record<string, string>
}

/** Connection-scoped call lifecycle — reset on disconnect / close. */
export interface McpCallTabState {
  toolCallId: string | null
  resourceCallId: string | null
  promptCallId: string | null
  toolMeta: McpCallMeta | null
  resourceMeta: McpCallMeta | null
  promptMeta: McpCallMeta | null
  inputOutcome: McpInputOutcome | null
  pendingElicitations: McpPendingElicitation[]
  /** Problems found by the pre-Invoke validation — shown until the args change. */
  argsProblems: ArgsProblem[] | null
  /**
   * Arguments a History restore left EMPTY because History stored them
   * masked (dotted paths) — the "enter it again" note; each goes once the
   * user types a value. Never saved (not part of `metadata.mcp.call`).
   */
  hiddenArgs: string[] | null
  /** Assertion rows + post-response script results of the last finished call (issue #160). */
  toolTests: McpTestRun | null
  resourceTests: McpTestRun | null
  promptTests: McpTestRun | null
}

export function savedCallDefaults(): McpSavedCallState {
  return {
    capabilityTab: 'tools',
    selectedTool: null,
    toolArgs: '{}',
    selectedResourceUri: null,
    resourceUriDraft: '',
    selectedPrompt: null,
    promptArgs: {},
  }
}

export function callIdle(): McpCallTabState {
  return {
    toolCallId: null,
    resourceCallId: null,
    promptCallId: null,
    toolMeta: null,
    resourceMeta: null,
    promptMeta: null,
    inputOutcome: null,
    pendingElicitations: [],
    argsProblems: null,
    hiddenArgs: null,
    toolTests: null,
    resourceTests: null,
    promptTests: null,
  }
}

/** The live slice → what `metadata.mcp.call` stores. */
export function savedCallOf(s: McpSavedCallState): McpSavedCall {
  return {
    capabilityTab: s.capabilityTab,
    selectedTool: s.selectedTool,
    toolArgs: s.toolArgs,
    selectedResourceUri: s.selectedResourceUri,
    resourceUriDraft: s.resourceUriDraft,
    selectedPrompt: s.selectedPrompt,
    promptArgs: s.promptArgs,
  }
}

/** UTF-8 size of a value's JSON — the fallback when main sent no `timing`. */
export function jsonByteLength(value: unknown): number {
  let text: string
  try {
    text = JSON.stringify(value) ?? ''
  } catch {
    return 0
  }
  return new TextEncoder().encode(text).length
}

/**
 * A finished call → the result header's meta. Main's `timing` wins; without it
 * (older main) the renderer's own clock and the reply's JSON size stand in.
 */
export function callMetaOf(res: McpCallReply, elapsedMs: number, isToolError = false): McpCallMeta {
  const durationMs = res.timing?.durationMs ?? Math.max(0, Math.round(elapsedMs))
  if (res.cancelled) return { status: 'cancelled', durationMs }
  if (!res.success) return { status: 'error', durationMs }
  return {
    status: isToolError ? 'toolError' : 'ok',
    durationMs,
    sizeBytes: res.timing?.sizeBytes ?? jsonByteLength(res.data),
  }
}

/** `respondInput` answers → the note shown above the result (issue #175). */
export function outcomeOfResponses(
  responses: Record<string, { action: string }>,
): McpInputOutcome | null {
  const actions = Object.values(responses).map((r) => r.action)
  if (actions.length === 0 || actions.includes('accept')) return null
  return actions.includes('cancel') ? 'cancelled' : 'declined'
}

export function outcomeOfAction(action: string): McpInputOutcome | null {
  if (action === 'decline') return 'declined'
  if (action === 'cancel') return 'cancelled'
  return null
}

/** HTTP's response-size format (`ResponsePane`: `(bytes / 1024).toFixed(2) KB`). */
export function formatMcpSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} KB`
}
