import type { ReactElement } from 'react'
import type { AiTurnMetrics } from '../../../../shared/ai-chat-types'
import { formatMs as ms, metricsTooltip } from '../../../lib/ai-chat-view'
import { useTranslation } from '../../../lib/i18n'

/**
 * Per-message metrics (issue #198, Postman parity): status, time to first
 * token, total time, tokens (breakdown on hover), timestamp. Usage a provider
 * did not report is "not reported" — never 0.
 */
export default function AiChatMetricsRow({
  metrics,
  timestamp,
}: {
  metrics?: AiTurnMetrics
  timestamp: number
}): ReactElement {
  const { t } = useTranslation()
  const time = new Date(timestamp).toLocaleTimeString()
  if (!metrics) {
    return (
      <div className="mt-1 text-[var(--hint)]" style={{ fontSize: 11 }} data-testid="ai-metrics">
        {time}
      </div>
    )
  }
  const ok = metrics.status !== null && metrics.status < 400
  return (
    <div
      className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[var(--hint)]"
      style={{ fontSize: 11 }}
      data-testid="ai-metrics"
    >
      <span data-testid="ai-metrics-status" style={{ color: ok ? 'var(--green)' : 'var(--red)' }}>
        {metrics.status ?? '—'}
      </span>
      <span>
        {t('aiChat.metrics.ttfb')} {ms(metrics.ttfbMs)}
      </span>
      <span>
        {t('aiChat.metrics.total')} {ms(metrics.durationMs)}
      </span>
      <span
        title={metricsTooltip(metrics, t)}
        data-testid="ai-metrics-tokens"
        className="cursor-help underline decoration-dotted"
      >
        {metrics.usageReported && metrics.totalTokens !== undefined
          ? `${metrics.totalTokens} ${t('aiChat.metrics.tokens')}`
          : `${t('aiChat.metrics.tokens')}: ${t('aiChat.metrics.notReported')}`}
      </span>
      {metrics.calls.length > 1 && (
        <span>
          {metrics.calls.length} {t('aiChat.metrics.calls')}
        </span>
      )}
      <span>{time}</span>
    </div>
  )
}
