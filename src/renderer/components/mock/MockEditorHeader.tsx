/**
 * The editor header every mock server kind shares (HTTP, SSE, AI and Mock MCP;
 * issues #140, #221): kind badge + name + translated live status on the first
 * line, connect URL line(s) under it, actions on the right. One component so
 * the four headers cannot drift apart — the HTTP header used to hard-code hex
 * colours and show the raw English status string next to the MCP one.
 *
 * Testids are prefixed per kind family (`mock` / `mock-mcp`) so existing specs
 * keep finding `mock-status`, `mock-start`, `mock-mcp-status`, …
 */
import type { ReactNode } from 'react'
import { Play, Square } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import { GhostButton } from '../mock-mcp/ui'
import { CopyButton, StatusDot } from '../mock-mcp/ui-display'
import { STATUS_KEYS } from '../mock-mcp/mock-mcp-format'
import { MockKindBadge, type MockRowKind, type MockRowStatus } from './MockServerRow'

/** A labelled, copyable URL line under the header title. */
export function MockUrlLine({
  label,
  url,
  testId,
}: {
  label: string
  url: string
  testId: string
}) {
  const { t } = useTranslation()
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
      <span className="shrink-0 text-[var(--muted)]">{label}</span>
      <span data-testid={testId} className="truncate font-mono text-[var(--text)]" title={url}>
        {url}
      </span>
      <CopyButton text={url} title={t('mockMcp.copyUrl')} testId={`${testId}-copy`} />
    </div>
  )
}

/** Start / Stop as a ghost button — green Start, red Stop, disabled while starting. */
export function MockStartStopButton({
  status,
  testIdPrefix,
  onToggle,
}: {
  status: MockRowStatus
  testIdPrefix: string
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const running = status === 'running'
  return (
    <GhostButton
      data-testid={running ? `${testIdPrefix}-stop` : `${testIdPrefix}-start`}
      onClick={onToggle}
      disabled={status === 'starting'}
      className={running ? 'text-[var(--red)]' : 'text-[var(--green)]'}
    >
      {running ? <Square size={12} /> : <Play size={12} />}
      {running ? t('mock.stop') : t('mock.start')}
    </GhostButton>
  )
}

export default function MockEditorHeader({
  kind,
  name,
  status,
  testIdPrefix,
  titleExtras,
  errorMessage,
  actions,
  children,
}: {
  kind: MockRowKind
  name: string
  status: MockRowStatus
  /** `mock` → `mock-status`; `mock-mcp` → `mock-mcp-status`. */
  testIdPrefix: string
  /** After the status pill on the title line (e.g. the MCP "unsaved" tag). */
  titleExtras?: ReactNode
  /** Shown in red under the URL lines. */
  errorMessage?: string | null
  /** Right-hand buttons. */
  actions: ReactNode
  /** URL lines and other notes under the title. */
  children?: ReactNode
}) {
  const { t } = useTranslation()
  // Narrow window / font 16 / Turkish (PM review #4): the title block keeps a
  // rem minimum and the actions wrap — first onto a row of their own under
  // the title, then button by button. The actions used to be `shrink-0`, so
  // at 1024 px the name collapsed to 0 and the buttons overlapped the badge.
  return (
    <div
      data-testid={`${testIdPrefix}-header`}
      className="flex shrink-0 flex-wrap items-start gap-x-3 gap-y-2 border-b border-[var(--border)] bg-[var(--white)] px-4 py-2"
    >
      <div className="flex min-w-[min(100%,18rem)] flex-1 basis-[18rem] flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <MockKindBadge kind={kind} testId="mock-kind-badge" />
          <h2
            data-testid={`${testIdPrefix}-header-name`}
            title={name}
            className="m-0 min-w-0 truncate text-[15px] font-semibold text-[var(--heading)]"
          >
            {name}
          </h2>
          <span
            data-testid={`${testIdPrefix}-status`}
            data-status={status}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--text)]"
          >
            <StatusDot status={status} />
            {t(STATUS_KEYS[status])}
          </span>
          {titleExtras}
        </div>
        {children}
        {errorMessage && (
          <div data-testid={`${testIdPrefix}-error`} className="text-[11px] text-[var(--red)]">
            {errorMessage}
          </div>
        )}
      </div>
      <div
        data-testid={`${testIdPrefix}-header-actions`}
        className="flex min-w-0 max-w-full flex-wrap items-center gap-2"
      >
        {actions}
      </div>
    </div>
  )
}
