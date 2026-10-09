/**
 * The MCP call-lifecycle IPC surface (issues #163, #164, #168) as the store
 * codes against it: per-call `callId` + `mcp.cancelCall`, `timing` on every
 * call reply, and the 2025-era `elicitation/create` event / answer.
 *
 * The wire types come from `types/mcp.ts` (derived from the preload). This
 * view only makes the newer members optional and `timing` tolerant, so a
 * bridge without them (older preload, a test double) degrades instead of
 * throwing — every caller checks before use.
 */
import type { IpcResult } from '../types'
import type {
  McpCallContext,
  McpCallTiming,
  McpElicitationEvent,
  McpElicitationResult,
  McpGetPromptResult,
  McpReadResourceResult,
} from '../types/mcp'
import { getMcpApi } from './mcp-api'

export type { McpCallTiming, McpElicitationEvent, McpElicitationResult }

/**
 * A call reply. `cancelled: true` (with `success: false`) is a call the user
 * cancelled — shown as "Cancelled", never as an error.
 */
export interface McpCallReply<T = unknown> {
  success: boolean
  data?: T
  error?: string
  cancelled?: boolean
  timing?: McpCallTiming
}

/** `callId` + the History scope ids (`McpCallOptions` in types/mcp.ts). */
export type McpCallOpts = McpCallContext & { callId?: string }

export interface McpCallApi {
  callTool(
    connectionId: string,
    toolName: string,
    args: unknown,
    ctx?: McpCallOpts,
  ): Promise<McpCallReply>
  respondInput?(
    connectionId: string,
    toolName: string,
    args: unknown,
    requestState: string | undefined,
    inputResponses: Record<string, unknown>,
    ctx?: McpCallOpts,
  ): Promise<McpCallReply>
  readResource?(
    connectionId: string,
    uri: string,
    opts?: McpCallOpts,
  ): Promise<McpCallReply<McpReadResourceResult>>
  getPrompt?(
    connectionId: string,
    name: string,
    args: Record<string, string>,
    opts?: McpCallOpts,
  ): Promise<McpCallReply<McpGetPromptResult>>
  cancelCall?(connectionId: string, callId: string): Promise<IpcResult<{ cancelled: boolean }>>
  onElicitation?(callback: (event: McpElicitationEvent) => void): () => void
  respondElicitation?(
    connectionId: string,
    elicitationId: string,
    result: McpElicitationResult,
  ): Promise<IpcResult<unknown>>
}

/** The bridge seen through the call-lifecycle contract above. */
export function getMcpCallApi(): McpCallApi | undefined {
  return getMcpApi() as unknown as McpCallApi | undefined
}
