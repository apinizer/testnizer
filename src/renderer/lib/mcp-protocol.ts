/**
 * MCP protocol eras on the client tab (issue #152) — pure, no store / IPC.
 *
 * The `protocol` connect option: `auto` probes with `server/discover` and
 * falls back to the 2025 `initialize` handshake, `legacy` skips the probe,
 * `2026-07-28` pins the modern era, a 2025-era revision makes `initialize`
 * offer exactly that version (the engine's `resolveNegotiation`).
 */
import type {
  McpConnectResult,
  McpProtocolChoice,
  McpSubscriptionFilter,
  McpSubscriptionView,
} from '../types/mcp'
import { normalizeMcpProtocolOption } from '../../shared/mcp-call'

/** The first modern-era revision (stateless, `server/discover`). */
export const MCP_MODERN_VERSION = '2026-07-28'

/**
 * 2024/2025 revisions the bundled SDK negotiates through `initialize` — the
 * legacy pins. Mirrors the SDK's `SUPPORTED_PROTOCOL_VERSIONS` (the renderer
 * cannot import it; a drift-guard test compares the two).
 */
export const MCP_LEGACY_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
] as const

export const DEFAULT_MCP_PROTOCOL: McpProtocolChoice = 'auto'

/**
 * Tolerant read of a stored / pasted value: anything unknown becomes `auto`.
 * The rule Run applies too (`src/shared/mcp-call.ts`).
 */
export function normalizeMcpProtocol(value: unknown): McpProtocolChoice {
  return normalizeMcpProtocolOption(value)
}

/** `server/discover` descriptor lines for the badge tooltip (supported versions). */
export function describeDiscover(discover: Record<string, unknown> | null): string[] {
  if (!discover) return []
  const versions = Array.isArray(discover.supportedVersions)
    ? discover.supportedVersions.filter((v): v is string => typeof v === 'string')
    : []
  return versions.length > 0 ? [versions.join(', ')] : []
}

const FILTER_LABELS: Record<string, string> = {
  toolsListChanged: 'tools',
  promptsListChanged: 'prompts',
  resourcesListChanged: 'resources',
}

/** `{ toolsListChanged: true, promptsListChanged: true }` → `tools, prompts`. */
export function describeSubscriptionFilter(filter: McpSubscriptionFilter | undefined): string {
  if (!filter) return ''
  return Object.entries(filter)
    .filter(([, v]) => v === true || (typeof v === 'object' && v !== null))
    .map(([k]) => FILTER_LABELS[k] ?? k.replace(/ListChanged$/, ''))
    .join(', ')
}

/** The connect result's `subscription` as the tab shows it (null when none was opened). */
export function subscriptionFromConnect(
  info: McpConnectResult['subscription'] | undefined,
): McpSubscriptionView | null {
  if (!info) return null
  if (info.error) return { state: 'error', reason: info.error }
  return { state: 'open', ...(info.honoredFilter ? { honoredFilter: info.honoredFilter } : {}) }
}
