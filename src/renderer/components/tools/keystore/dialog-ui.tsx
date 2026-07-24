import { useTranslation } from '../../../lib/i18n'

/**
 * Shared modal primitives for the Keystore Studio dialogs. Extracted from
 * KeystoreTool so the Open / Create / Save prompts and the Generate dialogs
 * render one consistent modal shell (keeps each dialog component under the
 * ~200-line rule).
 */

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  /** Widen for the field-heavy Generate Key Pair form. */
  wide?: boolean
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className={`w-full ${wide ? 'max-w-lg' : 'max-w-sm'} max-h-[85vh] space-y-3 overflow-y-auto rounded-lg p-4 shadow-xl`}
        style={{ background: 'var(--white)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="m-0 text-sm font-semibold" style={{ color: 'var(--heading)' }}>
          {title}
        </h3>
        {children}
      </div>
    </div>
  )
}

export function ModalActions({
  onCancel,
  onConfirm,
  confirmLabel,
  confirmDisabled,
}: {
  onCancel: () => void
  onConfirm: () => void
  confirmLabel: string
  confirmDisabled?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="flex justify-end gap-2 pt-1">
      <button
        onClick={onCancel}
        className="rounded border px-3 py-1 text-xs"
        style={{ borderColor: 'var(--border)', background: 'var(--white)', color: 'var(--muted)' }}
      >
        {t('tools.keystore.cancel')}
      </button>
      <button
        onClick={onConfirm}
        disabled={confirmDisabled}
        className="rounded px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        style={{ background: 'var(--accent)' }}
      >
        {confirmLabel}
      </button>
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="mb-0.5 block text-[10px] uppercase tracking-wide"
      style={{ color: 'var(--muted)' }}
    >
      {children}
    </span>
  )
}

const inputStyle = {
  background: 'var(--white)',
  borderColor: 'var(--border)',
  color: 'var(--text)',
} as const

export function LabeledInput({
  label,
  value,
  onChange,
  onEnter,
  type = 'text',
  autoFocus,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onEnter?: () => void
  type?: string
  autoFocus?: boolean
  placeholder?: string
}) {
  return (
    <label className="block">
      <FieldLabel>{label}</FieldLabel>
      <input
        type={type}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) onEnter()
        }}
        className="w-full rounded border px-2 py-1 text-xs"
        style={inputStyle}
      />
    </label>
  )
}

export function LabeledTextarea({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
}) {
  return (
    <label className="block">
      <FieldLabel>{label}</FieldLabel>
      <textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full resize-y rounded border px-2 py-1 font-mono text-xs"
        style={inputStyle}
      />
    </label>
  )
}

export function LabeledSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<[string, string]>
}) {
  return (
    <label className="block">
      <FieldLabel>{label}</FieldLabel>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border px-2 py-1 text-xs"
        style={inputStyle}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  )
}
