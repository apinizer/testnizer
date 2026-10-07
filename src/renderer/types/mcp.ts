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
