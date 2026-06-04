import { useState } from 'react'
import { useTabsStore } from '../../stores/tabs.store'
import { useTranslation } from '../../lib/i18n'
import { TOOL_CATALOG } from '../../lib/tools-catalog'
import { T } from '../../styles/tokens'

export default function ToolsPanel() {
  const { t } = useTranslation()
  const openToolTab = useTabsStore((s) => s.openToolTab)
  const activeTabProtocol = useTabsStore((s) => {
    const active = s.tabs.find((tab) => tab.id === s.activeTabId)
    return active?.protocol ?? null
  })
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const filtered = q
    ? TOOL_CATALOG.filter((tool) => t(tool.labelKey).toLowerCase().includes(q))
    : TOOL_CATALOG

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
        <span style={{ fontWeight: 700, fontSize: 15, color: T.text }}>{t('sidebar.tools')}</span>
      </div>

      {/* Search */}
      <div
        style={{
          padding: '8px 10px',
          borderBottom: `1px solid ${T.border}`,
          flexShrink: 0,
        }}
      >
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

      {/* Tool list */}
      <div className="flex-1 overflow-y-auto" style={{ padding: '6px 6px' }}>
        {filtered.map((tool) => {
          const isActive = activeTabProtocol === tool.protocol
          return (
            <button
              key={tool.protocol}
              type="button"
              onClick={() => openToolTab(tool.protocol, t(tool.labelKey))}
              aria-current={isActive ? 'page' : undefined}
              className="group flex w-full cursor-pointer items-center gap-2.5 rounded-lg transition-colors"
              style={{
                background: isActive ? T.accentBg : 'transparent',
                border: 'none',
                padding: '8px 10px',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => {
                if (!isActive) (e.currentTarget as HTMLElement).style.background = T.surface
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLElement).style.background = isActive
                  ? T.accentBg
                  : 'transparent'
              }}
            >
              <div
                aria-hidden="true"
                className="flex shrink-0 items-center justify-center rounded-md"
                style={{ width: 28, height: 28, background: tool.bg }}
              >
                <tool.Icon size={15} style={{ color: tool.color }} strokeWidth={2} />
              </div>
              <span
                style={{
                  fontSize: 13,
                  color: isActive ? T.accentText : T.text,
                  fontWeight: isActive ? 600 : 500,
                }}
              >
                {t(tool.labelKey)}
              </span>
            </button>
          )
        })}
        {filtered.length === 0 && (
          <div style={{ padding: 12, fontSize: 12, color: T.ghost, textAlign: 'center' }}>—</div>
        )}
      </div>
    </div>
  )
}
