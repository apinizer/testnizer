import { useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'

/** Template variables available in `template` tool bodies (rendered by the main process). */
const VARS: readonly { token: string; key: string }[] = [
  { token: '{{args.x}}', key: 'mockMcp.template.args' },
  { token: '{{now}}', key: 'mockMcp.template.now' },
  { token: '{{timestamp}}', key: 'mockMcp.template.timestamp' },
  { token: '{{uuid}}', key: 'mockMcp.template.uuid' },
  { token: '{{$randomUUID}}', key: 'mockMcp.template.randomUuid' },
  { token: '{{tool}}', key: 'mockMcp.template.tool' },
  { token: '{{request.headers.authorization}}', key: 'mockMcp.template.headers' },
  { token: '{{baseUrl}}', key: 'mockMcp.template.env' },
]

/** "?" icon that reveals the template variable cheat-sheet on hover / focus. */
export default function MockMcpTemplateHint() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        data-testid="mock-mcp-template-hint"
        aria-label={t('mockMcp.template.title')}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.preventDefault()
          setOpen((v) => !v)
        }}
        className="flex cursor-help items-center border-none bg-transparent p-0 text-[var(--muted)]"
      >
        <HelpCircle size={12} />
      </button>
      {open && (
        <span
          role="tooltip"
          data-testid="mock-mcp-template-tooltip"
          className="absolute left-4 top-0 z-50 flex w-80 flex-col gap-1 rounded-lg border border-[var(--border)] bg-[var(--white)] p-3 text-[11px] font-normal normal-case text-[var(--text)] shadow-lg"
        >
          <span className="font-semibold">{t('mockMcp.template.title')}</span>
          {VARS.map((v) => (
            <span key={v.token} className="flex gap-2">
              <code className="shrink-0 font-mono text-[var(--accent-text)]">{v.token}</code>
              <span className="text-[var(--muted)]">{t(v.key)}</span>
            </span>
          ))}
        </span>
      )}
    </span>
  )
}
