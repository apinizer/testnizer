/**
 * The mock server type switch (HTTP | MCP | SSE | AI) — one segmented radio
 * group shared by the "New mock server" dialog (`NewMockServerPresetPicker`,
 * issues #140, #221) and the HTTP mock editor's Settings tab
 * (`MockServerTypeField`, issue #222). Keyboard (issue #226): one Tab stop,
 * the arrow keys / Home / End move and select (`radio-group-keys.ts`).
 */
import { onRadioKeyDown, radioTabIndex } from '../../lib/radio-group-keys'

export default function MockKindSegmented<K extends string>({
  kinds,
  value,
  labels,
  ariaLabel,
  testIdPrefix,
  disabled = false,
  onChange,
}: {
  kinds: readonly K[]
  value: K
  labels: Record<K, string>
  ariaLabel: string
  /** Each option is `${testIdPrefix}-${kind}`. */
  testIdPrefix: string
  disabled?: boolean
  onChange: (kind: K) => void
}) {
  const index = kinds.indexOf(value)
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className="grid gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1"
      // One column per type; a computed `grid-cols-N` class would not be generated.
      style={{ gridTemplateColumns: `repeat(${kinds.length}, minmax(0, 1fr))` }}
    >
      {kinds.map((k, i) => {
        const active = k === value
        return (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            tabIndex={radioTabIndex(i, index)}
            data-testid={`${testIdPrefix}-${k}`}
            onClick={() => onChange(k)}
            onKeyDown={(e) => onRadioKeyDown(e, kinds, i, onChange)}
            className={`h-7 cursor-pointer rounded-md border-none text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              active
                ? 'bg-[var(--white)] text-[var(--accent-text)] shadow-sm'
                : 'bg-transparent text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            {labels[k]}
          </button>
        )
      })}
    </div>
  )
}
