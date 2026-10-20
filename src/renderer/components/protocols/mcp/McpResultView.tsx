import { useState, type ReactNode } from 'react'
import { AlertTriangle, Braces, Play } from 'lucide-react'
import { useTranslation } from '../../../lib/i18n'
import McpContentBlockView from './McpContentBlockView'
import { asCallToolResult } from './mcp-content'
import { JsonPre, SectionLabel } from './ui'

/**
 * Renders a raw `tools/call` result (CallToolResult) block by block — text,
 * image, audio, embedded resource, resource link — plus `structuredContent`
 * in its own section. `isError: true` gets a red border and label. Anything
 * not in CallToolResult shape falls back to pretty JSON. A `JSON | Preview`
 * switch (Postman's MCP result view) shows the exact JSON the server
 * returned; Preview is the block view and the default.
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
        <div
          role="group"
          aria-label={t('mcp.result.viewLabel')}
          data-testid="mcp-result-view-switch"
          className="ml-auto flex items-center gap-0.5 rounded-md border border-[var(--border)] p-0.5"
        >
          <ViewButton
            active={raw || !parsed}
            onClick={() => setRaw(true)}
            testId="mcp-result-view-json"
            icon={<Braces size={12} aria-hidden="true" />}
            label={t('mcp.result.viewJson')}
          />
          <ViewButton
            active={!raw && !!parsed}
            disabled={!parsed}
            onClick={() => setRaw(false)}
            testId="mcp-result-view-preview"
            icon={<Play size={11} aria-hidden="true" />}
            label={t('mcp.result.viewPreview')}
          />
        </div>
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

function ViewButton({
  active,
  disabled,
  onClick,
  testId,
  icon,
  label,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  testId: string
  icon: ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? 'bg-[var(--accent-light)] font-medium text-[var(--accent-text)]'
          : 'bg-transparent text-[var(--muted)] enabled:hover:text-[var(--text)]'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
