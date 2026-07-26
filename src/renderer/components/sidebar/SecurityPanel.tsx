import { useState } from 'react'
import { useTabsStore } from '../../stores/tabs.store'
import { useTranslation } from '../../lib/i18n'
import { SECURITY_TOOLS } from '../../lib/tools-catalog'
import { T } from '../../styles/tokens'

/**
 * The Security left-panel — Testnizer's differentiator, grouping all
 * key-material / PKI / token / identity capabilities in one place:
 *   • Stores — persistent, encrypted managed material (keystore library,
 *     certificates); populated as Keystore Studio (#59) and the Key Material
 *     Provider (#60) land.
 *   • Tools — the security tools (Keystore Studio, JWK, JOSE/JWT, WS-Security,
 *     TLS Inspector, OTP, Password Generator), sourced from `SECURITY_TOOLS`.
 * Mirrors ToolsPanel so the two panels stay visually consistent.
 */
export default function SecurityPanel() {
  const { t } = useTranslation()
  const openToolTab = useTabsStore((s) => s.openToolTab)
  const activeTabProtocol = useTabsStore((s) => {
    const active = s.tabs.find((tab) => tab.id === s.activeTabId)
    return active?.protocol ?? null
  })
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const tools = q
    ? SECURITY_TOOLS.filter((tool) => t(tool.labelKey).toLowerCase().includes(q))
    : SECURITY_TOOLS

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
        <span style={{ fontWeight: 700, fontSize: 15, color: T.text }}>
          {t('sidebar.security')}
        </span>
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
        {tools.map((tool) => {
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
        {tools.length === 0 && (
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
