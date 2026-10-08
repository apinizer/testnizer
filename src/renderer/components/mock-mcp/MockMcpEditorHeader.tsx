import { ExternalLink, Play, Save, Square, Undo2 } from 'lucide-react'
import { useMockMcpStore, stoppedState } from '../../stores/mock-mcp.store'
import { useTranslation } from '../../lib/i18n'
import { toast } from '../../lib/toast'
import type { MockMcpServer } from '../../types/mock-mcp'
import { connectUrl, sseConnectUrl } from './mock-mcp-draft'
import { openMockInMcpTab } from './mock-mcp-tabs'
import { GhostButton, PrimaryButton } from './ui'
import { CopyButton, StatusDot } from './ui-display'
import { STATUS_KEYS } from './mock-mcp-format'

function UrlLine({ label, url, testId }: { label: string; url: string; testId: string }) {
  const { t } = useTranslation()
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
      <span className="shrink-0 text-[var(--muted)]">{label}</span>
      <span data-testid={testId} className="truncate font-mono text-[var(--text)]" title={url}>
        {url}
      </span>
      <CopyButton text={url} title={t('mockMcp.copyUrl')} />
    </div>
  )
}

/**
 * Editor header: name + live status, connect URL(s), Start/Stop, Open in MCP
 * tab, and Save / Discard for the draft. URLs and "Open in MCP" use the SAVED
 * config (what the live server runs), not unsaved edits.
 */
export default function MockMcpEditorHeader({
  server,
  dirty,
  saving,
  onSave,
  onDiscard,
}: {
  server: MockMcpServer
  dirty: boolean
  saving: boolean
  onSave: () => void
  onDiscard: () => void
}) {
  const { t } = useTranslation()
  const live = useMockMcpStore((s) => s.stateByServer[server.id]) ?? stoppedState(server.id)
  const startServer = useMockMcpStore((s) => s.startServer)
  const stopServer = useMockMcpStore((s) => s.stopServer)
  const running = live.status === 'running'
  const url = connectUrl(server, live.url)

  const toggle = async (): Promise<void> => {
    const err = running ? await stopServer(server.id) : await startServer(server.id)
    if (err) toast.error(err)
  }

  const openInMcp = (): void => {
    if (!running) toast.info(t('mockMcp.notRunningHint'))
    openMockInMcpTab({
      name: server.name,
      url,
      bearerToken: server.authMode === 'bearer' ? server.bearerToken : undefined,
    })
  }

  return (
    <div className="flex shrink-0 items-start gap-3 border-b border-[var(--border)] bg-[var(--white)] px-4 py-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded border border-[var(--accent)] px-1 text-[9px] font-bold leading-[14px] text-[var(--accent-text)]">
            MCP
          </span>
          <h2 className="m-0 truncate text-[15px] font-semibold text-[var(--heading)]">
            {server.name}
          </h2>
          <span
            data-testid="mock-mcp-status"
            className="inline-flex shrink-0 items-center gap-1.5 rounded border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--text)]"
          >
            <StatusDot status={live.status} />
            {t(STATUS_KEYS[live.status])}
          </span>
          {dirty && (
            <span
              data-testid="mock-mcp-unsaved"
              className="shrink-0 rounded bg-[var(--surface)] px-1.5 py-0.5 text-[11px] text-[var(--orange)]"
            >
              {t('mockMcp.unsaved')}
            </span>
          )}
        </div>
        <UrlLine label={t('mockMcp.urlStreamable')} url={url} testId="mock-mcp-url" />
        {server.legacySse && (
          <UrlLine
            label={t('mockMcp.urlSse')}
            url={sseConnectUrl(server, live.sseUrl)}
            testId="mock-mcp-sse-url"
          />
        )}
        {live.status === 'error' && live.errorMessage && (
          <div className="text-[11px] text-[var(--red)]">{live.errorMessage}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <GhostButton
          data-testid={running ? 'mock-mcp-stop' : 'mock-mcp-start'}
          onClick={() => void toggle()}
          disabled={live.status === 'starting'}
          className={running ? 'text-[var(--red)]' : 'text-[var(--green)]'}
        >
          {running ? <Square size={12} /> : <Play size={12} />}
          {running ? t('mock.stop') : t('mock.start')}
        </GhostButton>
        <GhostButton data-testid="mock-mcp-open-in-mcp" onClick={openInMcp}>
          <ExternalLink size={12} />
          {t('mockMcp.openInMcp')}
        </GhostButton>
        {dirty && (
          <GhostButton
            data-testid="mock-mcp-discard"
            onClick={onDiscard}
            title={t('mockMcp.discard')}
          >
            <Undo2 size={12} />
          </GhostButton>
        )}
        <PrimaryButton data-testid="mock-mcp-save" onClick={onSave} disabled={!dirty || saving}>
          <Save size={12} />
          {saving ? t('mockMcp.saving') : t('mockMcp.save')}
        </PrimaryButton>
      </div>
    </div>
  )
}
