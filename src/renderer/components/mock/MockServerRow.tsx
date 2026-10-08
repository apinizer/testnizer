/**
 * One mock server in the Mocks panel — the SAME row for HTTP mocks and Mock
 * MCP servers (issue #140): kind badge, name, status dot + text, address with
 * a copy button, and Start/Stop + Delete on the right. Presentational only;
 * the group components wire it to their store.
 */
import type { ReactNode } from 'react'
import { Play, Square, Trash2 } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import { CopyButton, StatusDot } from '../mock-mcp/ui-display'
import { STATUS_KEYS } from '../mock-mcp/mock-mcp-format'

export type MockRowStatus = 'stopped' | 'starting' | 'running' | 'error'
export type MockRowKind = 'http' | 'mcp'

function RowIconButton({
  title,
  onClick,
  tone,
  testId,
  children,
}: {
  title: string
  onClick: () => void
  tone: 'green' | 'red'
  testId: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      data-testid={testId}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded border border-[var(--border)] bg-transparent hover:bg-[var(--surface)] ${
        tone === 'green' ? 'text-[var(--green)]' : 'text-[var(--red)]'
      }`}
    >
      <span aria-hidden="true" className="inline-flex">
        {children}
      </span>
    </button>
  )
}

export function MockKindBadge({ kind }: { kind: MockRowKind }) {
  return (
    <span
      className="inline-flex min-w-[42px] shrink-0 items-center justify-center whitespace-nowrap rounded border border-[var(--accent)] px-1 font-bold text-[var(--accent-text)]"
      // font-size set inline: globals.css `* { font-size: inherit }` is unlayered and beats text-* utilities
      style={{ fontSize: 9, lineHeight: '14px' }}
    >
      {kind === 'http' ? 'HTTP' : 'MCP'}
    </span>
  )
}

export interface MockServerRowProps {
  kind: MockRowKind
  /** testid prefix: `mock-http` / `mock-mcp` → `<prefix>-row-<id>`, `<prefix>-start`, … */
  testIdPrefix: string
  id: string
  name: string
  status: MockRowStatus
  /** Shown in the row (e.g. `127.0.0.1:3001`, or the MCP connect URL). */
  address: string
  /** What the copy button copies (a full URL). */
  copyText: string
  errorMessage?: string | null
  onOpen: () => void
  onStart: () => void
  onStop: () => void
  onDelete: () => void
}

export default function MockServerRow(p: MockServerRowProps) {
  const { t } = useTranslation()
  const running = p.status === 'running'
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`${p.testIdPrefix}-row-${p.id}`}
      onClick={p.onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') p.onOpen()
      }}
      className="flex cursor-pointer items-center gap-2 border-b border-[var(--border)] px-3 py-2.5 hover:bg-[var(--surface)]"
    >
      <MockKindBadge kind={p.kind} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-[var(--text)]">{p.name}</div>
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--muted)]">
          <StatusDot status={p.status} />
          <span data-testid={`${p.testIdPrefix}-row-status`} className="shrink-0">
            {t(STATUS_KEYS[p.status])}
          </span>
          <span className="truncate font-mono" title={p.copyText}>
            {p.address}
          </span>
          <CopyButton
            text={p.copyText}
            title={t('mockMcp.copyUrl')}
            testId={`${p.testIdPrefix}-copy-url`}
          />
        </div>
        {p.status === 'error' && p.errorMessage && (
          <div className="truncate text-[11px] text-[var(--red)]" title={p.errorMessage}>
            {p.errorMessage}
          </div>
        )}
      </div>
      <div className="flex shrink-0 gap-1">
        {running ? (
          <RowIconButton
            title={t('mock.stop')}
            onClick={p.onStop}
            tone="red"
            testId={`${p.testIdPrefix}-stop`}
          >
            <Square size={12} />
          </RowIconButton>
        ) : (
          <RowIconButton
            title={t('mock.start')}
            onClick={p.onStart}
            tone="green"
            testId={`${p.testIdPrefix}-start`}
          >
            <Play size={12} />
          </RowIconButton>
        )}
        <RowIconButton
          title={t('mock.delete')}
          onClick={p.onDelete}
          tone="red"
          testId={`${p.testIdPrefix}-delete`}
        >
          <Trash2 size={12} />
        </RowIconButton>
      </div>
    </div>
  )
}
