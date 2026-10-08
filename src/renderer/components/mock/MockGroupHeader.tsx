import { Plus } from 'lucide-react'

/**
 * Group header of the Mocks panel ("HTTP SERVERS" / "MCP SERVERS", issue
 * #140): title, server count and a small "+" that opens the New mock server
 * dialog with this group's type preselected.
 */
export default function MockGroupHeader({
  title,
  count,
  addLabel,
  onAdd,
  disabled,
  testId,
  addTestId,
}: {
  title: string
  count: number
  addLabel: string
  onAdd?: () => void
  disabled?: boolean
  testId: string
  addTestId: string
}) {
  return (
    <div className="flex h-9 items-center gap-2 px-3">
      <span
        data-testid={testId}
        className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]"
      >
        {title}
      </span>
      <span
        data-testid={`${testId}-count`}
        className="rounded-full bg-[var(--surface)] px-1.5 text-[10px] font-semibold leading-4 text-[var(--muted)]"
      >
        {count}
      </span>
      <span className="flex-1" />
      {onAdd && (
        <button
          type="button"
          data-testid={addTestId}
          title={addLabel}
          aria-label={addLabel}
          disabled={disabled}
          onClick={onAdd}
          className="flex h-5 w-5 cursor-pointer items-center justify-center rounded border border-[var(--border)] bg-transparent text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent-text)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={12} strokeWidth={2.5} />
        </button>
      )}
    </div>
  )
}
