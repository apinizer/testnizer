import { BookOpen, Inbox } from 'lucide-react'
import { useMcpStore } from '../../../stores/mcp.store'
import { useTranslation } from '../../../lib/i18n'
import { hasUnexpandedTemplate } from '../../../lib/mcp-store-helpers'
import EmptyState from '../../shared/EmptyState'
import McpResultView from './McpResultView'
import McpDescription from './McpDescription'
import { CenterHint, ErrorLine, PrimaryButton, SectionLabel } from './ui'

/**
 * Right pane for the Resources tab. A concrete resource reads its own URI; a
 * template's `uriTemplate` lands in the URI field to be edited into a
 * concrete URI (`test://item/{id}` → `test://item/42`) before Read.
 */
export default function McpResourcePane() {
  const { t } = useTranslation()
  const selected = useMcpStore((s) => s.selectedResourceUri)
  const resources = useMcpStore((s) => s.resources)
  const templates = useMcpStore((s) => s.resourceTemplates)
  const draft = useMcpStore((s) => s.resourceUriDraft)
  const setDraft = useMcpStore((s) => s.setResourceUriDraft)
  const readResource = useMcpStore((s) => s.readResource)
  const content = useMcpStore((s) => s.resourceContent)
  const error = useMcpStore((s) => s.resourceError)
  const isReading = useMcpStore((s) => s.isReadingResource)
  const isConnected = useMcpStore((s) => s.connectionState === 'connected')

  if (!selected) {
    return <CenterHint>{isConnected ? t('mcp.resource.select') : t('mcp.connectHint')}</CenterHint>
  }
  const resource = resources.find((r) => r.uri === selected)
  const template = resource ? undefined : templates.find((tp) => tp.uriTemplate === selected)
  const item = resource ?? template
  const mime = item?.mimeType
  const unexpanded = hasUnexpandedTemplate(draft)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Issue #155: same layout as McpToolPane — a scrolling header whose action row
          (URI + Read, with its template hint) is sticky at the bottom; floored result. */}
      <div
        data-testid="mcp-resource-header"
        className="min-h-0 shrink overflow-y-auto border-b border-[var(--border)]"
      >
        <div className="flex flex-col gap-2 px-3.5 pt-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-[var(--text)]">
              {item?.title || item?.name || selected}
            </span>
            {template && (
              <span className="rounded bg-[var(--mb-head-bg)] px-1.5 text-[10px] font-medium text-[var(--mb-head-fg)]">
                {t('mcp.resource.template')}
              </span>
            )}
            {mime && <span className="text-[11px] text-[var(--muted)]">{mime}</span>}
            {resource?.size !== undefined && (
              <span className="text-[11px] text-[var(--muted)]">{resource.size} B</span>
            )}
          </div>
          {item?.description && (
            <McpDescription text={item.description} testId="mcp-resource-description" />
          )}
          <div
            data-testid="mcp-resource-actions"
            className="sticky bottom-0 flex flex-col gap-2 bg-[var(--white)] pb-2.5 pt-2"
          >
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && isConnected && !unexpanded) void readResource()
                }}
                data-testid="mcp-resource-uri"
                spellCheck={false}
                className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-2.5 font-mono text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
              <PrimaryButton
                onClick={() => void readResource()}
                disabled={isReading || !isConnected || !draft.trim()}
                data-testid="mcp-read-resource"
              >
                <BookOpen size={13} />
                {isReading ? t('mcp.resource.reading') : t('mcp.resource.read')}
              </PrimaryButton>
            </div>
            {template && unexpanded && (
              <p className="m-0 text-[11px] text-[var(--muted)]">
                {t('mcp.resource.templateHint')}
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="min-h-[5rem] flex-1 overflow-auto p-3.5">
        <SectionLabel>{t('mcp.resource.contents')}</SectionLabel>
        {error ? (
          <ErrorLine testId="mcp-resource-error">{error}</ErrorLine>
        ) : content ? (
          <McpResultView
            result={{ content: content.contents.map((c) => ({ type: 'resource', resource: c })) }}
          />
        ) : (
          <EmptyState icon={Inbox} title={t('mcp.resource.none')} variant="compact" size="sm" />
        )}
      </div>
    </div>
  )
}
