/**
 * One Logs row per stream (issue #226).
 *
 * The main process logs an SSE / AI (`llm`) stream twice: when it opens
 * (`x-mock-stream: open` or `open;resumeAt=N`, empty body) and when it ends
 * (`x-mock-stream: frames=N;reason=…`, the frames sent). Both entries carry
 * the same `x-mock-stream-id` (`src/main/mock/server.ts`). The Logs list
 * shows ONE row per stream: the open entry until the stream ends, then the
 * closed entry in its place — with the open entry's `id` (a selected row
 * stays selected) and `ts` (the Time column is when the request came in, like
 * every other row). Entries without a stream id (a plain request, the
 * refused 204 reconnect) are rows of their own.
 *
 * Applied to the live events AND to the list loaded from main, which keeps
 * both raw entries.
 */
import type { MockLogEntry } from '../types'

const STREAM_TAG = 'x-mock-stream'
const STREAM_ID = 'x-mock-stream-id'

function streamIdOf(e: MockLogEntry): string | null {
  return e.response?.headers?.[STREAM_ID] ?? null
}

/** The open entry of a stream that has not ended yet (a closed one says `frames=…`). */
export function isOpenStreamEntry(e: MockLogEntry): boolean {
  return (e.response?.headers?.[STREAM_TAG] ?? '').startsWith('open')
}

/**
 * Add one entry to a collapsed list: a stream's closed entry replaces its open
 * row in place; anything else is appended. Returns a new array.
 */
export function mergeStreamLog(list: readonly MockLogEntry[], entry: MockLogEntry): MockLogEntry[] {
  const id = streamIdOf(entry)
  const at = id === null ? -1 : list.findIndex((e) => streamIdOf(e) === id)
  const next = [...list]
  if (at === -1) next.push(entry)
  else next[at] = combine(list[at], entry)
  return next
}

/** Collapse a raw log list (oldest first) to one entry per stream. */
export function collapseStreamLogs(list: readonly MockLogEntry[]): MockLogEntry[] {
  const out: MockLogEntry[] = []
  const rowOfStream = new Map<string, number>()
  for (const e of list) {
    const id = streamIdOf(e)
    const at = id === null ? undefined : rowOfStream.get(id)
    if (at === undefined) {
      if (id !== null) rowOfStream.set(id, out.length)
      out.push(e)
    } else {
      out[at] = combine(out[at], e)
    }
  }
  return out
}

/** The row for a stream that already has one (`prev`) when `entry` arrives. */
function combine(prev: MockLogEntry, entry: MockLogEntry): MockLogEntry {
  // A late duplicate "open" never undoes a finished stream.
  if (isOpenStreamEntry(entry) && !isOpenStreamEntry(prev)) return prev
  return isOpenStreamEntry(prev) ? { ...entry, id: prev.id, ts: prev.ts } : entry
}
