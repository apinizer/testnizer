import { useTranslation } from '../../../lib/i18n'
import { testIdSlug } from '../../../lib/mcp-store-helpers'
import type { ElicitField } from '../../../lib/mcp-elicitation'

const INPUT_CLS =
  'h-8 w-full rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)]'

/** HTML input type for a string field's `format`. */
function inputType(field: ElicitField): string {
  if (field.kind === 'number' || field.kind === 'integer') return 'number'
  if (field.format === 'email') return 'email'
  if (field.format === 'uri') return 'url'
  if (field.format === 'date') return 'date'
  return 'text'
}

/** One elicitation field (string / number / integer / boolean / enum) of the input card. */
export default function McpElicitField({
  requestKey,
  field,
  value,
  onChange,
  invalid,
}: {
  requestKey: string
  field: ElicitField
  value: string | boolean | undefined
  onChange: (value: string | boolean) => void
  invalid: boolean
}) {
  const { t } = useTranslation()
  const testId = `mcp-input-field-${testIdSlug(requestKey)}-${testIdSlug(field.name)}`
  const label = (
    <span className="flex items-center gap-1 text-[11px] font-medium text-[var(--muted)]">
      {field.title || field.name}
      {field.required && <span className="text-[var(--red)]">*</span>}
      {field.title && <span className="font-mono text-[10px]">{field.name}</span>}
    </span>
  )
  const hint = field.description ? (
    <span className="text-[11px] text-[var(--hint)]">{field.description}</span>
  ) : null
  const border = invalid ? 'border-[var(--red)]' : ''

  if (field.kind === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-[12px] text-[var(--text)]">
        <input
          type="checkbox"
          data-testid={testId}
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
        {hint}
      </label>
    )
  }
  if (field.kind === 'unsupported') {
    return (
      <div className="flex flex-col gap-1">
        {label}
        <span className="text-[11px] text-[var(--orange)]">{t('mcp.input.unsupportedField')}</span>
      </div>
    )
  }
  return (
    <label className="flex flex-col gap-1">
      {label}
      {field.kind === 'enum' ? (
        <select
          data-testid={testId}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className={`${INPUT_CLS} cursor-pointer ${border}`}
        >
          {!field.required && <option value="">—</option>}
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={inputType(field)}
          data-testid={testId}
          value={typeof value === 'string' ? value : ''}
          min={field.minimum}
          max={field.maximum}
          step={field.kind === 'integer' ? 1 : field.kind === 'number' ? 'any' : undefined}
          minLength={field.minLength}
          maxLength={field.maxLength}
          onChange={(e) => onChange(e.target.value)}
          className={`${INPUT_CLS} ${border}`}
        />
      )}
      {hint}
    </label>
  )
}
