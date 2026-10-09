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

/** The call as saved with the request (`metadata.mcp.call`, issue #159). */
export interface McpSavedCall {
  capabilityTab?: McpCapabilityTab
  selectedTool?: string | null
  /** Raw JSON text — `{{var}}` kept. */
  toolArgs?: string
  selectedResourceUri?: string | null
  resourceUriDraft?: string
  selectedPrompt?: string | null
  promptArgs?: Record<string, string>
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
  }
}

const CAPABILITY_TABS = new Set<McpCapabilityTab>(['tools', 'resources', 'prompts'])

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

/**
 * Tolerant read of `metadata.mcp.call` (or a History snapshot adapted to the
 * same shape): unknown / mistyped fields are dropped, never thrown on, so a
 * row saved before #159 — or by a newer build — opens with what it has.
 */
export function readSavedMcpCall(raw: unknown): McpSavedCall {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const r = raw as Record<string, unknown>
  const out: McpSavedCall = {}
  if (
    typeof r.capabilityTab === 'string' &&
    CAPABILITY_TABS.has(r.capabilityTab as McpCapabilityTab)
  ) {
    out.capabilityTab = r.capabilityTab as McpCapabilityTab
  }
  for (const key of ['selectedTool', 'selectedResourceUri', 'selectedPrompt'] as const) {
    if (typeof r[key] === 'string' || r[key] === null) out[key] = r[key] as string | null
  }
  if (typeof r.toolArgs === 'string') out.toolArgs = r.toolArgs
  if (typeof r.resourceUriDraft === 'string') out.resourceUriDraft = r.resourceUriDraft
  if (r.promptArgs && typeof r.promptArgs === 'object' && !Array.isArray(r.promptArgs)) {
    const args: Record<string, string> = {}
    for (const [k, v] of Object.entries(r.promptArgs as Record<string, unknown>)) {
      if (typeof v === 'string') args[k] = v
    }
    out.promptArgs = args
  }
  return out
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
