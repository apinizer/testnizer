/**
 * Pure helpers of the MCP config tab strip (Authorization · Headers ·
 * Environment). Kept out of the component files so Fast Refresh keeps
 * working (`react-refresh/only-export-components`) and they unit-test alone.
 */
import type { KeyValuePair } from '../../../types'
import type { McpAuthConfig, McpTransport } from '../../../types/mcp'
import { scrubCommandLineCredentials, scrubUrlCredentials } from '../../../lib/credential-text'

/** Enabled rows with a key — the count badge on the Headers / Environment tab. */
export function enabledRowCount(rows: readonly KeyValuePair[]): number {
  return rows.filter((r) => r.enabled && r.key.trim()).length
}

/** "Sent as" line under the Authorization fields — names only, never a value. */
export function sentAsPreview(auth: McpAuthConfig): string | null {
  switch (auth.type) {
    case 'basic':
      return 'Authorization: Basic <base64(username:password)>'
    case 'bearer':
      return `Authorization: ${auth.bearer?.prefix?.trim() || 'Bearer'} <token>`
    case 'api-key': {
      const key = auth.apiKey?.key.trim() || '<key>'
      return auth.apiKey?.in === 'query' ? `?${key}=<value>` : `${key}: <value>`
    }
    default:
      return null
  }
}

/**
 * Issue #247: the URL (`?api_key=…`, `user:pass@`) or stdio command line
 * (`--token …`) holds a literal credential the tab snapshot leaves out — the
 * condition of the restart hint under the MCP connection bar.
 */
export function mcpUrlHasLiteralCredential(transport: McpTransport, url: string): boolean {
  const scrubbed =
    transport === 'stdio' ? scrubCommandLineCredentials(url) : scrubUrlCredentials(url)
  return scrubbed !== url
}
