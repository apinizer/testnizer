/**
 * The app's numeric input. Behaviour lives in `lib/number-draft` — see the
 * comment there for the clamp-on-every-keystroke bug this replaces.
 *
 * Markup is carried over verbatim from the local copy that used to live in
 * `PasswordGeneratorTool`, so adopting this component is a behaviour change
 * only, never a visual one. `label` is optional because some callers (OtpTool)
 * supply their own label wrapper.
 */
import { useId } from 'react'
import { useNumberDraft } from '../../lib/number-draft'

// `clampInt` intentionally stays in `lib/number-draft`: re-exporting a helper
// from a component module breaks fast refresh for the whole file.

export interface NumberFieldProps {
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  /** Rendered as an uppercase caption above the input when provided. */
  label?: string
  /** Pair the box with a range slider, and echo the value next to the label. */
  slider?: boolean
  /** Compact type scale, matching the smaller tool forms. */
  dense?: boolean
  /** Accessible name when there is no visible `label`. */
  ariaLabel?: string
  /** Id of an element describing the field (e.g. a validation hint). */
  describedBy?: string
}

export default function NumberField({
  value,
  min,
  max,
  onChange,
  label,
  slider,
  dense,
  ariaLabel,
  describedBy,
}: NumberFieldProps) {
  const id = useId()
  const { inputProps, sliderProps } = useNumberDraft({ value, min, max, onChange })

  return (
    <div>
      {label !== undefined && (
        <label
          htmlFor={id}
          className={`block uppercase tracking-wide ${
            dense ? 'mb-0.5 text-[10px]' : 'mb-1 text-[11px]'
          }`}
          style={{ color: 'var(--muted)' }}
        >
          {label}
          {slider ? <span style={{ color: 'var(--accentText)' }}> — {value}</span> : null}
        </label>
      )}
      <div className="flex items-center gap-2">
        {slider && (
          <input
            type="range"
            min={min}
            max={max}
            {...sliderProps}
            aria-label={label ?? ariaLabel}
            className="flex-1"
            style={{ accentColor: 'var(--accent)' }}
          />
        )}
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          {...inputProps}
          aria-label={label === undefined ? ariaLabel : undefined}
          aria-describedby={describedBy}
          className={`rounded border ${dense ? 'px-2 py-1 text-xs' : 'px-2 py-1 text-sm'} ${
            slider ? 'w-20' : 'w-full'
          }`}
          style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
        />
      </div>
    </div>
  )
}
