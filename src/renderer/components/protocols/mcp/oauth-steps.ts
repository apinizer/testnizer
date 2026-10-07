import type { McpOAuthStep, McpOAuthStepId } from '../../../types/mcp'

/**
 * The seven steps of the MCP OAuth 2.1 debugger (issue #141), in flow order.
 * Mirrors `STEP_DEFS` in `src/main/protocols/mcp-oauth.engine.ts`; titles are
 * i18n keys (`mcp.oauth.step.<id>`), the engine's English title is the
 * fallback.
 */
export const MCP_OAUTH_STEP_IDS: readonly McpOAuthStepId[] = [
  'probe',
  'resource-metadata',
  'auth-server-metadata',
  'client-registration',
  'authorization-request',
  'authorization-callback',
  'token-exchange',
]

/** One row per step: the latest record from main, or a pending placeholder. */
export function stepRows(records: McpOAuthStep[]): McpOAuthStep[] {
  return MCP_OAUTH_STEP_IDS.map(
    (id, i) =>
      records.find((r) => r.id === id) ?? { id, index: i + 1, title: id, status: 'pending' },
  )
}

/** `{ a: 1 }` header maps as `name: value` lines. */
export function headerLines(headers: Record<string, string> | undefined): string {
  return Object.entries(headers ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}
