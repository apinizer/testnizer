import type { ComponentType } from 'react'

/**
 * Extension point of the MCP editor (issue #139). Each entry becomes an extra
 * tab of the editor's right pane, next to the Tools / Resources / Prompts
 * explorer. Later phases add exactly one file + one entry here — e.g. the
 * OAuth debugger (Phase C) and the security scan (Phase D) — without touching
 * `McpEditor.tsx`. A section reads what it needs from `useMcpStore` itself.
 */
export interface McpSection {
  /** Stable id; also the tab's test id suffix (`mcp-section-<id>`). */
  id: string
  /** Tab label — an i18n key or plain text (passed through `t()`). */
  label: string
  component: ComponentType
}

export const MCP_EXTRA_SECTIONS: McpSection[] = []
