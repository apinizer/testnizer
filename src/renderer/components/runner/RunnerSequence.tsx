import { useState, useMemo } from 'react'
import MethodBadge from '../shared/MethodBadge'
import { ChevronRight, FolderClosed, GripVertical } from 'lucide-react'
import type { RunnerEndpointItem, RunnerFolderGroup } from './RunnerTab'

interface RunnerSequenceProps {
  endpoints: RunnerEndpointItem[]
  folderGroups: RunnerFolderGroup[]
  onToggle: (id: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onReset: () => void
}

/** Build a flat list with folder labels injected at transition points */
interface SequenceRow {
  type: 'endpoint'
  index: number
  endpoint: RunnerEndpointItem
  folderLabel?: string // shown only on first endpoint of a new folder
}

function buildSequenceRows(groups: RunnerFolderGroup[], endpoints: RunnerEndpointItem[]): SequenceRow[] {
  const rows: SequenceRow[] = []
  let idx = 0

  if (groups.length > 0) {
    for (const group of groups) {
      for (const ep of group.endpoints) {
        idx++
        rows.push({
          type: 'endpoint',
          index: idx,
          endpoint: ep,
          folderLabel: group.folderName,
        })
      }
    }
  } else {
    for (const ep of endpoints) {
      idx++
      rows.push({ type: 'endpoint', index: idx, endpoint: ep })
    }
  }

  return rows
}

export default function RunnerSequence({
  endpoints,
  folderGroups,
  onToggle,
  onSelectAll,
  onDeselectAll,
  onReset,
}: RunnerSequenceProps) {
  const rows = useMemo(() => buildSequenceRows(folderGroups, endpoints), [folderGroups, endpoints])

  return (
    <div className="flex w-full flex-col overflow-hidden" style={{ fontSize: 13 }}>
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
        <span style={{ fontWeight: 600, color: 'var(--text)' }}>Run Sequence</span>
        <div className="flex items-center gap-1" style={{ color: 'var(--muted)' }}>
          <button
            type="button"
            onClick={onDeselectAll}
            className="cursor-pointer border-none bg-transparent px-1.5 py-0.5 hover:text-[var(--text)]"
            style={{ fontSize: 13, color: 'inherit' }}
          >
            Deselect All
          </button>
          <span style={{ color: 'var(--border2)' }}>|</span>
          <button
            type="button"
            onClick={onSelectAll}
            className="cursor-pointer border-none bg-transparent px-1.5 py-0.5 hover:text-[var(--text)]"
            style={{ fontSize: 13, color: 'inherit' }}
          >
            Select All
          </button>
          <span style={{ color: 'var(--border2)' }}>|</span>
          <button
            type="button"
            onClick={onReset}
            className="cursor-pointer border-none bg-transparent px-1.5 py-0.5 hover:text-[var(--text)]"
            style={{ fontSize: 13, color: 'inherit' }}
          >
            Reset
          </button>
        </div>
      </div>

      {/* Endpoint list */}
      <div className="flex-1 overflow-auto">
        {rows.map((row) => (
          <EndpointRow
            key={row.endpoint.id}
            index={row.index}
            endpoint={row.endpoint}
            folderLabel={row.folderLabel}
            onToggle={() => onToggle(row.endpoint.id)}
          />
        ))}
        {endpoints.length === 0 && (
          <div className="flex h-full items-center justify-center" style={{ color: 'var(--hint)' }}>
            No endpoints in this folder
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Endpoint row with optional folder label (Postman style) ── */

function EndpointRow({
  index,
  endpoint,
  folderLabel,
  onToggle,
}: {
  index: number
  endpoint: RunnerEndpointItem
  folderLabel?: string
  onToggle: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-[7px]"
      style={{ background: hovered ? 'var(--surface)' : 'transparent', transition: 'background 0.1s' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Row number */}
      <span style={{ width: 24, textAlign: 'right', color: 'var(--hint)', flexShrink: 0 }}>
        {index}
      </span>

      {/* Checkbox */}
      <input
        type="checkbox"
        checked={endpoint.selected}
        onChange={onToggle}
        className="h-[15px] w-[15px] shrink-0 cursor-pointer accent-[var(--accent)]"
      />

      {/* Folder + chevron icons */}
      <span className="flex shrink-0 items-center gap-0.5" style={{ color: 'var(--hint)' }}>
        <FolderClosed size={12} />
        <ChevronRight size={10} />
      </span>

      {/* Folder label (shown on first endpoint of each folder, like Postman) */}
      {folderLabel && (
        <span
          style={{
            color: 'var(--muted)',
            fontWeight: 500,
            flexShrink: 0,
            maxWidth: 120,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            borderRight: '1px solid var(--border)',
            paddingRight: 6,
            marginRight: 2,
          }}
        >
          {folderLabel}
        </span>
      )}

      {/* Method badge */}
      <MethodBadge method={endpoint.method} />

      {/* Name */}
      <span className="flex-1 truncate" style={{ color: 'var(--text)' }}>
        {endpoint.name}
      </span>
    </div>
  )
}
