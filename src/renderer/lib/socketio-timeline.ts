/**
 * Socket.IO timeline rows → text (preview, copy, search) and → a saved
 * message ("Save" on a row, issue #283). Pure: no store imports.
 */
import { isTaggedBinary, type SioArg, type SioSavedMessage } from '../../shared/realtime'
import { makeId } from './utils'

/** The part of a timeline row these helpers read. */
export interface SioTimelineRow {
  direction: 'in' | 'out' | 'ack' | 'system'
  event: string
  data: unknown
  args?: unknown[]
  error?: string
}

/** One argument as display / copy text: strings as-is, binary as base64, the rest pretty JSON. */
export function argText(value: unknown): string {
  if (typeof value === 'string') return value
  if (isTaggedBinary(value)) return value.$binary
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

/** The row's arguments: `args` when it carried several (or none), else `[data]`. */
export function rowArgs(row: SioTimelineRow): unknown[] {
  if (row.args) return row.args
  return row.data === null && row.direction === 'ack' ? [] : [row.data]
}

/** The row's payload text (all arguments, one per block). */
export function rowText(row: SioTimelineRow): string {
  if (row.direction === 'system') return row.data == null ? '' : String(row.data)
  if (row.error) return row.error
  return rowArgs(row).map(argText).join('\n\n')
}

/** Whether the row matches a search: event name or payload, case-insensitive. */
export function rowMatches(row: SioTimelineRow, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return row.event.toLowerCase().includes(q) || rowText(row).toLowerCase().includes(q)
}

function argOf(value: unknown): SioArg {
  if (typeof value === 'string') return { id: makeId(), content: value, contentType: 'text' }
  if (isTaggedBinary(value)) return { id: makeId(), content: value.$binary, contentType: 'base64' }
  return { id: makeId(), content: argText(value), contentType: 'json' }
}

/** A sent / received event as a saved message (event name + every argument). */
export function savedMessageFromTimeline(row: SioTimelineRow): SioSavedMessage {
  return {
    id: makeId(),
    name: row.event || 'message',
    eventName: row.event || 'message',
    acknowledgement: false,
    args: rowArgs(row).map(argOf),
  }
}
