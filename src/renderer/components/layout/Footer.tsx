import { Globe, Wifi, Cookie, Trash2, HelpCircle } from 'lucide-react'
import { useEnvironmentStore } from '../../stores/environment.store'
import { useUIStore } from '../../stores/ui.store'
import { useTranslation } from '../../lib/i18n'

export default function Footer() {
  const environments = useEnvironmentStore((s) => s.environments)
  const activeEnvId = useEnvironmentStore((s) => s.activeEnvironmentId)
  const activeEnv = environments.find((e) => e.id === activeEnvId)
  const setShowCollectionRunner = useUIStore((s) => s.setShowCollectionRunner)
  const { t } = useTranslation()

  return (
    <footer
      className="flex shrink-0 items-center text-[0.875rem]"
      style={{
        height: 36,
        background: 'var(--white)',
        borderTop: '1px solid var(--border)',
      }}
    >
      {/* Left side */}
      <div className="flex items-center gap-3" style={{ paddingLeft: 12 }}>
        <span className="cursor-pointer" style={{ color: 'var(--muted)' }}>
          {t('footer.designFirst')}
        </span>
        <span className="cursor-pointer" style={{ color: 'var(--muted)' }}>
          {t('footer.requestFirst')}
        </span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right side */}
      <div className="flex items-center gap-3" style={{ paddingRight: 12 }}>
        {/* Online */}
        <div className="flex items-center gap-1" style={{ color: 'var(--muted)' }}>
          <Wifi size={11} style={{ color: 'var(--green)' }} />
          <span>{t('footer.online')}</span>
        </div>

        {/* Environment */}
        <div className="flex items-center gap-1" style={{ color: 'var(--muted)' }}>
          <Globe size={11} />
          {activeEnv?.name || t('footer.noEnvironment')}
        </div>

        {/* Runner */}
        <span
          className="cursor-pointer"
          style={{ color: 'var(--muted)' }}
          onClick={() => setShowCollectionRunner(true)}
        >
          {'\u25B6'} {t('footer.runner')}
        </span>

        {/* Cookies */}
        <span className="flex cursor-pointer items-center gap-1" style={{ color: 'var(--muted)' }}>
          <Cookie size={11} />
          {t('footer.cookies')}
        </span>

        {/* Trash */}
        <span className="flex cursor-pointer items-center gap-1" style={{ color: 'var(--muted)' }}>
          <Trash2 size={11} />
          {t('footer.trash')}
        </span>

        {/* Help */}
        <span className="flex cursor-pointer items-center gap-1" style={{ color: 'var(--muted)' }}>
          <HelpCircle size={11} />
          {t('footer.help')}
        </span>
      </div>
    </footer>
  )
}
