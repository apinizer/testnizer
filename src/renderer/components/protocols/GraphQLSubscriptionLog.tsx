import { useEffect, useRef, useState } from 'react'
import { Trash2, Unplug } from 'lucide-react'
import { useGraphQLStore, type GqlSubscriptionEvent } from '../../stores/graphql.store'
import { useTranslation } from '../../lib/i18n'
import { formatCount } from '../../lib/plural'
import { formatClock } from '../../lib/format-datetime'
import { subscriptionEndText } from '../../lib/graphql-subscription-text'

function formatJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2)
  } catch {
    return str
  }
}

const KIND_CLS: Record<GqlSubscriptionEvent['kind'], string> = {
  data: 'bg-[var(--accent-light)] text-[var(--accent-text)]',
  error: 'bg-[var(--red)]/10 text-[var(--red)]',
}

const STATUS_CLS: Record<string, string> = {
  connecting: 'bg-[var(--surface)] text-[var(--muted)]',
  connected: 'bg-[var(--green-bg)] text-[var(--green)]',
  disconnected: 'bg-[var(--surface)] text-[var(--muted)]',
  error: 'bg-[var(--red)]/10 text-[var(--red)]',
}

/**
 * The events of THIS tab's subscription, kept per tab by the store. Stays on
 * screen after the subscription ends, with why it ended.
 */
export default function GraphQLSubscriptionLog() {
  const { t, locale } = useTranslation()
  const events = useGraphQLStore((s) => s.subscriptionEvents)
  const dropped = useGraphQLStore((s) => s.subscriptionDropped)
  const clearEvents = useGraphQLStore((s) => s.clearSubscriptionEvents)
  const unsubscribe = useGraphQLStore((s) => s.unsubscribe)
  const state = useGraphQLStore((s) => s.subscriptionState)
  const failure = useGraphQLStore((s) => s.subscriptionError)
  const end = useGraphQLStore((s) => s.subscriptionEnd)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [events, autoScroll])

  const active = state === 'connecting' || state === 'connected'
  const statusLabel =
    state === 'connected'
      ? t('graphql.live')
      : state === 'connecting'
        ? t('graphql.sub.status.connecting')
        : state === 'error'
          ? t('graphql.sub.status.failed')
          : t('graphql.sub.status.ended')

  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-[var(--white)]"
      lang={locale}
      data-testid="graphql-subscription-log"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-3.5 py-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-[var(--accent-text)]">
            {t('graphql.subscriptionEvents')}
          </span>
          <span
            role="status"
            aria-live="polite"
            data-testid="graphql-subscription-status"
            data-state={state}
            className={`rounded-full px-2 py-0.5 font-medium ${STATUS_CLS[state]}`}
          >
            {statusLabel}
          </span>
        </div>
        {active && (
          <button
            type="button"
            onClick={unsubscribe}
            data-testid="graphql-unsubscribe"
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border-none bg-[var(--red)] px-3 py-1.5 font-medium text-white transition-opacity"
          >
            <Unplug size={12} aria-hidden="true" />
            {state === 'connecting' ? t('common.cancel') : t('graphql.unsubscribe')}
          </button>
        )}
      </div>

      {failure && (
        <div
          role="alert"
          data-testid="graphql-subscription-error"
          className="shrink-0 border-b border-[var(--border)] bg-[var(--red)]/10 px-3.5 py-2 text-[var(--red)] [overflow-wrap:anywhere]"
        >
          {failure}
        </div>
      )}
      {end && (
        <div
          role="status"
          data-testid="graphql-subscription-end"
          data-end={end.kind}
          className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-[var(--muted)] [overflow-wrap:anywhere]"
        >
          {subscriptionEndText(end)}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {events.length === 0
          ? active && (
              <div className="flex h-full items-center justify-center text-[var(--hint)]">
                {t('graphql.waitingEvents')}
              </div>
            )
          : events.map((event) => {
              const isExpanded = expandedId === event.id
              return (
                <div
                  key={event.id}
                  data-testid="graphql-subscription-event"
                  data-kind={event.kind}
                  className="cursor-pointer border-b border-[var(--border)] px-3 py-1.5 transition-colors hover:bg-[var(--surface)]"
                  onClick={() => setExpandedId(isExpanded ? null : event.id)}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 font-medium uppercase ${KIND_CLS[event.kind]}`}
                    >
                      {t(`graphql.sub.kind.${event.kind}`)}
                    </span>
                    <span
                      className="flex-1 truncate font-mono text-[var(--text)]"
                      title={event.data}
                    >
                      {event.data.replace(/\n/g, ' ')}
                    </span>
                    <span className="shrink-0 tabular-nums text-[var(--hint)]">
                      {formatClock(event.timestamp, locale)}
                    </span>
                  </div>
                  {isExpanded && (
                    <pre className="mt-1.5 max-h-48 overflow-auto rounded-lg bg-[var(--surface)] p-2 font-mono text-[var(--text)]">
                      {formatJson(event.data)}
                    </pre>
                  )}
                </div>
              )
            })}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] bg-[var(--surface)] px-3 py-1.5">
        <span className="text-[var(--muted)]" data-testid="graphql-subscription-count">
          {formatCount(events.length, t('sse.eventCountOne'), t('sse.eventCount'))}
          {dropped > 0 &&
            ` · ${formatCount(dropped, t('graphql.sub.droppedOne'), t('graphql.sub.dropped'))}`}
        </span>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            <span className="text-[var(--muted)]">{t('console.autoScroll')}</span>
          </label>
          <button
            type="button"
            onClick={clearEvents}
            data-testid="graphql-subscription-clear"
            className="flex cursor-pointer items-center gap-1 border-none bg-transparent text-[var(--hint)] transition-colors hover:text-[var(--text)]"
          >
            <Trash2 size={11} aria-hidden="true" />
            {t('console.clear')}
          </button>
        </div>
      </div>
    </div>
  )
}
