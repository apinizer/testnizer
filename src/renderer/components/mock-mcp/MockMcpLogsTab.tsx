import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useMockMcpStore } from '../../stores/mock-mcp.store'
import { useTranslation } from '../../lib/i18n'
import type { MockMcpLogEntry } from '../../types/mock-mcp'
import MockMcpLogRows, { LOG_GRID } from './MockMcpLogRows'
import { GhostButton } from './ui'
import { CopyButton } from './ui-display'

const EMPTY_LOGS: readonly MockMcpLogEntry[] = []

/** Pretty-print when the text is JSON; leave notes / truncated text as-is. */
function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function Pane({ title, text, testId }: { title: string; text: string; testId: string }) {
  const { t } = useTranslation()
  const body = pretty(text)
  return (
    <div className="flex min-w-0 flex-1 flex-col border-r border-[var(--border)] last:border-r-0">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
        {title}
        <span className="ml-auto">
          <CopyButton text={body} title={t('mockMcp.logs.copy')} />
        </span>
      </div>
      <pre
        data-testid={testId}
        className="m-0 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] text-[var(--text)]"
      >
        {body}
      </pre>
    </div>
  )
}

/** Live JSON-RPC log of one server; a row opens its request / response. */
export default function MockMcpLogsTab({ serverId }: { serverId: string }) {
  const { t } = useTranslation()
  const logs = useMockMcpStore((s) => s.logsByServer[serverId]) ?? EMPTY_LOGS
  const loadLogs = useMockMcpStore((s) => s.loadLogs)
  const clearLogs = useMockMcpStore((s) => s.clearLogs)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = selectedId ? logs.find((l) => l.id === selectedId) : undefined

  useEffect(() => {
    void loadLogs(serverId)
  }, [serverId, loadLogs])

  return (
    <div data-testid="mock-mcp-logs" className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--white)] px-3">
        <span className="text-[12px] text-[var(--muted)]">
          {t('mockMcp.logs.count').replace('{count}', String(logs.length))}
        </span>
        <GhostButton
          data-testid="mock-mcp-logs-clear"
          className="ml-auto"
          onClick={() => {
            setSelectedId(null)
            void clearLogs(serverId)
          }}
          disabled={logs.length === 0}
        >
          <Trash2 size={12} />
          {t('mockMcp.logs.clear')}
        </GhostButton>
      </div>
      <div
        className={`${LOG_GRID} h-7 shrink-0 items-center border-b border-[var(--border)] bg-[var(--surface)] px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]`}
      >
        <span>{t('mockMcp.logs.time')}</span>
        <span>{t('mockMcp.logs.method')}</span>
        <span>{t('mockMcp.logs.tool')}</span>
        <span className="text-right">{t('mockMcp.logs.duration')}</span>
        <span>{t('mockMcp.logs.result')}</span>
      </div>
      {logs.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-[13px] text-[var(--hint)]">
          {t('mockMcp.logs.empty')}
        </div>
      ) : (
        <MockMcpLogRows entries={logs} selectedId={selectedId} onSelect={setSelectedId} />
      )}
      {selected && (
        <div
          data-testid="mock-mcp-log-detail"
          className="flex h-[45%] shrink-0 border-t border-[var(--border)] bg-[var(--white)]"
        >
          <Pane
            title={t('mockMcp.logs.request')}
            text={selected.request}
            testId="mock-mcp-log-request"
          />
          <Pane
            title={t('mockMcp.logs.response')}
            text={selected.response}
            testId="mock-mcp-log-response"
          />
        </div>
      )}
    </div>
  )
}
