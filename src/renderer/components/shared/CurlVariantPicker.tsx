import { useUIStore } from '../../stores/ui.store'
import { useTranslation } from '../../lib/i18n'
import { Checkbox } from '../mock-mcp/ui'
import type { CurlDialect } from '../../../shared/curl/types'

const DIALECTS: Array<{ id: CurlDialect; labelKey: string; titleKey: string }> = [
  { id: 'bash', labelKey: 'codeGen.curl.bash', titleKey: 'codeGen.curl.bashHint' },
  { id: 'cmd', labelKey: 'codeGen.curl.cmd', titleKey: 'codeGen.curl.cmdHint' },
  {
    id: 'powershell',
    labelKey: 'codeGen.curl.powershell',
    titleKey: 'codeGen.curl.powershellHint',
  },
]

/**
 * cURL variant row of the Generate Code surfaces (issue #279): the shell the
 * snippet is written for (bash / Windows CMD / PowerShell — Apinizer's three
 * variants) and one line vs one option per line. Same segmented anatomy as
 * the MCP result JSON | Preview switch (`McpResultView.tsx`). The choice lives
 * in `ui.store.curlSnippet`, so the modal and the right panel agree.
 */
export default function CurlVariantPicker() {
  const { t } = useTranslation()
  const { dialect, multiLine } = useUIStore((s) => s.curlSnippet)
  const setCurlSnippet = useUIStore((s) => s.setCurlSnippet)
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="codegen-curl-variant">
      <div
        role="group"
        aria-label={t('codeGen.curl.shell')}
        className="flex items-center gap-0.5 rounded-md border border-[var(--border)] p-0.5"
      >
        {DIALECTS.map((d) => {
          const active = d.id === dialect
          return (
            <button
              key={d.id}
              type="button"
              aria-pressed={active}
              title={t(d.titleKey)}
              data-testid={`codegen-curl-dialect-${d.id}`}
              onClick={() => setCurlSnippet({ dialect: d.id })}
              className={`flex cursor-pointer items-center rounded px-2 py-0.5 text-[11px] ${
                active
                  ? 'bg-[var(--accent-light)] font-medium text-[var(--accent-text)]'
                  : 'bg-transparent text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              {t(d.labelKey)}
            </button>
          )
        })}
      </div>
      <Checkbox
        checked={multiLine}
        onChange={(v) => setCurlSnippet({ multiLine: v })}
        label={t('codeGen.curl.multiLine')}
        testId="codegen-curl-multiline"
      />
    </div>
  )
}
