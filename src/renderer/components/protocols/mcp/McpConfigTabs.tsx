import type { ComponentType } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useMcpStore } from '../../../stores/mcp.store'
import { availableConfigTabs, effectiveConfigTab } from '../../../stores/mcp-auth.slice'
import type { McpConfigTab } from '../../../types/mcp'
import { useTranslation } from '../../../lib/i18n'
import McpAuthSection from './McpAuthSection'
import McpHeadersSection from './McpHeadersSection'
import McpStdioEnvSection from './McpStdioEnvSection'
import { enabledRowCount } from './config-ui'

const LABEL_KEYS: Record<McpConfigTab, string> = {
  auth: 'mcp.config.auth',
  headers: 'mcp.config.headers',
  env: 'mcp.config.env',
}

/** Pre-tab-strip e2e hooks, kept on the tab label (issue #137 / #139 specs). */
const LEGACY_TOGGLE_IDS: Partial<Record<McpConfigTab, string>> = {
  headers: 'mcp-headers-toggle',
  env: 'mcp-env-toggle',
}

const PANELS: Record<McpConfigTab, ComponentType> = {
  auth: McpAuthSection,
  headers: McpHeadersSection,
  env: McpStdioEnvSection,
}

/**
 * Postman-style request config strip under the MCP connection bar:
 * Authorization · Headers (http / sse) · Environment (stdio), with a count
 * badge of the enabled rows and a chevron that folds the whole panel away.
 * Active tab and fold state are per tab in the store (persisted). Clicking a
 * tab always shows it — only the chevron folds.
 */
export default function McpConfigTabs() {
  const { t } = useTranslation()
  const transport = useMcpStore((s) => s.transport)
  const storedTab = useMcpStore((s) => s.configTab)
  const collapsed = useMcpStore((s) => s.configCollapsed)
  const setConfigTab = useMcpStore((s) => s.setConfigTab)
  const setCollapsed = useMcpStore((s) => s.setConfigCollapsed)
  const authType = useMcpStore((s) => s.auth.type)
  const headerCount = useMcpStore((s) => enabledRowCount(s.customHeaders))
  const envCount = useMcpStore((s) => enabledRowCount(s.envVars))

  // Derived, never written back: switching transport keeps the stored choice.
  const active = effectiveConfigTab(storedTab, transport)
  const counts: Partial<Record<McpConfigTab, number>> = { headers: headerCount, env: envCount }
  const Panel = PANELS[active]

  return (
    <div data-testid="mcp-config" className="shrink-0 border-b border-[var(--border)]">
      <div className="flex items-center gap-1 px-2">
        <div role="tablist" className="flex min-w-0 items-center gap-1">
          {availableConfigTabs(transport).map((id) => {
            const selected = !collapsed && active === id
            const count = counts[id] ?? 0
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected}
                data-testid={`mcp-config-tab-${id}`}
                onClick={() => setConfigTab(id)}
                className={`flex cursor-pointer items-center gap-1.5 border-x-0 border-t-0 border-b-2 bg-transparent px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
                  selected
                    ? 'border-[var(--accent)] text-[var(--accent-text)]'
                    : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                <span data-testid={LEGACY_TOGGLE_IDS[id]}>{t(LABEL_KEYS[id])}</span>
                {id === 'auth' && authType !== 'none' && (
                  <span
                    data-testid="mcp-config-auth-dot"
                    aria-hidden="true"
                    className="h-1.5 w-1.5 rounded-full bg-[var(--green)]"
                  />
                )}
                {count > 0 && (
                  <span
                    data-testid={`mcp-${id}-count`}
                    className="rounded-full bg-[var(--green-bg)] px-[5px] text-[10px] text-[var(--green)]"
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          data-testid="mcp-config-collapse"
          aria-expanded={!collapsed}
          aria-label={collapsed ? t('mcp.config.expand') : t('mcp.config.collapse')}
          title={collapsed ? t('mcp.config.expand') : t('mcp.config.collapse')}
          className="ml-auto flex h-6 w-6 cursor-pointer items-center justify-center rounded border-none bg-transparent text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
        >
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>
      {!collapsed && (
        <div
          role="tabpanel"
          data-testid={`mcp-config-panel-${active}`}
          className="max-h-[45vh] overflow-auto border-t border-[var(--border)] px-3.5 py-2.5"
        >
          <Panel />
        </div>
      )}
    </div>
  )
}
