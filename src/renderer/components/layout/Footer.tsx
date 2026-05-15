import { Terminal, AlertCircle, Building2 } from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useEnvironmentStore } from '../../stores/environment.store'
import { useConsoleStore } from '../../stores/console.store'
import { T } from '../../styles/tokens'
import { useTranslation } from '../../lib/i18n'

export default function Footer() {
  const environments = useEnvironmentStore((s) => s.environments)
  const activeEnvId = useEnvironmentStore((s) => s.activeEnvironmentId)
  const activeEnv = environments.find((e) => e.id === activeEnvId)
  const showConsolePanel = useUIStore((s) => s.showConsolePanel)
  const toggleConsolePanel = useUIStore((s) => s.toggleConsolePanel)
  const setShowEnterpriseModal = useUIStore((s) => s.setShowEnterpriseModal)
  const consoleEntries = useConsoleStore((s) => s.entries)
  const errorCount = consoleEntries.filter(
    (e) => e.level === 'error' || (e.status != null && e.status >= 400),
  ).length
  const { t } = useTranslation()

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
        {t('footer.ready')}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: T.muted }}>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        {activeEnv?.name || t('footer.noEnvironment')}
      </div>

      <div style={{ flex: 1 }} />

      {/* Right */}
      <button
        type="button"
        onClick={() => setShowEnterpriseModal(true)}
        title={t('about.enterpriseTitle')}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          background: 'transparent',
          border: 'none',
          padding: '2px 6px',
          borderRadius: 4,
          color: T.ghost,
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 13,
        }}
      >
        <Building2 size={11} aria-hidden="true" />
        {t('footer.enterprise')}
      </button>
      {/* "Runner" footer entry removed in v1.4.0 — the Tests sidebar's
       *  Overview / All Runs / Scheduled Tasks entries cover the runner
       *  surface explicitly and a duplicate footer link confused users
       *  who couldn't tell it apart from the inline runner tabs. */}
      <button
        type="button"
        onClick={toggleConsolePanel}
        title={`${t('footer.console')} (Alt+Ctrl+C)`}
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
        <Terminal size={11} aria-hidden="true" />
        {t('footer.console')}
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
            <AlertCircle size={10} aria-hidden="true" />
            {errorCount}
          </span>
        )}
      </button>
    </footer>
  )
}
