import { Terminal, AlertCircle } from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useEnvironmentStore } from '../../stores/environment.store'
import { useTabsStore } from '../../stores/tabs.store'
import { useConsoleStore } from '../../stores/console.store'
import { T } from '../../styles/tokens'

export default function Footer() {
  const environments = useEnvironmentStore((s) => s.environments)
  const activeEnvId = useEnvironmentStore((s) => s.activeEnvironmentId)
  const activeEnv = environments.find((e) => e.id === activeEnvId)
  const openTab = useTabsStore((s) => s.openTab)
  const showConsolePanel = useUIStore((s) => s.showConsolePanel)
  const toggleConsolePanel = useUIStore((s) => s.toggleConsolePanel)
  const consoleEntries = useConsoleStore((s) => s.entries)
  const errorCount = consoleEntries.filter((e) => (e.status && e.status >= 400) || e.error).length

  return (
    <footer
      style={{
        height: 28,
        background: T.white,
        borderTop: `1px solid ${T.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '0 14px',
        flexShrink: 0,
        fontSize: 13,
        fontFamily: 'inherit',
      }}
    >
      {/* Left */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: T.muted }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: T.POST.color }} />
        Hazır
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: T.muted }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        {activeEnv?.name || 'Üretim'}
      </div>

      <div style={{ flex: 1 }} />

      {/* Right */}
      <span
        style={{ color: T.ghost, cursor: 'pointer', fontFamily: 'inherit' }}
        onClick={() => openTab({ id: 'runner-all-' + Date.now(), name: 'Runner', protocol: 'runner' })}
      >
        ▶ Çalıştır
      </span>
      <button
        type="button"
        onClick={toggleConsolePanel}
        title="Console (Alt+Ctrl+C)"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          background: 'transparent',
          border: 'none',
          padding: '2px 6px',
          borderRadius: 4,
          color: showConsolePanel ? T.accent : T.ghost,
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 13,
          fontWeight: showConsolePanel ? 600 : 400,
        }}
      >
        <Terminal size={11} />
        Konsol
        {errorCount > 0 && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
              color: 'var(--red)',
              fontWeight: 600,
            }}
          >
            <AlertCircle size={10} />
            {errorCount}
          </span>
        )}
      </button>
      <span style={{ color: T.ghost, cursor: 'pointer', fontFamily: 'inherit' }}>?</span>
    </footer>
  )
}
