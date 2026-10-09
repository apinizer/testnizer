/**
 * MCP renderer types (issue #139).
 *
 * The wire DTOs are DERIVED from the preload contract (`window.api.mcp` in
 * `src/preload/index.d.ts`) so the two cannot drift — the preload file
 * declares them module-private, so they are reached through `Window['api']`.
 * Only what the bridge leaves as `unknown` (the raw `tools/call` result and
 * its content blocks) and renderer-side state shapes are declared here.
 */
import type { IpcResult } from './index'

/** The `window.api.mcp` bridge exactly as the preload declares it. */
export type McpBridge = Window['api']['mcp']

type IpcData<F> = F extends (...args: never[]) => Promise<IpcResult<infer T>>
  ? NonNullable<T>
  : never
type EventOf<F> = F extends (cb: (event: infer E) => void) => () => void ? E : never

export type McpConnectRequest = Parameters<McpBridge['connect']>[0]
export type McpTransport = McpConnectRequest['transport']
export type McpConnectResult = IpcData<McpBridge['connect']>
export type McpTool = IpcData<McpBridge['listTools']>[number]
export type McpResourceList = IpcData<McpBridge['listResources']>
export type McpResource = McpResourceList['resources'][number]
export type McpResourceTemplate = McpResourceList['templates'][number]
export type McpReadResourceResult = IpcData<McpBridge['readResource']>
export type McpResourceContents = McpReadResourceResult['contents'][number]
export type McpPrompt = IpcData<McpBridge['listPrompts']>[number]
export type McpPromptArgument = NonNullable<McpPrompt['arguments']>[number]
export type McpGetPromptResult = IpcData<McpBridge['getPrompt']>
export type McpPromptMessage = McpGetPromptResult['messages'][number]
export type McpNotificationEvent = EventOf<McpBridge['onNotification']>
export type McpFrameEvent = EventOf<McpBridge['onFrame']>
export type McpConnectionClosedEvent = EventOf<McpBridge['onConnectionClosed']>
export type McpSubscriptionStateEvent = EventOf<McpBridge['onSubscriptionState']>
export type McpCallContext = NonNullable<Parameters<McpBridge['callTool']>[3]>
/** `mcp.connect` reply — `unauthorized` when the server answered HTTP 401 (issue #141). */
export type McpConnectReply = Awaited<ReturnType<McpBridge['connect']>>

// ─── Protocol eras (issue #152) ─────────────────────────────────
/** `protocol` connect option: `auto` · `legacy` · a revision like `2026-07-28` / `2025-06-18`. */
export type McpProtocolChoice = NonNullable<McpConnectRequest['protocol']>
export type McpProtocolEra = NonNullable<McpConnectResult['era']>
export type McpSubscriptionInfo = NonNullable<McpConnectResult['subscription']>
export type McpSubscriptionFilter = NonNullable<McpSubscriptionInfo['honoredFilter']>

/** The connection's `subscriptions/listen` stream as the tab shows it. */
export interface McpSubscriptionView {
  state: 'open' | 'closed' | 'error'
  honoredFilter?: McpSubscriptionFilter
  /** `error`: why it could not be opened; `closed`: `graceful` / `remote`. */
  reason?: string
}

/**
 * `__mcp` marker on a `tools/call` / `respondInput` result that asks for
 * client input (2026-07-28 multi-round-trip) — mirrors `McpInputRequired` in
 * the preload contract, which the bridge leaves as `unknown`.
 */
export interface McpInputRequiredMarker {
  kind: 'input_required'
  /** Embedded requests keyed by server ids: `{ method: 'elicitation/create', params }` etc. */
  inputRequests: Record<string, unknown>
  /** Opaque — echoed verbatim by `respondInput`. */
  requestState?: string
}

/**
 * A bare `ElicitResult` (core `ElicitResultSchema`): what `respondInput`
 * sends per `inputRequests` key — never wrapped in `{ method, result }`.
 */
export type McpElicitAnswer =
  | { action: 'accept'; content: Record<string, string | number | boolean | string[]> }
  | { action: 'decline' }
  | { action: 'cancel' }

/** A `tools/call` paused on `input_required`, waiting for the user's answers. */
export interface McpPendingInput {
  toolName: string
  /** The exact arguments of the first round — every retry repeats them. */
  args: Record<string, unknown>
  requestState?: string
  inputRequests: Record<string, unknown>
  /** 1 for the first `input_required`, +1 per further round. */
  round: number
  /**
   * The last answer for this round failed (IPC error / throw). The card stays
   * — with the typed answers — and shows this inline (issue #154).
   */
  error?: string
}

// ─── Authorization tab (MCP Auth) ───────────────────────────────
/** Wire shape of `mcp.connect`'s `auth` (values already `{{var}}`-resolved). */
export type McpConnectAuth = NonNullable<McpConnectRequest['auth']>
export type McpAuthType = McpConnectAuth['type']
/**
 * Per-tab Authorization config — the wire shape with `{{var}}` kept
 * unresolved. `basic` / `bearer` / `apiKey` mirror the HTTP `AuthConfig`.
 * `oauth2` carries no fields here: the debugger's state lives in the store
 * and its token never leaves main.
 */
export type McpAuthConfig = McpConnectAuth
/** Config tab strip under the connection bar. */
export type McpConfigTab = 'auth' | 'headers' | 'env'

// ─── OAuth 2.1 debugger (issue #141) ─────────────────────────────
export type McpOAuthStartRequest = Parameters<McpBridge['oauthStart']>[0]
export type McpOAuthStepEvent = EventOf<McpBridge['onOauthStep']>
export type McpOAuthStep = McpOAuthStepEvent['step']
export type McpOAuthStepId = McpOAuthStep['id']
export type McpOAuthStepStatus = McpOAuthStep['status']
export type McpOAuthHttpRequest = NonNullable<McpOAuthStep['request']>
export type McpOAuthHttpResponse = NonNullable<McpOAuthStep['response']>
export type McpOAuthDoneEvent = EventOf<McpBridge['onOauthDone']>
export type McpOAuthSummary = NonNullable<McpOAuthDoneEvent['summary']>

// ─── Security Scan (issue #142) ─────────────────────────────────
export type McpSecurityScanRequest = Parameters<McpBridge['securityScan']>[0]
export type McpSecurityProgressEvent = EventOf<McpBridge['onSecurityProgress']>
export type McpSecurityFindingEvent = EventOf<McpBridge['onSecurityFinding']>
export type McpSecurityDoneEvent = EventOf<McpBridge['onSecurityDone']>
export type McpSecurityFinding = McpSecurityFindingEvent['finding']
export type McpSecurityReport = NonNullable<McpSecurityDoneEvent['report']>
export type McpSecurityCategory = McpSecurityReport['categories'][number]
export type McpSecurityCategoryId = McpSecurityFinding['category']
export type McpSecurityStatus = McpSecurityFinding['status']
export type McpSecuritySeverity = McpSecurityFinding['severity']
export type McpSecurityGrade = McpSecurityReport['grade']
export type McpSecurityEvidence = NonNullable<McpSecurityFinding['evidence']>
export type McpSecurityProgress = Omit<McpSecurityProgressEvent, 'scanId'>

/** One block of a `tools/call` result (the bridge returns the raw CallToolResult as `unknown`). */
export type McpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'audio'; data: string; mimeType: string }
  | { type: 'resource'; resource: McpResourceContents }
  | { type: 'resource_link'; uri: string; name?: string; mimeType?: string; description?: string }

export interface McpCallToolResult {
  content: McpContentBlock[]
  structuredContent?: unknown
  isError?: boolean
}

/** A notification as kept in the per-tab ring buffer. */
export interface McpNotification {
  id: string
  ts: number
  method: string
  params?: unknown
}

/** A JSON-RPC frame as kept in the per-tab ring buffer. */
export interface McpFrame {
  id: string
  ts: number
  direction: 'in' | 'out'
  message: unknown
  /** The main process cut an oversized frame down to `{ …, _truncated: { chars, preview } }`. */
  truncated?: boolean
}

export type McpCapabilityTab = 'tools' | 'resources' | 'prompts'
