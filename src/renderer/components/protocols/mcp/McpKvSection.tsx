import type { KeyValuePair } from '../../../types'
import KeyValueTable from '../../shared/KeyValueTable'

interface McpKvSectionProps {
  /** `mcp-headers` → `mcp-headers-section` (the panel). The tab carries the toggle / count. */
  testIdPrefix: string
  rows: KeyValuePair[]
  onUpdate: (id: string, updates: Partial<KeyValuePair>) => void
  onRemove: (id: string) => void
  onAdd: () => void
  addLabel: string
  keyAutocompleteEntries?: readonly string[]
  hint?: string
}

/**
 * Key/value panel of the MCP config tab strip — shared by the custom headers
 * (issue #137) and the stdio environment (issue #139). The tab strip owns the
 * title, count and collapse; this is just the table. Rows stay editable while
 * connected; edits apply on the next Connect.
 */
export default function McpKvSection({
  testIdPrefix,
  rows,
  onUpdate,
  onRemove,
  onAdd,
  addLabel,
  keyAutocompleteEntries,
  hint,
}: McpKvSectionProps) {
  return (
    <div data-testid={`${testIdPrefix}-section`}>
      {hint && <p className="mt-0 mb-2 text-[12px] text-[var(--muted)]">{hint}</p>}
      <KeyValueTable
        rows={rows}
        onUpdate={onUpdate}
        onRemove={onRemove}
        onAdd={onAdd}
        addLabel={addLabel}
        keyAutocompleteEntries={keyAutocompleteEntries}
      />
    </div>
  )
}
