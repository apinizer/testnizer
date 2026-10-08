/**
 * Mock MCP Server renderer types (issue #140).
 *
 * The wire DTOs are DERIVED from the preload contract (`window.api.mockMcp` in
 * `src/preload/index.d.ts`, which mirrors `src/main/mock-mcp/types.ts`) so the
 * two cannot drift — the preload file declares them module-private, so they
 * are reached through `Window['api']`. Only renderer-side editor shapes are
 * declared here.
 */
import type { IpcResult } from './index'

/** The `window.api.mockMcp` bridge exactly as the preload declares it. */
export type MockMcpBridge = Window['api']['mockMcp']

type IpcData<F> = F extends (...args: never[]) => Promise<IpcResult<infer T>>
  ? NonNullable<T>
  : never
type EventOf<F> = F extends (cb: (event: infer E) => void) => () => void ? E : never

export type MockMcpServer = IpcData<MockMcpBridge['server']['get']>
export type MockMcpServerState = IpcData<MockMcpBridge['server']['status']>
export type MockMcpServerStatus = MockMcpServerState['status']
export type MockMcpLogEntry = EventOf<MockMcpBridge['onLog']>
export type MockMcpServerCreateInput = Parameters<MockMcpBridge['server']['create']>[0]
export type MockMcpServerPatch = Parameters<MockMcpBridge['server']['update']>[1]

export type MockMcpTool = MockMcpServer['tools'][number]
export type MockMcpToolResponse = MockMcpTool['response']
export type MockMcpResponseKind = MockMcpToolResponse['kind']
export type MockMcpResource = MockMcpServer['resources'][number]
export type MockMcpPrompt = MockMcpServer['prompts'][number]
export type MockMcpPromptArgument = NonNullable<MockMcpPrompt['arguments']>[number]
export type MockMcpPromptMessage = MockMcpPrompt['messages'][number]
export type MockMcpErrorMode = MockMcpServer['errorMode']
export type MockMcpErrorKind = MockMcpErrorMode['kind']
export type MockMcpAuthMode = MockMcpServer['authMode']

/**
 * Protocol revisions the bundled MCP SDK implements — the only pins the
 * backend accepts (`PINNABLE_PROTOCOL_VERSIONS` in `src/main/mock-mcp/config.ts`
 * = the SDK's `SUPPORTED_PROTOCOL_VERSIONS`). The renderer cannot import the
 * SDK, so the list is mirrored; a pin outside it fails at save time with a
 * readable message anyway.
 */
export const MOCK_MCP_PROTOCOL_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
] as const

export const MOCK_MCP_ERROR_KINDS: readonly MockMcpErrorKind[] = [
  'none',
  'jsonrpc',
  'isError',
  'timeout',
  'http',
]

export const MOCK_MCP_RESPONSE_KINDS: readonly MockMcpResponseKind[] = ['text', 'json', 'template']

export type MockMcpEditorTab = 'general' | 'scenarios' | 'tools' | 'resources' | 'prompts' | 'logs'

/** A tool as the editor holds it: the input schema is raw JSON text until Save. */
export interface MockMcpToolDraft extends Omit<MockMcpTool, 'inputSchema'> {
  /** Stable React key — never sent to the backend. */
  key: string
  schemaText: string
}

/** The editable part of a server, held locally by the editor until Save. */
export interface MockMcpServerDraft {
  name: string
  description: string
  host: string
  port: number
  path: string
  legacySse: boolean
  protocolPin: string | null
  authMode: MockMcpAuthMode
  bearerToken: string
  latencyMs: number
  errorMode: MockMcpErrorMode
  tools: MockMcpToolDraft[]
  resources: MockMcpResource[]
  prompts: MockMcpPrompt[]
}

/** Functional draft update — safe against stale closures (Monaco onChange etc.). */
export type MockMcpDraftUpdater = (fn: (d: MockMcpServerDraft) => MockMcpServerDraft) => void
