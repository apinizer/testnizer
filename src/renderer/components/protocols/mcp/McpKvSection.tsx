import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { KeyValuePair } from '../../../types'
import KeyValueTable from '../../shared/KeyValueTable'

interface McpKvSectionProps {
  /** `mcp-headers` → `mcp-headers-section` / `-toggle` / `-count`. */
  testIdPrefix: string
  title: string
  icon: ReactNode
  rows: KeyValuePair[]
  onUpdate: (id: string, updates: Partial<KeyValuePair>) => void
  onRemove: (id: string) => void
  onAdd: () => void
  addLabel: string
  keyAutocompleteEntries?: readonly string[]
  hint?: string
}

/**
 * Collapsible key/value block of the MCP editor — shared by the custom
 * headers (issue #137) and the stdio environment (issue #139). Rows stay
 * editable while connected; edits apply on the next Connect.
 */
export default function McpKvSection({
  testIdPrefix,
  title,
  icon,
  rows,
  onUpdate,
  onRemove,
  onAdd,
  addLabel,
  keyAutocompleteEntries,
  hint,
}: McpKvSectionProps) {
  const [expanded, setExpanded] = useState(false)
  const enabledCount = rows.filter((r) => r.enabled && r.key.trim()).length

  return (
    <div
      data-testid={`${testIdPrefix}-section`}
      className="shrink-0 border-b border-[var(--border)] px-3.5 py-2"
    >
      <div className="rounded-lg border border-[var(--border)]">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          data-testid={`${testIdPrefix}-toggle`}
          aria-expanded={expanded}
          className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-2 text-left font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface)]"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="text-[var(--muted)]">{icon}</span>
          <span>{title}</span>
          {enabledCount > 0 && (
            <span
              data-testid={`${testIdPrefix}-count`}
              className="ml-1 rounded-full bg-[var(--green-bg)] px-[5px] text-[var(--green)]"
            >
              {enabledCount}
            </span>
          )}
        </button>
        {expanded && (
          <div className="max-h-60 overflow-auto border-t border-[var(--border)] p-3">
            {hint && <p className="mb-2 text-[12px] text-[var(--muted)]">{hint}</p>}
            <KeyValueTable
              rows={rows}
              onUpdate={onUpdate}
              onRemove={onRemove}
              onAdd={onAdd}
              addLabel={addLabel}
              keyAutocompleteEntries={keyAutocompleteEntries}
            />
          </div>
        )}
      </div>
    </div>
  )
}
