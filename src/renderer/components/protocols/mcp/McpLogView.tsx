import { useState, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { useTranslation } from '../../../lib/i18n'
import McpVirtualRows from './McpVirtualRows'
import { JsonPre } from './ui'

interface LogEntry {
  id: string
}

interface Props<T extends LogEntry> {
  items: readonly T[]
  testId: string
  /** Lower-cased haystack for the text filter. */
  searchText: (item: T) => string
  renderRow: (item: T) => ReactNode
  detail: (item: T) => unknown
  onClear: () => void
  emptyText: string
}

/**
 * Filterable list + JSON detail split, shared by the Notifications and
 * Frames tabs of the MCP messages pane. Clicking a row shows its JSON.
 */
export default function McpLogView<T extends LogEntry>({
  items,
  testId,
  searchText,
  renderRow,
  detail,
  onClear,
  emptyText,
}: Props<T>) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const q = filter.trim().toLowerCase()
  const visible = q ? items.filter((it) => searchText(it).includes(q)) : items
  const selected = items.find((it) => it.id === selectedId)

  return (
    <div data-testid={testId} className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-2.5 py-1">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('mcp.messages.filter')}
          data-testid={`${testId}-filter`}
          className="h-6 min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--input-bg)] px-2 text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--placeholder)]"
        />
        <span className="text-[11px] text-[var(--muted)]">{visible.length}</span>
        <button
          type="button"
          onClick={() => {
            onClear()
            setSelectedId(null)
          }}
          data-testid={`${testId}-clear`}
          className="flex cursor-pointer items-center gap-1 rounded border-none bg-transparent px-1.5 py-0.5 text-[11px] text-[var(--muted)] hover:bg-[var(--surface)]"
        >
          <Trash2 size={12} />
          {t('mcp.messages.clear')}
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        {visible.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-[12px] text-[var(--hint)]">
            {emptyText}
          </div>
        ) : (
          <McpVirtualRows
            items={visible}
            rowHeight={26}
            getKey={(it) => it.id}
            renderRow={(it) => (
              <button
                type="button"
                onClick={() => setSelectedId(it.id)}
                aria-pressed={it.id === selectedId}
                className={`flex h-full w-full cursor-pointer items-center gap-2 border-x-0 border-t-0 border-b border-[var(--border)] px-2.5 text-left text-[12px] ${
                  it.id === selectedId
                    ? 'bg-[var(--accent-light)] text-[var(--accent-text)]'
                    : 'bg-transparent text-[var(--text)] hover:bg-[var(--item-hover)]'
                }`}
              >
                {renderRow(it)}
              </button>
            )}
          />
        )}
        {selected && (
          <div
            data-testid={`${testId}-detail`}
            className="w-1/2 shrink-0 overflow-auto border-l border-[var(--border)] p-2.5"
          >
            <JsonPre value={detail(selected)} />
          </div>
        )}
      </div>
    </div>
  )
}
