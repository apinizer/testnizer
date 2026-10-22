/**
 * The field parts of the response editor's option rows (issue #221) — the
 * SSE "Stream" row (`MockSseOptions.tsx`) and the AI "LLM" row
 * (`MockLlmOptions.tsx`) are built from these, so the two rows cannot drift
 * apart. The editor's "Delay (ms)" and "Priority" boxes use `OptionNumber`
 * too: muted label + number box, plain select, small muted / red note lines
 * under the row. Labels never break inside (the rows wrap instead), and the
 * number boxes are sized in rem — rem follows the app font size, px did not:
 * a 70 px box clipped "15000" to "1500" at font size 16 (issue #226).
 */
import { useState, type ReactNode } from 'react'
import { useTranslation } from '../../lib/i18n'
import type { useNumberDraft } from '../../lib/number-draft'

/** Fits 6 digits (every ms setting tops out at 600 000) at font size 13–16. */
const NUMBER_WIDTH = '6.5rem'
/** Fits 8 digits (token counts top out at 10 000 000). */
const WIDE_NUMBER_WIDTH = '8rem'
const NUMBER_COLORS = { background: 'var(--white)', borderColor: 'var(--border)' }
const SELECT_STYLE = { background: 'var(--white)', borderColor: 'var(--border)' }

/** The row's uppercase title ("Stream", "LLM"). */
export function OptionRowTitle({ children }: { children: ReactNode }) {
  return (
    <label
      className="mb-1 block text-[11px] uppercase tracking-wide"
      style={{ color: 'var(--muted)' }}
    >
      {children}
    </label>
  )
}

/** `Label: [123]` — a number box driven by `useNumberDraft`. */
export function OptionNumber({
  label,
  testId,
  draft,
  wide,
}: {
  label: string
  testId: string
  draft: ReturnType<typeof useNumberDraft>
  /** Room for 8 digits instead of 6. */
  wide?: boolean
}) {
  return (
    <label
      className="flex items-center gap-1.5 whitespace-nowrap"
      style={{ color: 'var(--muted)' }}
    >
      {label}:
      <input
        type="number"
        data-testid={testId}
        {...draft.inputProps}
        className="rounded border px-2 py-1"
        style={{ ...NUMBER_COLORS, width: wide ? WIDE_NUMBER_WIDTH : NUMBER_WIDTH }}
      />
    </label>
  )
}

/** `Label: (option ▾)` — options are `[value, i18n key]` pairs. */
export function OptionSelect<V extends string>(props: {
  label: string
  testId: string
  value: V
  options: readonly (readonly [V, string])[]
  onChange: (v: V) => void
  disabled?: boolean
  describedBy?: string
}) {
  const { t } = useTranslation()
  return (
    <label
      className="flex items-center gap-1.5 whitespace-nowrap"
      style={{ color: 'var(--muted)' }}
    >
      {props.label}:
      <select
        data-testid={props.testId}
        value={props.value}
        disabled={props.disabled}
        aria-describedby={props.describedBy}
        onChange={(e) => props.onChange(e.target.value as V)}
        className={`rounded border px-2 py-1 ${props.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
        style={SELECT_STYLE}
      >
        {props.options.map(([v, key]) => (
          <option key={v} value={v}>
            {t(key)}
          </option>
        ))}
      </select>
    </label>
  )
}

/** `[x] Label` — the rows' checkbox (the Stream row's Loop / Resume anatomy). */
export function OptionCheck({
  label,
  testId,
  checked,
  onChange,
}: {
  label: string
  testId: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label
      className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap"
      style={{ color: 'var(--text)' }}
    >
      <input
        type="checkbox"
        data-testid={testId}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  )
}

/**
 * `Label: [text]` — committed on blur / Enter, like the tool-call list: the
 * typed text is local and reset when the stored value changes (derived
 * during render). An unchanged text writes nothing.
 */
export function OptionText({
  label,
  testId,
  value,
  onCommit,
  placeholder,
  maxLength,
  width = '12rem',
  mono,
  grow,
}: {
  label: string
  testId: string
  value: string
  onCommit: (v: string) => void
  placeholder?: string
  maxLength?: number
  /** CSS width of the box (rem, so it follows the app font size). */
  width?: string
  mono?: boolean
  /**
   * Take the rest of the row (and a row of its own when the row is narrow):
   * for free text a fixed box clips — a long default message or JSON data
   * (PM review #18). `width` is then the box's minimum.
   */
  grow?: boolean
}) {
  const [state, setState] = useState({ base: value, text: value })
  const text = state.base === value ? state.text : value
  const commit = (): void => {
    if (text !== value) onCommit(text)
  }
  return (
    <label
      className={`flex min-w-0 items-center gap-1.5 whitespace-nowrap ${grow ? 'flex-1' : ''}`}
      style={{ color: 'var(--muted)', ...(grow ? { flexBasis: width } : {}) }}
      data-grow={grow ? 'true' : undefined}
    >
      {label}:
      <input
        type="text"
        data-testid={testId}
        value={text}
        placeholder={placeholder}
        title={text || placeholder}
        maxLength={maxLength}
        onChange={(e) => setState({ base: value, text: e.target.value })}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
        className={`min-w-0 rounded border px-2 py-1 ${mono ? 'font-mono' : ''} ${grow ? 'flex-1' : ''}`}
        style={{ ...NUMBER_COLORS, ...(grow ? {} : { width }), maxWidth: '100%' }}
      />
    </label>
  )
}

/** Why a field is off (muted), under the row. */
export function OptionReason({
  id,
  testId,
  children,
}: {
  id: string
  testId: string
  children: ReactNode
}) {
  return (
    <div
      id={id}
      data-testid={testId}
      className="mt-1 text-[11px]"
      style={{ color: 'var(--muted)' }}
    >
      {children}
    </div>
  )
}

/** A rejected value (red, `role="alert"`) — the condition editor's error line. */
export function OptionError({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div data-testid={testId} role="alert" className="mt-1 text-xs" style={{ color: 'var(--red)' }}>
      {children}
    </div>
  )
}
