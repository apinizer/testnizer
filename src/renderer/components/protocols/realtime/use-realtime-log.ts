import { useMemo, useState } from 'react'

/** Log filter (Postman: All / Sent / Received; plus connection rows). */
export type LogFilter = 'all' | 'sent' | 'received' | 'system'
export type LogKind = 'sent' | 'received' | 'system'

export interface LogItem {
  id: string
  timestamp: number
}

/**
 * Search, filter and two-row selection of a message log (issues #282 / #283)
 * — the state behind `RealtimeLogToolbar`, shared by the WebSocket log and
 * the Socket.IO timeline. Selecting a third row drops the oldest selection;
 * `diffMs` is the time between the two selected rows (Postman's "time
 * difference" / latency between two events).
 */
export function useRealtimeLog<T extends LogItem>(
  rows: readonly T[],
  kindOf: (row: T) => LogKind,
  matches: (row: T, query: string) => boolean,
) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<LogFilter>('all')
  const [selected, setSelected] = useState<string[]>([])

  const visible = useMemo(
    () =>
      rows.filter(
        (r) => (filter === 'all' || kindOf(r) === filter) && (!query.trim() || matches(r, query)),
      ),
    // kindOf / matches are pure module-level functions at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, filter, query],
  )

  const live = selected.filter((id) => rows.some((r) => r.id === id))
  const picked = live.map((id) => rows.find((r) => r.id === id)).filter((r): r is T => !!r)
  const diffMs = picked.length === 2 ? Math.abs(picked[1].timestamp - picked[0].timestamp) : null

  const toggleSelect = (id: string): void =>
    setSelected((cur) => {
      const kept = cur.filter((x) => rows.some((r) => r.id === x))
      if (kept.includes(id)) return kept.filter((x) => x !== id)
      return [...kept, id].slice(-2)
    })

  return {
    query,
    setQuery,
    filter,
    setFilter,
    visible,
    selected: live,
    toggleSelect,
    clearSelection: () => setSelected([]),
    diffMs,
  }
}
