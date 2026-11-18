/**
 * A History filter drop-down — the same control in the sidebar list and the
 * workbench overview. `fill` makes it fill its grid cell (sidebar, 2×2).
 * The chevron's end padding comes from the global select rule (globals.css),
 * so no `pr-*` here.
 */
export default function HistoryFilterSelect({
  testId,
  label,
  value,
  onChange,
  options,
  fill = false,
}: {
  testId: string
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<[string, string]>
  fill?: boolean
}) {
  return (
    <select
      data-testid={testId}
      aria-label={label}
      title={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`cursor-pointer rounded-[6px] border border-[var(--border2)] bg-[var(--input-bg)] text-[var(--text)] ${
        fill ? 'w-full min-w-0 pl-1 text-xs' : 'pl-2 text-sm'
      }`}
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  )
}
