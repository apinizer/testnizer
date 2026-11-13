/**
 * The History search box — the sidebar list and the workbench overview share
 * it. Same look as the APIs / Mocks panels' box: px sizes (Tailwind rem
 * spacing shrinks with the app's root font size), 1.5px border, 13px
 * magnifier. `className` sizes the box for where it sits.
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
      className={`flex items-center gap-[7px] rounded-[8px] border-[1.5px] border-[var(--border2)] bg-[var(--surface)] px-[10px] ${className}`}
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
        className="w-full border-none bg-transparent text-sm text-[var(--text)] outline-none"
      />
    </div>
  )
}
