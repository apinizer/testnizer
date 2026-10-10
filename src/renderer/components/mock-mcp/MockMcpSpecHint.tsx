import { Info } from 'lucide-react'

/**
 * A plain-words hint with its spec detail (error codes, header names) one
 * step away (issue #167). The detail used to live only in a `title` on a
 * non-focusable div — mouse-only. Now a small info button carries it: it is
 * focusable, a screen reader reads its label, and focusing it shows the
 * detail under the hint (review item 16).
 */
export default function MockMcpSpecHint({
  text,
  detail,
  testId,
}: {
  text: string
  detail: string
  testId?: string
}) {
  return (
    <div className="text-[11px] text-[var(--hint)]">
      <span data-testid={testId} title={detail} className="cursor-help">
        {text}
      </span>
      <button
        type="button"
        data-testid={testId ? `${testId}-info` : undefined}
        aria-label={detail}
        title={detail}
        className="peer ml-1 inline-flex cursor-help items-center border-none bg-transparent p-0 align-middle text-[var(--hint)] hover:text-[var(--text)] focus-visible:text-[var(--text)]"
      >
        <Info size={11} aria-hidden="true" />
      </button>
      <span
        aria-hidden="true"
        className="mt-0.5 hidden text-[var(--muted)] peer-focus-visible:block"
      >
        {detail}
      </span>
    </div>
  )
}
