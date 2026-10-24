import { useEffect, useRef, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import { Z } from '../../lib/z-index'
import { Checkbox, INPUT_CLS, SELECT_CLS } from '../mock-mcp/ui'
import type { CodegenOptionDef } from '../../../shared/codegen'
import type { CodegenSelectionView } from './use-codegen-selection'

/**
 * The variant's snippet options (issue #280) in a small popover: a checkbox
 * per boolean, a number field, a select per choice. Rendered from the
 * variant's option schema, so a new option needs no UI work. Escape and a
 * click outside close it — Escape is caught before the Generate Code dialog
 * sees it, so it closes only the popover.
 */
export default function CodegenOptionsPopover({
  selection,
  hidden = [],
}: {
  selection: CodegenSelectionView
  /** Option ids already shown inline (cURL's Multi-line). */
  hidden?: string[]
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const defs = selection.variant.options.filter((d) => !hidden.includes(d.id))

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    const onDown = (e: MouseEvent): void => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  if (defs.length === 0) return null

  const control = (d: CodegenOptionDef) => {
    const value = selection.options[d.id]
    const id = `codegen-option-${d.id}`
    if (d.type === 'boolean') {
      return (
        <Checkbox
          checked={value === true}
          onChange={(v) => selection.setOption(d.id, v)}
          label={t(d.labelKey)}
          testId={id}
        />
      )
    }
    return (
      <label className="flex flex-col gap-1 text-[12px] text-[var(--text)]">
        <span>{t(d.labelKey)}</span>
        {d.type === 'number' ? (
          <input
            type="number"
            min={d.min ?? 0}
            value={typeof value === 'number' ? value : 0}
            data-testid={id}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n) && n >= (d.min ?? 0)) selection.setOption(d.id, n)
            }}
            className={INPUT_CLS}
          />
        ) : (
          <select
            value={String(value)}
            data-testid={id}
            onChange={(e) => selection.setOption(d.id, e.target.value)}
            className={SELECT_CLS}
          >
            {d.choices?.map((c) => (
              <option key={c.value} value={c.value}>
                {t(c.labelKey)}
              </option>
            ))}
          </select>
        )}
      </label>
    )
  }

  return (
    <div ref={root} className="relative ml-auto shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="codegen-options"
        data-customised={selection.customised || undefined}
        onClick={() => setOpen((o) => !o)}
        className="flex cursor-pointer items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--white)] px-2 py-0.5 text-[11px] text-[var(--muted)] hover:text-[var(--text)]"
      >
        <SlidersHorizontal size={12} aria-hidden="true" />
        {t('codeGen.options')}
        {selection.customised && (
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t('codeGen.optionsTitle')}
          data-testid="codegen-options-panel"
          className="absolute right-0 top-full mt-1 flex w-[240px] flex-col gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--white)] p-3 shadow-[var(--shadow-drop)]"
          style={{ zIndex: Z.DROPDOWN }}
        >
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            {t('codeGen.optionsTitle')}
          </div>
          {defs.map((d) => (
            <div key={d.id}>{control(d)}</div>
          ))}
          <button
            type="button"
            data-testid="codegen-options-reset"
            disabled={!selection.customised}
            onClick={selection.resetOptions}
            className="cursor-pointer self-start text-[11px] text-[var(--accent-text)] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('codeGen.optionsReset')}
          </button>
        </div>
      )}
    </div>
  )
}
