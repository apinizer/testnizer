/**
 * Display primitives for the Mock MCP UI (issue #140): status dot, copy
 * button and master-list rows.
 */
import { useState, type ReactNode } from 'react'
import { Copy, Check } from 'lucide-react'
import type { MockMcpServerStatus } from '../../types/mock-mcp'

const DOT: Record<MockMcpServerStatus, string> = {
  running: 'bg-[var(--green)]',
  starting: 'bg-[var(--orange)]',
  error: 'bg-[var(--red)]',
  stopped: 'bg-[var(--hint)]',
}

export function StatusDot({ status }: { status: MockMcpServerStatus }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[status]}`}
    />
  )
}

/** Copy-to-clipboard icon button with a short "copied" check. */
export function CopyButton({
  text,
  title,
  testId,
}: {
  text: string
  title: string
  testId?: string
}) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      data-testid={testId}
      onClick={(e) => {
        e.stopPropagation()
        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setDone(true)
            setTimeout(() => setDone(false), 1200)
          })
          .catch(() => {})
      }}
      className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border-none bg-transparent text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}

/** List row used by the Tools / Resources / Prompts master lists. */
export function ListItem({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  testId?: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={`flex w-full cursor-pointer items-center gap-2 truncate border-none px-3 py-1.5 text-left text-[12px] ${
        active
          ? 'bg-[var(--accent-light)] text-[var(--accent-text)]'
          : 'bg-transparent text-[var(--text)] hover:bg-[var(--surface)]'
      }`}
    >
      {children}
    </button>
  )
}
