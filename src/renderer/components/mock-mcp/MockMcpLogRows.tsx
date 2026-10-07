import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { MockMcpLogEntry } from '../../types/mock-mcp'
import { logOutcome, logTime } from './mock-mcp-format'

/** Lists longer than this are virtualized (project rule: 100+ rows). */
const VIRTUALIZE_AFTER = 100
export const LOG_ROW_HEIGHT = 26
export const LOG_GRID = 'grid grid-cols-[90px_1fr_140px_70px_90px] gap-2'

function Row({
  entry,
  active,
  onSelect,
}: {
  entry: MockMcpLogEntry
  active: boolean
  onSelect: (id: string) => void
}) {
  const outcome = logOutcome(entry)
  return (
    <button
      type="button"
      data-testid="mock-mcp-log-row"
      onClick={() => onSelect(entry.id)}
      style={{ height: LOG_ROW_HEIGHT }}
      className={`${LOG_GRID} w-full cursor-pointer items-center border-x-0 border-b border-t-0 border-[var(--border)] px-3 text-left font-mono text-[11px] ${
        active ? 'bg-[var(--accent-light)]' : 'bg-transparent hover:bg-[var(--surface)]'
      }`}
    >
      <span className="text-[var(--muted)]">{logTime(entry.ts)}</span>
      <span className="truncate text-[var(--text)]">{entry.method}</span>
      <span className="truncate text-[var(--text)]">{entry.toolName ?? ''}</span>
      <span className="text-right text-[var(--muted)]">{entry.durationMs} ms</span>
      <span className={outcome === 'ok' ? 'text-[var(--green)]' : 'text-[var(--red)]'}>
        {outcome}
      </span>
    </button>
  )
}

/** Log table body: plain DOM up to 100 rows, virtualized beyond; follows the tail. */
export default function MockMcpLogRows({
  entries,
  selectedId,
  onSelect,
}: {
  entries: readonly MockMcpLogEntry[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const parentRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const virtual = entries.length > VIRTUALIZE_AFTER
  const virtualizer = useVirtualizer({
    count: virtual ? entries.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => LOG_ROW_HEIGHT,
    overscan: 12,
  })

  useEffect(() => {
    const el = parentRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [entries.length])

  return (
    <div
      ref={parentRef}
      data-testid="mock-mcp-log-rows"
      className="min-h-0 flex-1 overflow-y-auto"
      onScroll={(e) => {
        const el = e.currentTarget
        stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < LOG_ROW_HEIGHT * 2
      }}
    >
      {virtual ? (
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const entry = entries[vi.index]
            return (
              <div
                key={entry.id}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${vi.start}px)` }}
              >
                <Row entry={entry} active={entry.id === selectedId} onSelect={onSelect} />
              </div>
            )
          })}
        </div>
      ) : (
        entries.map((entry) => (
          <Row key={entry.id} entry={entry} active={entry.id === selectedId} onSelect={onSelect} />
        ))
      )}
    </div>
  )
}
