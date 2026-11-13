import { ShieldAlert } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'

/**
 * Marks a Flow row of the run sequence Critical (issue #315) — the same flag
 * as the Settings tab's switch (`CriticalRequestToggle`), whose help text it
 * shows as its tooltip. Sits next to `CriticalBadge`, which says the state in
 * words; this control only changes it.
 */
export default function CriticalToggle({
  name,
  critical,
  onChange,
}: {
  name: string
  critical: boolean
  onChange: (critical: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      draggable={false}
      aria-pressed={critical}
      aria-label={t('runSequence.markCritical', { name })}
      title={t('settingsTab.criticalHelp')}
      data-testid="critical-toggle"
      onClick={(e) => {
        e.stopPropagation()
        onChange(!critical)
      }}
      className={`flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent transition-colors hover:bg-[var(--item-hover)] ${
        critical ? 'text-[var(--red)]' : 'text-[var(--hint)] hover:text-[var(--red)]'
      }`}
    >
      <ShieldAlert size={14} aria-hidden="true" />
    </button>
  )
}
