/**
 * Password Generator form primitives.
 *
 * Moved out of `PasswordGeneratorTool.tsx` verbatim when the file outgrew the
 * ~200-line rule; the only behavioural change is that `Field` now wires its
 * `<label>` to the control it labels (it used to render a bare `<label>` with no
 * `htmlFor`, so nothing announced the Mode and Word-case groups).
 */
import { useId, type ReactNode } from 'react'

export type Tr = (k: string) => string

export function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  /** Id of the control. Omit for groups of buttons, which have no single input. */
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-[11px] uppercase tracking-wide"
        style={{ color: 'var(--muted)' }}
      >
        {label}
      </label>
      {children}
    </div>
  )
}

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  /** Explanatory line under the box — used where a rule is not self-evident. */
  hint?: string
}) {
  return (
    <div>
      <label
        className="flex cursor-pointer items-center gap-2 text-xs"
        style={{ color: disabled ? 'var(--hint)' : 'var(--text)' }}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          style={{ accentColor: 'var(--accent)' }}
        />
        {label}
      </label>
      {hint ? (
        <div className="mt-0.5 ml-5 text-[10px]" style={{ color: 'var(--hint)' }}>
          {hint}
        </div>
      ) : null}
    </div>
  )
}

export function TextField({
  label,
  value,
  onChange,
  mono,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  mono?: boolean
  disabled?: boolean
}) {
  const id = useId()
  return (
    <Field label={label} htmlFor={id}>
      <input
        id={id}
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded border px-2 py-1 text-sm disabled:opacity-50 ${
          mono ? 'font-mono' : ''
        }`}
        style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
      />
    </Field>
  )
}
