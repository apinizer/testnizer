import { Inbox, Play } from 'lucide-react'
import { useMcpStore } from '../../../stores/mcp.store'
import { useTranslation } from '../../../lib/i18n'
import EmptyState from '../../shared/EmptyState'
import McpResultView from './McpResultView'
import McpInputRequiredCard from './McpInputRequiredCard'
import McpDescription from './McpDescription'
import { CenterHint, ErrorLine, JsonPre, PrimaryButton, SectionLabel } from './ui'

const HINT_BADGES: {
  key: 'readOnlyHint' | 'destructiveHint' | 'idempotentHint' | 'openWorldHint'
  tone: string
}[] = [
  { key: 'readOnlyHint', tone: 'bg-[var(--green-bg)] text-[var(--green)]' },
  { key: 'destructiveHint', tone: 'bg-[var(--mb-delete-bg)] text-[var(--mb-delete-fg)]' },
  { key: 'idempotentHint', tone: 'bg-[var(--mb-get-bg)] text-[var(--mb-get-fg)]' },
  { key: 'openWorldHint', tone: 'bg-[var(--mb-put-bg)] text-[var(--mb-put-fg)]' },
]

/** Right pane for the Tools tab: JSON arguments, Invoke, rendered result. */
export default function McpToolPane() {
  const { t } = useTranslation()
  const selectedTool = useMcpStore((s) => s.selectedTool)
  const tools = useMcpStore((s) => s.tools)
  const toolArgs = useMcpStore((s) => s.toolArgs)
  const setToolArgs = useMcpStore((s) => s.setToolArgs)
  const callTool = useMcpStore((s) => s.callTool)
  const isInvoking = useMcpStore((s) => s.isInvoking)
  const result = useMcpStore((s) => s.result)
  const resultError = useMcpStore((s) => s.resultError)
  const pendingInput = useMcpStore((s) => s.pendingInput)
  // Every MCP tab renders this same pane; the tab id in the card's key keeps
  // tab A's typed answers out of tab B paused at the same round.
  const tabId = useMcpStore((s) => s._currentTabId)
  const isConnected = useMcpStore((s) => s.connectionState === 'connected')

  if (!selectedTool) {
    return <CenterHint>{isConnected ? t('mcp.tool.select') : t('mcp.connectHint')}</CenterHint>
  }
  const def = tools.find((tool) => tool.name === selectedTool)
  const hintLabels: Record<(typeof HINT_BADGES)[number]['key'], string> = {
    readOnlyHint: t('mcp.tool.readOnly'),
    destructiveHint: t('mcp.tool.destructive'),
    idempotentHint: t('mcp.tool.idempotent'),
    openWorldHint: t('mcp.tool.openWorld'),
  }
  const hasSchema = !!def?.inputSchema && Object.keys(def.inputSchema).length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Issue #155: the header scrolls as ONE unit above a floored result block and its
          action row is sticky at the bottom, so Invoke stays visible however long the
          description or tall the textarea. The column lives in an inner div: as a direct
          flex child the textarea (a scroll container, min-height 0) would be squeezed
          instead of the header scrolling. */}
      <div
        data-testid="mcp-tool-header"
        className="min-h-0 shrink overflow-y-auto border-b border-[var(--border)]"
      >
        <div className="flex flex-col gap-2 px-3.5 pt-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-[var(--text)]">{def?.title || selectedTool}</span>
            {def?.title && (
              <span className="font-mono text-[11px] text-[var(--muted)]">{selectedTool}</span>
            )}
            {HINT_BADGES.filter((b) => def?.annotations?.[b.key] === true).map((b) => (
              <span key={b.key} className={`rounded px-1.5 text-[10px] font-medium ${b.tone}`}>
                {hintLabels[b.key]}
              </span>
            ))}
          </div>
          {def?.description && <McpDescription text={def.description} />}
          {hasSchema && (
            <details className="text-[12px]">
              <summary className="cursor-pointer text-[var(--muted)]">
                {t('mcp.tool.inputSchema')}
              </summary>
              <div className="mt-1 max-h-40 overflow-auto rounded border border-[var(--border)] p-2">
                <JsonPre value={def?.inputSchema} />
              </div>
            </details>
          )}
          {def?.outputSchema && (
            <details className="text-[12px]">
              <summary className="cursor-pointer text-[var(--muted)]">
                {t('mcp.tool.outputSchema')}
              </summary>
              <div className="mt-1 max-h-40 overflow-auto rounded border border-[var(--border)] p-2">
                <JsonPre value={def.outputSchema} />
              </div>
            </details>
          )}
          <SectionLabel>{t('mcp.tool.arguments')}</SectionLabel>
          <textarea
            value={toolArgs}
            onChange={(e) => setToolArgs(e.target.value)}
            rows={5}
            data-testid="mcp-tool-args"
            spellCheck={false}
            className="w-full resize-y rounded-md border border-[var(--border)] bg-[var(--input-bg)] p-2 font-mono text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
          {/* Opaque so scrolled content never shows through. The column has no bottom
              padding: this bar's pb is the header's last pixels, so nothing shows below it. */}
          <div
            data-testid="mcp-tool-actions"
            className="sticky bottom-0 bg-[var(--white)] pb-2.5 pt-2"
          >
            <PrimaryButton
              onClick={() => void callTool()}
              disabled={isInvoking || !isConnected}
              data-testid="mcp-invoke"
            >
              <Play size={13} />
              {isInvoking ? t('mcp.tool.invoking') : `${t('mcp.tool.invoke')} ${selectedTool}`}
            </PrimaryButton>
          </div>
        </div>
      </div>
      <div className="min-h-[5rem] flex-1 overflow-auto p-3.5">
        <SectionLabel>{t('mcp.result.title')}</SectionLabel>
        {resultError ? (
          <ErrorLine testId="mcp-result-call-error">{resultError}</ErrorLine>
        ) : pendingInput ? (
          <McpInputRequiredCard
            key={`${tabId ?? ''}:${pendingInput.round}:${pendingInput.requestState ?? ''}`}
            pending={pendingInput}
          />
        ) : result != null ? (
          <McpResultView result={result} />
        ) : (
          <EmptyState icon={Inbox} title={t('mcp.result.none')} variant="compact" size="sm" />
        )}
      </div>
    </div>
  )
}
