import { useId } from 'react'
import { useTranslation } from '../../lib/i18n'
import { INPUT_CLS } from '../mock-mcp/ui'
import type { PortCheck } from './mock-port'

/**
 * The New Mock Server dialog's Port field (issue #257): validated while the
 * user types — the error sits directly under the field, the input is
 * `aria-invalid` and described by it. Create stays enabled; submit re-checks.
 */
export default function NewMockServerPortField({
  value,
  check,
  onChange,
}: {
  value: string
  check: PortCheck
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const errorId = useId()
  const invalid = !check.ok
  return (
    // The error is a sibling of the label, not inside it, so it is not folded
    // into the input's accessible name — it is linked by aria-describedby.
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-[var(--muted)]">{t('mockNew.port')}</span>
        <input
          data-testid="mock-new-port"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          className={`${INPUT_CLS} font-mono ${invalid ? 'border-[var(--red)]' : ''}`}
        />
      </label>
      {invalid && (
        <span
          id={errorId}
          data-testid="mock-new-port-error"
          role="alert"
          className="text-[11px] text-[var(--red)]"
        >
          {t('mock.invalidPort')}
        </span>
      )}
    </div>
  )
}
