/**
 * Send's entry into the shared MCP call module (`src/shared/mcp-call.ts`):
 * the tab's state + the active variables → connect options and the
 * JSON-RPC params of a tool / resource / prompt call. `mcp.store.ts` calls
 * these; Run builds the same values from the saved row with the same shared
 * functions (`runner.handler.ts` `mcpRunRequest`), and
 * `tests/main/shared/mcp-call-parity.test.ts` holds the two to identical
 * output. Pure — no store / IPC imports.
 */
import type { KeyValuePair } from '../types'
import type { McpAuthConfig, McpTransport } from '../types/mcp'
import { resolveVariables } from './variable-resolver'
import { prepareToolArgs } from './mcp-args-form'
import {
  buildMcpConnect,
  resolvePromptArgs,
  resolveResourceUri,
  type McpCallParams,
  type McpConnectParams,
  type ResourceUriResult,
} from '../../shared/mcp-call'
import { resolveMcpTimeout } from '../../shared/request-settings'

export interface McpSendConnection {
  transport: McpTransport
  url: string
  customHeaders: readonly KeyValuePair[]
  envVars: readonly KeyValuePair[]
  auth: McpAuthConfig
  protocol: string
}

const resolverOf =
  (vars: Record<string, string>) =>
  (text: string): string =>
    resolveVariables(text, vars)

/** The tab's connection → `mcp:connect` options (minus pending / OAuth session ids). */
export function sendConnectParams(
  st: McpSendConnection,
  vars: Record<string, string>,
): McpConnectParams {
  return buildMcpConnect(st, resolverOf(vars))
}

export type SendToolCall =
  | { call: Extract<McpCallParams, { capability: 'tool' }>; raw: unknown; error?: undefined }
  | { error: 'json'; call?: undefined; raw?: undefined }

/**
 * A tools/call: `{{var}}` resolved in the args text, parsed, schema-coerced
 * (`raw` = the unresolved parse, for the form's validation).
 */
export function sendToolCall(
  name: string,
  toolArgs: string,
  vars: Record<string, string>,
  schema?: unknown,
): SendToolCall {
  const prepared = prepareToolArgs(toolArgs, vars, schema)
  if (prepared.error) return { error: 'json' }
  return { call: { capability: 'tool', name, args: prepared.args }, raw: prepared.raw }
}

/** A resources/read: the URI draft trimmed + resolved; an unfilled `{id}` template is an error. */
export function sendResourceUri(draft: string, vars: Record<string, string>): ResourceUriResult {
  return resolveResourceUri(draft, resolverOf(vars))
}

/** A prompts/get: empty arguments left out, the rest resolved. */
export function sendPromptCall(
  name: string,
  promptArgs: Record<string, string>,
  vars: Record<string, string>,
): Extract<McpCallParams, { capability: 'prompt' }> {
  return { capability: 'prompt', name, args: resolvePromptArgs(promptArgs, resolverOf(vars)) }
}

/**
 * The call's timeout (issue #185): the tab's own (0 = no limit) or the shared
 * `MCP_DEFAULT_TIMEOUT_MS` — the same rule Run applies (`runner.handler.ts`
 * `mcpRunTimeout`). Always sent, so the SDK's implicit 60 s never decides.
 */
export function mcpSendTimeout(perTab: number | null | undefined): number {
  return resolveMcpTimeout(perTab)
}
