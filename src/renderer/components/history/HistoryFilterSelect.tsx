/**
 * A History filter drop-down — the same control in the sidebar list and the
 * workbench overview. `fill` makes it fill its grid cell (sidebar, 2×2).
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
      className="cursor-pointer"
      style={{
        background: 'var(--input-bg)',
        border: '1px solid var(--border2)',
        borderRadius: 6,
        padding: fill ? '4px 4px' : '5px 8px',
        fontSize: fill ? 12 : 13,
        color: 'var(--text)',
        fontFamily: 'inherit',
        ...(fill ? { width: '100%', minWidth: 0 } : {}),
      }}
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  )
}
