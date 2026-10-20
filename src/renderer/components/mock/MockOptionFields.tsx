/**
 * The field parts of the response editor's option rows (issue #221) — the
 * SSE "Stream" row (`MockSseOptions.tsx`) and the AI "LLM" row
 * (`MockLlmOptions.tsx`) are built from these, so the two rows cannot drift
 * apart. The look is the editor's "Delay (ms) / Enabled" row
 * (`MockServerEditor.tsx` ResponseEditor): muted label + 70 px number box,
 * plain select, small muted / red note lines under the row.
 */
import type { ReactNode } from 'react'
import { useTranslation } from '../../lib/i18n'
import type { useNumberDraft } from '../../lib/number-draft'

const NUMBER_STYLE = { width: 70, background: 'var(--white)', borderColor: 'var(--border)' }
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
}: {
  label: string
  testId: string
  draft: ReturnType<typeof useNumberDraft>
}) {
  return (
    <label style={{ color: 'var(--muted)' }}>
      {label}:
      <input
        type="number"
        data-testid={testId}
        {...draft.inputProps}
        className="ml-1 rounded border px-2 py-1"
        style={NUMBER_STYLE}
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
    <label className="flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
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
