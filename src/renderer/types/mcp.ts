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
export type McpCallContext = NonNullable<Parameters<McpBridge['callTool']>[3]>
/** `mcp.connect` reply — `unauthorized` when the server answered HTTP 401 (issue #141). */
export type McpConnectReply = Awaited<ReturnType<McpBridge['connect']>>

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
