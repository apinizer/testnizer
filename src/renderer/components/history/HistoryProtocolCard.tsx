/**
 * One card of the History overview: a protocol (or "All") with its request
 * count, success rate and newest time. Clicking it filters the table; the
 * picked card is pressed. Same anatomy as the Tests overview's stat cards.
 */
import { useTranslation } from '../../lib/i18n'
import type { ProtocolStat } from './history-overview'
import { formatWhen } from './history-format'

export default function HistoryProtocolCard({
  testId,
  label,
  stat,
  selected,
  onClick,
}: {
  testId: string
  label: string
  stat: Omit<ProtocolStat, 'protocol'>
  selected: boolean
  onClick: () => void
}) {
  const { t, locale } = useTranslation()
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={selected}
      onClick={onClick}
      className={`cursor-pointer rounded-[10px] border-[1.5px] p-3 text-left transition-colors hover:border-[var(--accent)] ${
        selected
          ? 'border-[var(--accent)] bg-[var(--accent-light)]'
          : 'border-[var(--border)] bg-[var(--white)]'
      }`}
    >
      <div className="text-sm font-medium text-[var(--muted)]">{label}</div>
      <div
        data-testid={`${testId}-count`}
        className="text-3xl leading-[1.2] font-bold text-[var(--text)]"
      >
        {stat.count.toLocaleString(locale === 'tr' ? 'tr-TR' : undefined)}
      </div>
      <div className="text-xs text-[var(--muted)]">
        {stat.okRate == null
          ? t('historyHome.noStatus')
          : t('historyHome.okRate', { rate: stat.okRate })}
      </div>
      {stat.count > 0 && (
        <div className="text-xs text-[var(--hint)]">
          {t('historyHome.last', { when: formatWhen(stat.last, t, locale) })}
        </div>
      )}
    </button>
  )
}
