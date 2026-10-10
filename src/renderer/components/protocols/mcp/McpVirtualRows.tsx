import { useEffect, useRef, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

/** Lists longer than this are virtualized (project rule: 100+ rows). */
const VIRTUALIZE_AFTER = 100

interface Props<T> {
  items: readonly T[]
  rowHeight: number
  getKey: (item: T) => string
  renderRow: (item: T) => ReactNode
  testId?: string
  /**
   * Controlled auto-scroll (issue #172). When given, the list follows new
   * entries while `follow` is true; scrolling up reports `false`, scrolling
   * back to the bottom reports `true`. Omitted → the list sticks to the bottom
   * while the user is at the bottom (uncontrolled).
   */
  follow?: boolean
  onFollowChange?: (follow: boolean) => void
}

/**
 * Fixed-height rows; plain DOM up to 100 rows, `@tanstack/react-virtual`
 * beyond. Sticks to the bottom while the user is at the bottom, so a live
 * log keeps following new entries without yanking a user who scrolled up.
 */
export default function McpVirtualRows<T>({
  items,
  rowHeight,
  getKey,
  renderRow,
  testId,
  follow,
  onFollowChange,
}: Props<T>) {
  const parentRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const controlled = follow !== undefined
  const virtual = items.length > VIRTUALIZE_AFTER
  const virtualizer = useVirtualizer({
    count: virtual ? items.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  })

  useEffect(() => {
    const el = parentRef.current
    if (el && (controlled ? follow : stickRef.current)) el.scrollTop = el.scrollHeight
    // `follow` in the deps: turning auto-scroll back on jumps to the newest entry.
  }, [items.length, controlled, follow])

  return (
    <div
      ref={parentRef}
      data-testid={testId}
      className="min-h-0 flex-1 overflow-y-auto"
      onScroll={(e) => {
        const el = e.currentTarget
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < rowHeight * 2
        if (!controlled) stickRef.current = atBottom
        else if (atBottom !== follow) onFollowChange?.(atBottom)
      }}
    >
      {virtual ? (
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const item = items[vi.index]
            return (
              <div
                key={getKey(item)}
                className="absolute left-0 top-0 w-full"
                style={{ height: rowHeight, transform: `translateY(${vi.start}px)` }}
              >
                {renderRow(item)}
              </div>
            )
          })}
        </div>
      ) : (
        items.map((item) => (
          <div key={getKey(item)} style={{ height: rowHeight }}>
            {renderRow(item)}
          </div>
        ))
      )}
    </div>
  )
}
