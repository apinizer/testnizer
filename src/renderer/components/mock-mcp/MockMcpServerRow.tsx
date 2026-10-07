import { Play, Square, Trash2 } from 'lucide-react'
import { useMockMcpStore, stoppedState } from '../../stores/mock-mcp.store'
import { useTranslation } from '../../lib/i18n'
import { toast } from '../../lib/toast'
import type { MockMcpServer } from '../../types/mock-mcp'
import { connectUrl } from './mock-mcp-draft'
import { CopyButton, StatusDot } from './ui-display'
import { STATUS_KEYS } from './mock-mcp-format'

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
  testId?: string
  children: React.ReactNode
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
      className={`flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded border border-[var(--border)] bg-transparent ${
        tone === 'green' ? 'text-[var(--green)]' : 'text-[var(--red)]'
      }`}
    >
      <span aria-hidden="true" className="inline-flex">
        {children}
      </span>
    </button>
  )
}

/** One Mock MCP server in the Mocks panel: badge, status, URL copy, start/stop, delete. */
export default function MockMcpServerRow({
  server,
  onOpen,
  onDelete,
}: {
  server: MockMcpServer
  onOpen: (server: MockMcpServer) => void
  onDelete: (server: MockMcpServer) => void
}) {
  const { t } = useTranslation()
  const live = useMockMcpStore((s) => s.stateByServer[server.id]) ?? stoppedState(server.id)
  const startServer = useMockMcpStore((s) => s.startServer)
  const stopServer = useMockMcpStore((s) => s.stopServer)
  const url = connectUrl(server, live.url)
  const running = live.status === 'running'

  const start = async (): Promise<void> => {
    const err = await startServer(server.id)
    if (err) toast.error(err)
  }
  const stop = async (): Promise<void> => {
    const err = await stopServer(server.id)
    if (err) toast.error(err)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`mock-mcp-row-${server.id}`}
      onClick={() => onOpen(server)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(server)
      }}
      className="flex cursor-pointer items-center gap-2 border-b border-[var(--border)] px-3 py-2.5 hover:bg-[var(--surface)]"
    >
      <span className="shrink-0 rounded border border-[var(--accent)] px-1 text-[9px] font-bold leading-[14px] text-[var(--accent-text)]">
        MCP
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-[var(--text)]">{server.name}</div>
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--muted)]">
          <StatusDot status={live.status} />
          <span data-testid="mock-mcp-row-status" className="shrink-0">
            {t(STATUS_KEYS[live.status])}
          </span>
          <span className="truncate font-mono" title={url}>
            {url}
          </span>
          <CopyButton text={url} title={t('mockMcp.copyUrl')} testId="mock-mcp-copy-url" />
        </div>
        {live.status === 'error' && live.errorMessage && (
          <div className="truncate text-[11px] text-[var(--red)]" title={live.errorMessage}>
            {live.errorMessage}
          </div>
        )}
      </div>
      <div className="flex shrink-0 gap-1">
        {running ? (
          <RowIconButton title={t('mock.stop')} onClick={stop} tone="red" testId="mock-mcp-stop">
            <Square size={12} />
          </RowIconButton>
        ) : (
          <RowIconButton
            title={t('mock.start')}
            onClick={start}
            tone="green"
            testId="mock-mcp-start"
          >
            <Play size={12} />
          </RowIconButton>
        )}
        <RowIconButton
          title={t('mock.delete')}
          onClick={() => onDelete(server)}
          tone="red"
          testId="mock-mcp-delete"
        >
          <Trash2 size={12} />
        </RowIconButton>
      </div>
    </div>
  )
}
