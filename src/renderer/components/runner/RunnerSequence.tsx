import { useState, useMemo } from 'react'
import MethodBadge from '../shared/MethodBadge'
import { ChevronRight, FolderClosed } from 'lucide-react'
import type { RunPhase } from '../../../shared/runner-verdict'
import { useTranslation } from '../../lib/i18n'
import type { RunnerEndpointItem, RunnerFolderGroup } from './RunnerTab'

interface RunnerSequenceProps {
  endpoints: RunnerEndpointItem[]
  folderGroups: RunnerFolderGroup[]
  onToggle: (id: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onReset: () => void
  /**
   * When provided, each row gets a phase picker (Flow / Setup / Teardown) so a
   * run can designate its fixtures and its cleanup without a separate screen —
   * issue #72. Omitted on paths that can't configure a run (auto-run).
   */
  onSetPhase?: (id: string, phase: RunPhase) => void
  /**
   * When provided, rows become draggable. `insertBeforeId` is the row that
   * should follow the dragged row after the drop; null means "append".
   * Only wired in suite-mode today — the APIs / Runner mode keeps the
   * tree's sort order and doesn't support inline reorder.
   */
  onReorder?: (draggedId: string, insertBeforeId: string | null) => void
}

/** Build a flat list with folder labels injected at transition points */
interface SequenceRow {
  type: 'endpoint'
  index: number
  endpoint: RunnerEndpointItem
  folderLabel?: string // shown only on first endpoint of a new folder
}

function buildSequenceRows(
  groups: RunnerFolderGroup[],
  endpoints: RunnerEndpointItem[],
): SequenceRow[] {
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
  onReorder,
  onSetPhase,
}: RunnerSequenceProps) {
  const { t } = useTranslation()
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
        {rows.map((row, i) => (
          <EndpointRow
            key={row.endpoint.id}
            index={row.index}
            endpoint={row.endpoint}
            folderLabel={row.folderLabel}
            onToggle={() => onToggle(row.endpoint.id)}
            onReorder={onReorder}
            nextEndpointId={rows[i + 1]?.endpoint.id ?? null}
            onSetPhase={onSetPhase}
            t={t}
          />
        ))}
        {endpoints.length === 0 && (
          <div className="flex h-full items-center justify-center" style={{ color: 'var(--hint)' }}>
            No endpoints in this folder
          </div>
        )}
      </div>
      {/* Phase legend — the run order is Setup → Flow → Teardown regardless of
          where a request sits in this list, so say so. */}
      {onSetPhase && endpoints.length > 0 && (
        <div
          className="shrink-0 border-t border-[var(--border)] px-4 py-2"
          style={{ fontSize: 12, color: 'var(--hint)' }}
        >
          {t('runPhase.hint')}
        </div>
      )}
    </div>
  )
}

/* ── Endpoint row with optional folder label (Postman style) ── */

function EndpointRow({
  index,
  endpoint,
  folderLabel,
  onToggle,
  onReorder,
  nextEndpointId,
  onSetPhase,
  t,
}: {
  index: number
  endpoint: RunnerEndpointItem
  folderLabel?: string
  onToggle: () => void
  onReorder?: (draggedId: string, insertBeforeId: string | null) => void
  nextEndpointId: string | null
  onSetPhase?: (id: string, phase: RunPhase) => void
  t: (key: string) => string
}) {
  const [hovered, setHovered] = useState(false)
  const [dropPos, setDropPos] = useState<'before' | 'after' | null>(null)
  const draggable = !!onReorder

  const handleDragStart = (e: React.DragEvent) => {
    if (!draggable) return
    e.dataTransfer.setData('application/testnizer-runner-row', endpoint.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent) => {
    if (!draggable) return
    if (!e.dataTransfer.types.includes('application/testnizer-runner-row')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const pos = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after'
    if (dropPos !== pos) setDropPos(pos)
  }

  const handleDragLeave = () => {
    if (dropPos !== null) setDropPos(null)
  }

  const handleDrop = (e: React.DragEvent) => {
    if (!draggable || !onReorder) return
    const draggedId = e.dataTransfer.getData('application/testnizer-runner-row')
    if (!draggedId) return
    e.preventDefault()
    const pos = dropPos ?? 'after'
    setDropPos(null)
    if (draggedId === endpoint.id) return
    // 'before' → insert before this row. 'after' → insert before the row
    // that immediately follows this one (null = append at end of list).
    onReorder(draggedId, pos === 'before' ? endpoint.id : nextEndpointId)
  }

  return (
    <div
      draggable={draggable}
      className="relative flex items-center gap-2 border-b border-[var(--border)] px-3 py-[7px]"
      style={{
        background: hovered ? 'var(--surface)' : 'transparent',
        transition: 'background 0.1s',
        cursor: draggable ? 'grab' : 'default',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dropPos === 'before' && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 8,
            right: 8,
            height: 2,
            background: 'var(--accent)',
            pointerEvents: 'none',
          }}
        />
      )}
      {dropPos === 'after' && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 8,
            right: 8,
            height: 2,
            background: 'var(--accent)',
            pointerEvents: 'none',
          }}
        />
      )}

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
          draggable={false}
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
      <span draggable={false} className="flex-1 truncate" style={{ color: 'var(--text)' }}>
        {endpoint.name}
      </span>

      {/* Phase picker — designates this request as run setup or teardown. */}
      {onSetPhase && (
        <select
          value={endpoint.phase ?? 'main'}
          aria-label={`${t('runPhase.label')}: ${endpoint.name}`}
          onChange={(e) => onSetPhase(endpoint.id, e.target.value as RunPhase)}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 cursor-pointer rounded-[5px] border border-[var(--border)] bg-[var(--white)] px-1 py-0.5 outline-none"
          style={{
            fontSize: 11,
            color:
              endpoint.phase && endpoint.phase !== 'main' ? 'var(--accent-text)' : 'var(--muted)',
            fontWeight: endpoint.phase && endpoint.phase !== 'main' ? 600 : 400,
          }}
        >
          <option value="main">{t('runPhase.main')}</option>
          <option value="setup">{t('runPhase.setup')}</option>
          <option value="teardown">{t('runPhase.teardown')}</option>
        </select>
      )}
    </div>
  )
}
