import { useUIStore } from '../../stores/ui.store'
import { useEnvironmentStore } from '../../stores/environment.store'
import { T } from '../../styles/tokens'

export default function Footer() {
  const environments = useEnvironmentStore((s) => s.environments)
  const activeEnvId = useEnvironmentStore((s) => s.activeEnvironmentId)
  const activeEnv = environments.find((e) => e.id === activeEnvId)
  const setShowCollectionRunner = useUIStore((s) => s.setShowCollectionRunner)

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
        fontSize: 12,
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
        onClick={() => setShowCollectionRunner(true)}
      >
        ▶ Çalıştır
      </span>
      <span style={{ color: T.ghost, cursor: 'pointer', fontFamily: 'inherit' }}>Konsol</span>
      <span style={{ color: T.ghost, cursor: 'pointer', fontFamily: 'inherit' }}>?</span>
    </footer>
  )
}
