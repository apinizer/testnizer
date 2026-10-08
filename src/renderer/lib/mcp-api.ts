import type { McpBridge } from '../types/mcp'

/**
 * Typed accessor for the `window.api.mcp` bridge (issue #139). The cast goes
 * through `McpBridge` (types/mcp.ts) so the renderer codes against the IPC
 * contract even when the preload declaration lags behind; the newer members
 * are optional there, and every caller checks for them before use.
 */
export function getMcpApi(): McpBridge | undefined {
  if (typeof window === 'undefined') return undefined
  const api = (window as unknown as { api?: { mcp?: unknown } }).api
  return api?.mcp as McpBridge | undefined
}
