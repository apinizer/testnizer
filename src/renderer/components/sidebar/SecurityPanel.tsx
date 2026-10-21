import { useState } from 'react'
import { useTabsStore } from '../../stores/tabs.store'
import { MCP_SECURITY_SECTION, useMcpStore } from '../../stores/mcp.store'
import { useTranslation } from '../../lib/i18n'
import { SECURITY_ACTIONS, SECURITY_TOOLS, type SecurityActionId } from '../../lib/tools-catalog'
import { openMcpSecurityScan } from '../../lib/open-mcp-security'
import { T } from '../../styles/tokens'
import LeftPanelCollapseButton from '../layout/LeftPanelCollapseButton'
import SecurityRow from './SecurityRow'

/** What each Security-page action row does (issue #229). */
const RUN_ACTION: Record<SecurityActionId, () => void> = {
  'mcp-scan': () => void openMcpSecurityScan(),
}

/**
 * The Security left-panel — Testnizer's differentiator, grouping all
 * key-material / PKI / token / identity capabilities in one place:
 *   • Stores — persistent, encrypted managed material (keystore library,
 *     certificates); populated as Keystore Studio (#59) and the Key Material
 *     Provider (#60) land.
 *   • Tools — the security tools (Keystore Studio, JWK, JOSE/JWT, WS-Security,
 *     TLS Inspector, OTP, Password Generator), sourced from `SECURITY_TOOLS`,
 *     then the action rows of `SECURITY_ACTIONS` (MCP Security Scan, #229) —
 *     same row, but they run an action instead of opening a tool tab.
 * Mirrors ToolsPanel so the two panels stay visually consistent.
 */
export default function SecurityPanel() {
  const { t } = useTranslation()
  const openToolTab = useTabsStore((s) => s.openToolTab)
  const activeTabProtocol = useTabsStore((s) => {
    const active = s.tabs.find((tab) => tab.id === s.activeTabId)
    return active?.protocol ?? null
  })
  const activeTabId = useTabsStore((s) => s.activeTabId)
  // The MCP live slice is the active tab's once Workbench has activated it.
  const mcpShowsSecurity = useMcpStore(
    (s) => s._currentTabId === activeTabId && s.section === MCP_SECURITY_SECTION,
  )
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const matches = (labelKey: string) => !q || t(labelKey).toLowerCase().includes(q)
  const tools = SECURITY_TOOLS.filter((tool) => matches(tool.labelKey))
  const actions = SECURITY_ACTIONS.filter((action) => matches(action.labelKey))
  const isActionActive = (id: SecurityActionId) =>
    id === 'mcp-scan' && activeTabProtocol === 'mcp' && mcpShowsSecurity

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div
        style={{
          height: 44,
          borderBottom: `1px solid ${T.border}`,
          display: 'flex',
          alignItems: 'center',
          padding: '0 10px',
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 15, color: T.text, flex: 1 }}>
          {t('sidebar.security')}
        </span>
        <LeftPanelCollapseButton />
      </div>

      {/* Search */}
      <div style={{ padding: '8px 10px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            background: T.surface,
            border: `1.5px solid ${T.border2}`,
            borderRadius: 8,
            padding: '6px 10px',
            gap: 7,
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke={T.ghost}
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            aria-label={t('leftPanel.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('leftPanel.search')}
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 13,
              color: T.text,
              width: '100%',
              fontFamily: 'inherit',
            }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ padding: '6px 6px' }}>
        {/* No "Stores" section here on purpose. It used to render a standing
            promise — "keystores and certificates you save appear here" — that
            nothing ever fulfilled: saving to the library writes a row that only
            Keystore Studio's own start screen reads. Two surfaces for one list
            is worse than one, and an empty section that never fills reads as a
            lost save. The library lives with the tool that owns it. */}

        {/* Tools section. */}
        {!q && <SectionHeader label={t('security.tools')} />}
        {tools.map((tool) => (
          <SecurityRow
            key={tool.protocol}
            testId={tool.protocol}
            Icon={tool.Icon}
            label={t(tool.labelKey)}
            bg={tool.bg}
            color={tool.color}
            isActive={activeTabProtocol === tool.protocol}
            onSelect={() => openToolTab(tool.protocol, t(tool.labelKey))}
          />
        ))}
        {actions.map((action) => (
          <SecurityRow
            key={action.id}
            testId={action.id}
            Icon={action.Icon}
            label={t(action.labelKey)}
            hint={t(action.hintKey)}
            bg={action.bg}
            color={action.color}
            isActive={isActionActive(action.id)}
            onSelect={RUN_ACTION[action.id]}
          />
        ))}
        {tools.length + actions.length === 0 && (
          <div style={{ padding: 12, fontSize: 12, color: T.ghost, textAlign: 'center' }}>—</div>
        )}
      </div>
    </div>
  )
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: '8px 10px 4px',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        color: T.muted,
      }}
    >
      {label}
    </div>
  )
}
