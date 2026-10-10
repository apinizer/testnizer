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
 * = the SDK's legacy `SUPPORTED_PROTOCOL_VERSIONS` + the 2026-07-28 modern
 * revision, issue #152). The renderer cannot import the SDK, so the list is
 * mirrored (a drift-guard test compares them); a pin outside it fails at save
 * time with a readable message anyway.
 */
export const MOCK_MCP_PROTOCOL_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
  '2026-07-28',
] as const

/** The first "modern era" revision (stateless, `server/discover`). */
export const MOCK_MCP_MODERN_VERSION = '2026-07-28'

export type MockMcpLegacyMode = MockMcpServer['legacyMode']
export type MockMcpEra = NonNullable<MockMcpServerState['eras']>[number]
export type MockMcpElicit = NonNullable<MockMcpTool['elicit']>

export const MOCK_MCP_LEGACY_MODES: readonly MockMcpLegacyMode[] = ['stateless', 'reject']

export const MOCK_MCP_ERROR_KINDS: readonly MockMcpErrorKind[] = [
  'none',
  'jsonrpc',
  'isError',
  'timeout',
  'http',
]

export const MOCK_MCP_RESPONSE_KINDS: readonly MockMcpResponseKind[] = ['text', 'json', 'template']

export type MockMcpEditorTab = 'general' | 'scenarios' | 'tools' | 'resources' | 'prompts' | 'logs'

/**
 * Field types of an elicitation row (`enum` = a string with `enum` values).
 * `unsupported` = a property the editor cannot edit (array, non-string enum,
 * no type, …): it is kept verbatim in `raw` and never offered in the picker.
 */
export type MockMcpElicitFieldType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'enum'
  | 'unsupported'

export const MOCK_MCP_ELICIT_FIELD_TYPES: readonly MockMcpElicitFieldType[] = [
  'string',
  'number',
  'integer',
  'boolean',
  'enum',
]

/** One row of the elicitation fields table — a property of the restricted schema. */
export interface MockMcpElicitFieldRow {
  /** Stable React key. */
  id: string
  name: string
  type: MockMcpElicitFieldType
  /** `enum` values, comma separated as typed. */
  enumText: string
  required: boolean
  /** The property's other keywords (title, minLength, …) — kept across a round trip. */
  extra: Record<string, unknown>
  /**
   * How an `enum` row is written back (issue #154): plain `enum` (default),
   * `enum` + legacy `enumNames`, or titled `oneOf: [{ const, title }]`.
   */
  enumStyle?: 'enumNames' | 'oneOf'
  /**
   * Per-value metadata of an `enumNames` / `oneOf` row, keyed by the value:
   * `{ title }` for an enumName, the `oneOf` entry minus `const` otherwise.
   * Looked up by value, so editing the values never leaves a label stale.
   */
  enumEntries?: Record<string, Record<string, unknown>>
  /** `unsupported` rows: the property schema exactly as loaded. */
  raw?: Record<string, unknown>
}

/** The elicitation section of a tool as the editor holds it (issue #152). */
export interface MockMcpElicitDraft {
  key: string
  message: string
  responseTemplate: string
  fields: MockMcpElicitFieldRow[]
}

/** A tool as the editor holds it: the input schema is raw JSON text until Save. */
export interface MockMcpToolDraft extends Omit<MockMcpTool, 'inputSchema' | 'elicit'> {
  /** Stable React key — never sent to the backend. */
  key: string
  schemaText: string
  /** Present = the tool asks the client for input first (2026-07-28 elicitation). */
  elicit?: MockMcpElicitDraft
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
  /** How 2025-era clients are served next to 2026-07-28 (issue #152). */
  legacyMode: MockMcpLegacyMode
  /** `ttlMs` on 2026-07-28 list results; 0 = always stale. */
  cacheTtlMs: number
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
