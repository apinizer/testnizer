import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, Bookmark, Copy, Info, Radio } from 'lucide-react'
import { useTranslation } from '../../../lib/i18n'
import { useCopy } from '../../../lib/use-copy'
import { formatBytes, formatLogTime } from '../../../lib/realtime-format'
import { formatDateTime } from '../../../lib/format-datetime'
import type { LogKind } from './use-realtime-log'

const ICON_BTN =
  'flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded border-none bg-transparent text-[var(--muted)] hover:bg-[var(--white)] hover:text-[var(--text)]'

/**
 * One message-log row shared by the WebSocket log and the Socket.IO timeline
 * (issues #282 / #283): select box (two selected rows show their time
 * difference), direction icon, title + preview, type badge, local time, and
 * the hover actions Copy / Save (as a saved message) / Info (size, time,
 * type). Clicking the row expands it (`children`).
 */
export default function RealtimeLogRow({
  kind,
  title,
  preview,
  badge,
  tone,
  timestamp,
  sizeBytes,
  typeLabel,
  copyText,
  onSave,
  selected,
  onToggleSelect,
  expanded,
  onToggleExpand,
  testId,
  testIdPrefix,
  direction,
  children,
}: {
  kind: LogKind
  title?: ReactNode
  preview: string
  badge?: string
  /** `error` paints the title red (a failed ack, a connect error). */
  tone?: 'error'
  timestamp: number
  /** Info popover: payload size (omitted for connection rows) and type. */
  sizeBytes?: number
  typeLabel?: string
  copyText: string
  onSave?: () => void
  selected: boolean
  onToggleSelect: () => void
  expanded: boolean
  onToggleExpand: () => void
  testId: string
  testIdPrefix: string
  direction: string
  children?: ReactNode
}) {
  const { t, locale } = useTranslation()
  const { copied, copy } = useCopy()
  const Icon = kind === 'sent' ? ArrowUp : kind === 'received' ? ArrowDown : Radio
  const iconColor =
    kind === 'sent'
      ? 'text-[var(--blue)]'
      : kind === 'received'
        ? 'text-[var(--green)]'
        : 'text-[var(--orange)]'
  const id = (s: string): string => `${testIdPrefix}-row-${s}`
  const info = [
    sizeBytes !== undefined ? t('rt.log.infoSize').replace('{size}', formatBytes(sizeBytes)) : '',
    t('rt.log.infoTime').replace('{time}', formatDateTime(timestamp, locale)),
    typeLabel ? t('rt.log.infoType').replace('{type}', typeLabel) : '',
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <div
      data-testid={testId}
      data-direction={direction}
      data-selected={selected || undefined}
      className={`group cursor-pointer border-b border-[var(--border)] px-3 py-1.5 transition-colors hover:bg-[var(--surface)] ${
        selected ? 'bg-[var(--accent-light)]' : ''
      }`}
      onClick={onToggleExpand}
    >
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          aria-label={t('rt.log.select')}
          data-testid={id('select')}
          className="shrink-0 accent-[var(--accent)]"
        />
        <Icon size={12} aria-hidden className={`shrink-0 ${iconColor}`} />
        {title !== undefined && (
          <span
            className={`shrink-0 font-semibold ${tone === 'error' ? 'text-[var(--red)]' : 'text-[var(--text)]'}`}
          >
            {title}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[var(--text)]" title={preview}>
          {preview}
        </span>
        {badge && (
          // `lang` keeps the upper-casing Turkish in TR ("İKİLİ", not "IKILI").
          <span
            lang={locale}
            data-testid={id('badge')}
            className="shrink-0 rounded bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-medium uppercase text-[var(--muted)]"
          >
            {badge}
          </span>
        )}
        <span className="shrink-0 tabular-nums text-[var(--hint)]">{formatLogTime(timestamp)}</span>
        <span
          className="flex shrink-0 items-center opacity-60 group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => void copy(copyText)}
            aria-label={t('rt.log.copy')}
            title={copied ? t('tools.common.copied') : t('rt.log.copy')}
            data-testid={id('copy')}
            className={ICON_BTN}
          >
            <Copy size={12} />
          </button>
          {onSave && (
            <button
              type="button"
              onClick={onSave}
              aria-label={t('rt.log.save')}
              title={t('rt.log.save')}
              data-testid={id('save')}
              className={ICON_BTN}
            >
              <Bookmark size={12} />
            </button>
          )}
          <span
            role="img"
            aria-label={info}
            title={info}
            data-testid={id('info')}
            className={ICON_BTN}
          >
            <Info size={12} />
          </span>
        </span>
      </div>
      {expanded && children}
    </div>
  )
}
