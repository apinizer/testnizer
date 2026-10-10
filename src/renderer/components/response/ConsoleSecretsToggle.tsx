import { useEffect } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useConsoleStore } from '../../stores/console.store'
import { useTranslation } from '../../lib/i18n'

/**
 * Per-session "Show secrets" toggle for the Console (issue #196).
 *
 * Main masks every Console entry before sending it (credential headers, API
 * keys, values of variables marked secret). Turning this on tells main to stop
 * masking NEW entries for this session; entries already received stay masked
 * (main keeps no raw copy). Off by default and never persisted — main holds
 * the flag in memory, so every app start masks again. Copy / export use what
 * is displayed, so they follow the mask too.
 */
export default function ConsoleSecretsToggle() {
  const { t } = useTranslation()
  const showSecrets = useConsoleStore((s) => s.showSecrets)
  const setShowSecrets = useConsoleStore((s) => s.setShowSecrets)
  const syncShowSecrets = useConsoleStore((s) => s.syncShowSecrets)

  // A renderer reload keeps main's flag — read it so the toggle never lies.
  useEffect(() => {
    void syncShowSecrets()
  }, [syncShowSecrets])

  return (
    <span className="flex items-center gap-1.5">
      <button
        type="button"
        role="switch"
        aria-checked={showSecrets}
        data-testid="console-show-secrets"
        onClick={() => void setShowSecrets(!showSecrets)}
        title={t('console.showSecretsHint')}
        className={`flex cursor-pointer items-center gap-1 rounded border border-[var(--border)] px-2 py-1 ${
          showSecrets
            ? 'bg-[var(--accentLight)] text-[var(--accentText)]'
            : 'bg-transparent text-[var(--muted)]'
        }`}
      >
        {showSecrets ? <Eye size={11} /> : <EyeOff size={11} />}
        {t('console.showSecrets')}
      </button>
      {showSecrets && (
        <span
          data-testid="console-show-secrets-warning"
          className="whitespace-nowrap text-[var(--orange)]"
          title={t('console.showSecretsHint')}
        >
          {t('console.showSecretsWarning')}
        </span>
      )}
    </span>
  )
}
