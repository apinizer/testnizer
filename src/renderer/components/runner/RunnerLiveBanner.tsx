/**
 * Above any Runner view that is not the live run (Overview, All Runs, a past
 * report): a run is still going, and this is the way back to its progress and
 * Stop. Without it those views looked as if nothing were happening.
 */
import { useTranslation } from '../../lib/i18n'

export default function RunnerLiveBanner({
  current,
  total,
  onShow,
}: {
  current: number
  total: number
  onShow: () => void
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      data-testid="runner-live-banner"
      onClick={onShow}
      className="flex shrink-0 cursor-pointer items-center justify-between gap-3 border-0 border-b border-solid border-[var(--border)] bg-[var(--surface)] px-5 py-1.5 text-left text-[12px] text-[var(--text)]"
    >
      <span>
        {t('runResults.liveBanner')
          .replace('{current}', String(current))
          .replace('{total}', String(total))}
      </span>
      <span className="shrink-0 text-[var(--accent-text)]">{t('runResults.liveBannerShow')}</span>
    </button>
  )
}
