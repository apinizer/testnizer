import { useTranslation } from '../../lib/i18n'

/**
 * "Critical" chip on run-sequence and run-result rows (issue #304): the
 * request stops the run when it does not pass. Same small pill as the status
 * badge (`StatusBadge` pill palette, red tone) so it reads as a row property,
 * not as a result.
 */
export default function CriticalBadge() {
  const { t } = useTranslation()
  return (
    <span
      data-testid="critical-badge"
      title={t('runResults.badgeCriticalTitle')}
      className="inline-flex shrink-0 items-center rounded-[4px] px-1.5 text-[11px] font-semibold leading-[18px] text-[var(--red)]"
      style={{ background: 'rgba(239,68,68,0.14)', border: '1px solid rgba(239,68,68,0.32)' }}
    >
      {t('runResults.badgeCritical')}
    </span>
  )
}
