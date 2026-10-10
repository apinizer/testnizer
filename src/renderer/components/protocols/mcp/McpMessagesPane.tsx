import { useState } from 'react'
import { ArrowDownLeft, ArrowDownToLine, ArrowUpRight, ChevronDown, ChevronUp } from 'lucide-react'
import { useMcpStore } from '../../../stores/mcp.store'
import { useTranslation } from '../../../lib/i18n'
import {
  describeFrame,
  describeNotification,
  formatLogTime,
  truncatedFrameInfo,
} from '../../../lib/mcp-store-helpers'
import type { McpFrame, McpSubscriptionView } from '../../../types/mcp'
import { describeSubscriptionFilter } from '../../../lib/mcp-protocol'
import { useMessagesPaneLayout } from './use-messages-pane-layout'
import McpLogView from './McpLogView'

type SubTab = 'notifications' | 'frames'

const FRAME_TONE: Record<string, string> = {
  error: 'text-[var(--red)]',
  result: 'text-[var(--green)]',
  notification: 'text-[var(--muted)]',
}

/**
 * Detail for a frame. An oversized frame arrives cut down to
 * `{ jsonrpc, id?, method?, _truncated: { chars, preview } }` — show the
 * envelope plus the preview text as text, not as an escaped JSON string.
 */
function frameDetail(f: McpFrame, note: string): unknown {
  const info = f.truncated ? truncatedFrameInfo(f.message) : null
  if (!info) return f.message
  const envelope = { ...(f.message as Record<string, unknown>) }
  delete envelope._truncated
  return `${JSON.stringify(envelope, null, 2)}\n\n${note.replace('{chars}', String(info.chars))}\n\n${info.preview}`
}

/**
 * 2026-07-28 `subscriptions/listen` state (issue #152): what the server agreed
 * to deliver, or why the stream is not (or no longer) open.
 */
function SubscriptionBadge({ sub }: { sub: McpSubscriptionView }) {
  const { t } = useTranslation()
  const text =
    sub.state === 'open'
      ? `${t('mcp.subscription.open')}: ${describeSubscriptionFilter(sub.honoredFilter) || t('mcp.subscription.nothing')}`
      : sub.state === 'error'
        ? t('mcp.subscription.failed')
        : `${t('mcp.subscription.closed')}${sub.reason ? ` (${sub.reason})` : ''}`
  return (
    <span
      data-testid="mcp-subscription"
      data-state={sub.state}
      title={sub.state === 'error' ? sub.reason : t('mcp.subscription.hint')}
      className={`ml-auto truncate text-[11px] ${
        sub.state === 'open' ? 'text-[var(--green)]' : 'text-[var(--orange)]'
      }`}
    >
      {text}
    </span>
  )
}

/**
 * Collapsible bottom pane of the MCP editor (issue #139): server
 * notifications and the raw JSON-RPC frames of this tab's connection.
 */
export default function McpMessagesPane() {
  const { t } = useTranslation()
  const { open, height, setOpen, startResize } = useMessagesPaneLayout()
  // Follow new entries; scrolling up pauses it, the toggle (or scrolling back
  // to the bottom) resumes it. Session-only — on by default (issue #172).
  const [follow, setFollow] = useState(true)
  const [tab, setTab] = useState<SubTab>('notifications')
  const notifications = useMcpStore((s) => s.notifications)
  const frames = useMcpStore((s) => s.frames)
  const clearNotifications = useMcpStore((s) => s.clearNotifications)
  const clearFrames = useMcpStore((s) => s.clearFrames)
  const subscription = useMcpStore((s) => s.subscription)

  const subTabs: { id: SubTab; label: string; count: number }[] = [
    { id: 'notifications', label: t('mcp.messages.notifications'), count: notifications.length },
    { id: 'frames', label: t('mcp.messages.frames'), count: frames.length },
  ]

  return (
    <div
      data-testid="mcp-messages-pane"
      // Capped at half the editor and the first thing to give way (issue #155
      // class): a remembered 600 px must never squeeze the capability pane —
      // and its Run button — out of a short window.
      className="relative flex min-h-[28px] max-h-[50%] shrink flex-col border-t border-[var(--border)]"
      style={open ? { height } : undefined}
    >
      {open && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('mcp.messages.resize')}
          title={t('mcp.messages.resize')}
          data-testid="mcp-messages-resize"
          onMouseDown={startResize}
          className="absolute inset-x-0 -top-0.5 z-10 h-1.5 cursor-row-resize hover:bg-[var(--accent)]"
        />
      )}
      <div className="flex shrink-0 items-center gap-1 bg-[var(--surface)] px-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          data-testid="mcp-messages-toggle"
          aria-expanded={open}
          className="flex cursor-pointer items-center gap-1 border-none bg-transparent px-1.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]"
        >
          {open ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          {t('mcp.messages.title')}
        </button>
        {subTabs.map((st) => (
          <button
            key={st.id}
            type="button"
            data-testid={`mcp-messages-tab-${st.id}`}
            aria-selected={open && tab === st.id}
            onClick={() => {
              setTab(st.id)
              setOpen(true)
            }}
            className={`cursor-pointer rounded border-none px-2 py-1 text-[12px] ${
              open && tab === st.id
                ? 'bg-[var(--accent-light)] text-[var(--accent-text)]'
                : 'bg-transparent text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            {st.label} <span className="text-[11px]">({st.count})</span>
          </button>
        ))}
        {subscription && <SubscriptionBadge sub={subscription} />}
        <button
          type="button"
          onClick={() => setFollow((v) => !v)}
          aria-pressed={follow}
          data-testid="mcp-messages-autoscroll"
          title={t('mcp.messages.autoScrollHint')}
          className={`flex shrink-0 cursor-pointer items-center gap-1 rounded border-none px-1.5 py-1 text-[11px] ${
            subscription ? '' : 'ml-auto'
          } ${
            follow
              ? 'bg-[var(--accent-light)] text-[var(--accent-text)]'
              : 'bg-transparent text-[var(--muted)] hover:text-[var(--text)]'
          }`}
        >
          <ArrowDownToLine size={12} />
          {t('mcp.messages.autoScroll')}
        </button>
      </div>
      {open && tab === 'notifications' && (
        <McpLogView
          items={notifications}
          testId="mcp-notifications"
          searchText={(n) => `${n.method} ${JSON.stringify(n.params ?? '')}`.toLowerCase()}
          detail={(n) => ({ method: n.method, params: n.params })}
          onClear={clearNotifications}
          emptyText={t('mcp.messages.noNotifications')}
          exportName="mcp-notifications"
          follow={follow}
          onFollowChange={setFollow}
          renderRow={(n) => (
            <>
              <span className="shrink-0 font-mono text-[11px] text-[var(--muted)]">
                {formatLogTime(n.ts)}
              </span>
              <span className="shrink-0 font-mono">{n.method}</span>
              <span className="truncate text-[var(--muted)]">
                {describeNotification(n.method, n.params)}
              </span>
            </>
          )}
        />
      )}
      {open && tab === 'frames' && (
        <McpLogView
          items={frames}
          testId="mcp-frames"
          searchText={(f) => `${describeFrame(f.message).label} ${f.direction}`.toLowerCase()}
          detail={(f) => frameDetail(f, t('mcp.messages.truncatedNote'))}
          onClear={clearFrames}
          emptyText={t('mcp.messages.noFrames')}
          exportName="mcp-frames"
          follow={follow}
          onFollowChange={setFollow}
          renderRow={(f) => {
            const { kind, label } = describeFrame(f.message)
            return (
              <>
                {f.direction === 'out' ? (
                  <ArrowUpRight
                    size={13}
                    className="shrink-0 text-[var(--accent)]"
                    aria-label="out"
                  />
                ) : (
                  <ArrowDownLeft
                    size={13}
                    className="shrink-0 text-[var(--green)]"
                    aria-label="in"
                  />
                )}
                <span className="shrink-0 font-mono text-[11px] text-[var(--muted)]">
                  {formatLogTime(f.ts)}
                </span>
                <span className={`truncate font-mono ${FRAME_TONE[kind] ?? ''}`}>{label}</span>
                {f.truncated && (
                  <span
                    data-testid="mcp-frame-truncated"
                    className="shrink-0 rounded bg-[var(--surface)] px-1 text-[10px] text-[var(--orange)]"
                  >
                    {t('mcp.messages.truncated')}
                  </span>
                )}
              </>
            )
          }}
        />
      )}
    </div>
  )
}
