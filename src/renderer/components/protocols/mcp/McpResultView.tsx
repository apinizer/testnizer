import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from '../../../lib/i18n'
import McpContentBlockView from './McpContentBlockView'
import { asCallToolResult } from './mcp-content'
import { JsonPre, SectionLabel } from './ui'

/**
 * Renders a raw `tools/call` result (CallToolResult) block by block — text,
 * image, audio, embedded resource, resource link — plus `structuredContent`
 * in its own section. `isError: true` gets a red border and label. Anything
 * not in CallToolResult shape falls back to pretty JSON. A "Raw" toggle
 * always shows the exact JSON the server returned.
 */
export default function McpResultView({ result }: { result: unknown }) {
  const { t } = useTranslation()
  const [raw, setRaw] = useState(false)
  const parsed = asCallToolResult(result)
  const isError = parsed?.isError === true

  return (
    <div
      data-testid="mcp-result"
      data-error={isError ? 'true' : 'false'}
      className={`flex flex-col gap-2 rounded-lg border p-2.5 ${
        isError ? 'border-[var(--red)]' : 'border-[var(--border)]'
      }`}
    >
      <div className="flex items-center gap-2">
        {isError && (
          <span
            data-testid="mcp-result-error-label"
            className="flex items-center gap-1 text-[12px] font-semibold text-[var(--red)]"
          >
            <AlertTriangle size={13} />
            {t('mcp.result.isError')}
          </span>
        )}
        <button
          type="button"
          data-testid="mcp-result-raw-toggle"
          aria-pressed={raw}
          onClick={() => setRaw((v) => !v)}
          className={`ml-auto cursor-pointer rounded border border-[var(--border)] px-2 py-0.5 text-[11px] ${
            raw
              ? 'bg-[var(--accent-light)] text-[var(--accent-text)]'
              : 'bg-transparent text-[var(--muted)]'
          }`}
        >
          {t('mcp.result.raw')}
        </button>
      </div>
      {raw || !parsed ? (
        <JsonPre value={result} testId="mcp-result-json" />
      ) : (
        <>
          {parsed.content.length === 0 && (
            <span className="text-[12px] text-[var(--muted)]">{t('mcp.result.noContent')}</span>
          )}
          {parsed.content.map((block, i) => (
            <McpContentBlockView key={i} block={block} />
          ))}
          {parsed.structuredContent !== undefined && (
            <section
              data-testid="mcp-structured-content"
              className="mt-1 border-t border-[var(--border)] pt-2"
            >
              <SectionLabel>{t('mcp.result.structured')}</SectionLabel>
              <JsonPre value={parsed.structuredContent} />
            </section>
          )}
        </>
      )}
    </div>
  )
}
