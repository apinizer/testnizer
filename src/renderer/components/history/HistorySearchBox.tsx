/**
 * The History search box — the sidebar list and the workbench overview share
 * it. Same look as the APIs / Mocks panels' box: px sizes (Tailwind rem
 * spacing shrinks with the app's root font size), 1.5px border, 13px
 * magnifier. `className` sizes the box for where it sits.
 *
 * Focus is drawn ONCE, on the box (`focus-within`: accent border + the app's
 * 3px accent-light ring, the input focus look of globals.css). The input's
 * own ring is off: the unlayered `:focus-visible` outline beats a plain
 * `outline-none`, so it takes the important form, and the base-layer
 * `input:focus` shadow goes with `focus:shadow-none` — otherwise a second box
 * was drawn inside the first.
 */
export default function HistorySearchBox({
  testId,
  value,
  onChange,
  placeholder,
  className = '',
}: {
  testId: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  className?: string
}) {
  return (
    <div
      className={`flex items-center gap-[7px] rounded-[8px] border-[1.5px] border-[var(--border2)] bg-[var(--surface)] px-[10px] focus-within:border-[var(--accent)] focus-within:shadow-[0_0_0_3px_var(--accent-light)] ${className}`}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--hint)"
        strokeWidth="2"
        aria-hidden="true"
        className="shrink-0"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full border-none bg-transparent text-sm text-[var(--text)] outline-none! focus:shadow-none"
      />
    </div>
  )
}
