import type { Wrench } from 'lucide-react'
import { T } from '../../styles/tokens'

interface SecurityRowProps {
  /** `security-tool-<testId>` — the tool protocol, or the action id. */
  testId: string
  Icon: typeof Wrench
  label: string
  bg: string
  color: string
  isActive: boolean
  onSelect: () => void
  /** Optional one-line explanation, shown as the row's tooltip. */
  hint?: string
}

/**
 * One row of the Security page — a tool (opens its tool tab) or an action such
 * as the MCP Security Scan (issue #229). Both render through here so the rows
 * cannot drift apart. Mirrors the rows of `ToolsPanel`.
 */
export default function SecurityRow({
  testId,
  Icon,
  label,
  bg,
  color,
  isActive,
  onSelect,
  hint,
}: SecurityRowProps) {
  return (
    <button
      type="button"
      data-testid={`security-tool-${testId}`}
      onClick={onSelect}
      title={hint}
      aria-current={isActive ? 'page' : undefined}
      className="group flex w-full cursor-pointer items-center gap-2.5 rounded-lg transition-colors"
      style={{
        background: isActive ? T.accentBg : 'transparent',
        border: 'none',
        padding: '8px 10px',
        textAlign: 'left',
      }}
      onMouseEnter={(e) => {
        if (!isActive) (e.currentTarget as HTMLElement).style.background = T.surface
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLElement).style.background = isActive ? T.accentBg : 'transparent'
      }}
    >
      <div
        aria-hidden="true"
        className="flex shrink-0 items-center justify-center rounded-md"
        style={{ width: 28, height: 28, background: bg }}
      >
        <Icon size={15} style={{ color }} strokeWidth={2} />
      </div>
      <span
        style={{
          fontSize: 13,
          color: isActive ? T.accentText : T.text,
          fontWeight: isActive ? 600 : 500,
        }}
      >
        {label}
      </span>
    </button>
  )
}
