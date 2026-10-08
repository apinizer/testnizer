/**
 * Small form primitives for the Mock MCP editor (issue #140). Tailwind +
 * theme CSS variables only, so light / dark both work.
 */
import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { useNumberDraft, parseIntStrict, clampInt } from '../../lib/number-draft'

export const INPUT_CLS =
  'h-7 w-full rounded-md border border-[var(--border2)] bg-[var(--input-bg)] px-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)]'

/**
 * `h-8`, not `h-7` like INPUT_CLS: the unlayered `select` rule in globals.css
 * beats Tailwind utilities and gives every select `min-height: 2rem` (no
 * vertical padding, text centred by the select itself), so `h-8` is simply the
 * height a select gets anyway, the same as the MCP transport picker. For the
 * same reason only `h-8` and `w-full` take effect here: padding, font size,
 * border, radius and background all come from the global rule; the rest of the
 * list mirrors INPUT_CLS.
 */
export const SELECT_CLS =
  'h-8 w-full cursor-pointer rounded-md border border-[var(--border2)] bg-[var(--input-bg)] px-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)]'

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
        {children}
      </span>
      {right && <span className="ml-auto flex items-center gap-1.5">{right}</span>}
    </div>
  )
}

export function PrimaryButton({
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border-none bg-[var(--accent)] px-3 text-[12px] font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    />
  )
}

export function GhostButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-[var(--border)] bg-transparent px-2.5 text-[12px] text-[var(--text)] transition-colors hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    />
  )
}

export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  const caption = (
    <span className="flex items-center gap-1 text-[11px] font-medium text-[var(--muted)]">
      {label}
      {hint}
    </span>
  )
  // A hint is interactive (a button): inside a <label> it would become the
  // label's control and steal clicks meant for the field, so use a plain box.
  if (hint) {
    return (
      <div className={`flex flex-col gap-1 ${className}`}>
        {caption}
        {children}
      </div>
    )
  }
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      {caption}
      {children}
    </label>
  )
}

export function Checkbox({
  checked,
  onChange,
  label,
  testId,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  testId?: string
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[12px] text-[var(--text)]">
      <input
        type="checkbox"
        data-testid={testId}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-[var(--accent)]"
      />
      {label}
    </label>
  )
}

/** Required integer: typing is free, clamping happens on blur / Enter. */
export function IntInput({
  value,
  min,
  max,
  onChange,
  testId,
}: {
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  testId?: string
}) {
  const draft = useNumberDraft({ value, min, max, onChange })
  return (
    <input
      type="number"
      data-testid={testId}
      min={min}
      max={max}
      {...draft.inputProps}
      className={INPUT_CLS}
    />
  )
}

/** Optional integer: an empty box means "not set" (the backend default applies). */
export function OptionalIntInput({
  value,
  min,
  max,
  onChange,
  placeholder,
  testId,
}: {
  value: number | undefined
  min: number
  max: number
  onChange: (v: number | undefined) => void
  placeholder?: string
  testId?: string
}) {
  // Raw text only while the field is being edited; otherwise mirror `value`.
  const [editing, setEditing] = useState<string | null>(null)
  const shown = value === undefined ? '' : String(value)
  const commit = (text: string): void => {
    setEditing(null)
    if (text.trim() === '') {
      if (value !== undefined) onChange(undefined)
      return
    }
    const n = parseIntStrict(text)
    if (n === null) return
    const clamped = clampInt(n, min, max)
    if (clamped !== value) onChange(clamped)
  }
  return (
    <input
      type="number"
      data-testid={testId}
      value={editing ?? shown}
      placeholder={placeholder}
      min={min}
      max={max}
      onFocus={() => setEditing(shown)}
      onChange={(e) => setEditing(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(e.currentTarget.value)
      }}
      className={INPUT_CLS}
    />
  )
}
