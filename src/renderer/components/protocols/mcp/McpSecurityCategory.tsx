import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useTranslation } from '../../../lib/i18n'
import McpSecurityFindingRow from './McpSecurityFindingRow'
import { translated, type CategoryView } from './security-ui'

/** One accordion section of the scan report: title, category score, problem count, rows. */
export default function McpSecurityCategory({ view }: { view: CategoryView }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const fails = view.findings.filter((f) => f.status === 'fail').length
  const warns = view.findings.filter((f) => f.status === 'warn').length

  return (
    <section
      data-testid={`mcp-security-category-${view.id}`}
      className="rounded-md border border-[var(--border)]"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2 border-none bg-[var(--surface)] px-2.5 py-1.5 text-left text-[12px] font-semibold text-[var(--text)]"
      >
        {open ? (
          <ChevronDown size={13} className="text-[var(--muted)]" />
        ) : (
          <ChevronRight size={13} className="text-[var(--muted)]" />
        )}
        <span className="min-w-0 flex-1 truncate">
          {translated(t, `mcp.security.category.${view.id}`, view.title)}
        </span>
        {fails > 0 && (
          <span className="text-[11px] font-medium text-[var(--red)]">
            {fails} {t('mcp.security.summary.fail')}
          </span>
        )}
        {warns > 0 && (
          <span className="text-[11px] font-medium text-[var(--orange)]">
            {warns} {t('mcp.security.summary.warn')}
          </span>
        )}
        {view.score !== undefined && (
          <span className="rounded bg-[var(--fill-4)] px-1.5 text-[11px] font-medium text-[var(--muted)]">
            {view.score}/100
          </span>
        )}
      </button>
      {open && (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-2">
          {view.findings.map((f) => (
            <McpSecurityFindingRow key={f.id} finding={f} />
          ))}
        </ul>
      )}
    </section>
  )
}
