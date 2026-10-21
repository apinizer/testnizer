import { BellRing, ExternalLink, Save, Undo2 } from 'lucide-react'
import { useMockMcpStore, stoppedState, getMockMcpApi } from '../../stores/mock-mcp.store'
import { useTranslation } from '../../lib/i18n'
import { toast } from '../../lib/toast'
import type { MockMcpServer } from '../../types/mock-mcp'
import { connectUrl, sseConnectUrl } from './mock-mcp-draft'
import { openMockInMcpTab } from './mock-mcp-tabs'
import { GhostButton, PrimaryButton } from './ui'
import { ERA_KEYS, sortEras } from './mock-mcp-format'
import MockEditorHeader, { MockStartStopButton, MockUrlLine } from '../mock/MockEditorHeader'
import { useStartThenOpenGate } from '../mock/start-then-open-gate'
import { startThenOpen } from '../mock/mock-open-in-tab'

/**
 * Editor header: name + live status, connect URL(s), Start/Stop, Open in MCP
 * tab, and Save / Discard for the draft. URLs and "Open in MCP" use the SAVED
 * config (what the live server runs), not unsaved edits. Stopped → "Start &
 * open in MCP tab": starts first and opens only on success, like the SSE / AI
 * mocks (issue #222, `useStartThenOpenGate`).
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

  /** Announce `tools/list_changed` now (2026-07-28 listeners + legacy SSE sessions). */
  const notifyTools = async (): Promise<void> => {
    const res = await getMockMcpApi()?.server.notify(server.id, 'tools')
    if (res?.success && res.data) toast.success(t('mockMcp.eras.notified'))
    else toast.error(res?.error ?? t('mockMcp.notRunningHint'))
  }
  const eras = running ? sortEras(live.eras ?? []) : []

  const openGate = useStartThenOpenGate(live.status, () => startServer(server.id), {
    open: 'mockMcp.openInMcp',
    startAndOpen: 'mockMcp.startAndOpenInMcp',
  })
  const openInMcp = (): void => {
    void startThenOpen(openGate.gate, () =>
      openMockInMcpTab({
        name: server.name,
        // Read after the start: the live URL the server just reported.
        url: connectUrl(server, useMockMcpStore.getState().stateByServer[server.id]?.url),
        bearerToken: server.authMode === 'bearer' ? server.bearerToken : undefined,
      }),
    )
  }

  return (
    <MockEditorHeader
      kind="mcp"
      name={server.name}
      status={live.status}
      testIdPrefix="mock-mcp"
      errorMessage={live.status === 'error' ? live.errorMessage : null}
      titleExtras={
        dirty && (
          <span
            data-testid="mock-mcp-unsaved"
            className="shrink-0 rounded bg-[var(--surface)] px-1.5 py-0.5 text-[11px] text-[var(--orange)]"
          >
            {t('mockMcp.unsaved')}
          </span>
        )
      }
      actions={
        <>
          <MockStartStopButton
            status={live.status}
            testIdPrefix="mock-mcp"
            onToggle={() => void toggle()}
          />
          {running && (
            <GhostButton
              data-testid="mock-mcp-notify"
              onClick={() => void notifyTools()}
              title={t('mockMcp.eras.notifyHint')}
            >
              <BellRing size={12} />
              {t('mockMcp.eras.notify')}
            </GhostButton>
          )}
          <GhostButton
            data-testid="mock-mcp-open-in-mcp"
            onClick={openInMcp}
            disabled={openGate.starting}
            title={openGate.label}
          >
            <ExternalLink size={12} />
            {openGate.label}
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
          {/* One Save for the whole draft — every tab (issue #210). */}
          <PrimaryButton
            data-testid="mock-mcp-save"
            onClick={onSave}
            disabled={!dirty || saving}
            title={t('mockMcp.saveAllHint')}
          >
            <Save size={12} />
            {saving ? t('mockMcp.saving') : t('mockMcp.save')}
          </PrimaryButton>
        </>
      }
    >
      <MockUrlLine label={t('mockMcp.urlStreamable')} url={url} testId="mock-mcp-url" />
      {server.legacySse && (
        <MockUrlLine
          label={t('mockMcp.urlSse')}
          url={sseConnectUrl(server, live.sseUrl)}
          testId="mock-mcp-sse-url"
        />
      )}
      {eras.length > 0 && (
        <div data-testid="mock-mcp-eras" className="text-[11px] text-[var(--muted)]">
          {t('mockMcp.eras.label')}: {eras.map((e) => t(ERA_KEYS[e])).join(' + ')}
          {eras.includes('legacy') && live.legacyNotifications === false && (
            <span className="text-[var(--hint)]"> · {t('mockMcp.eras.legacyNoNotify')}</span>
          )}
        </div>
      )}
    </MockEditorHeader>
  )
}
