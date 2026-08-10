import { useState, useMemo } from 'react'
import MethodBadge from '../shared/MethodBadge'
import { ChevronRight, ChevronDown, FolderClosed, FolderOpen } from 'lucide-react'
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
   * Assign a role to a whole folder, subfolders included (issue #90). Tagging
   * every request by hand is the part users asked to stop doing.
   */
  onSetFolderPhase?: (folderId: string, phase: RunPhase) => void
  /** Select / deselect a folder and everything beneath it. */
  onToggleFolder?: (folderId: string, selected: boolean) => void
  /**
   * When provided, rows become draggable. `insertBeforeId` is the row that
   * should follow the dragged row after the drop; null means "append".
   * Only wired in suite-mode today — the APIs / Runner mode keeps the
   * tree's sort order and doesn't support inline reorder.
   */
  onReorder?: (draggedId: string, insertBeforeId: string | null) => void
}

/* ── Tree model ────────────────────────────────────────────────
 *
 * The sequence used to be built as a flat row list with the folder's FULL PATH
 * stamped on every row. For a suite of any depth that reads as a list of
 * near-identical labels with the structure spelled out sideways — the complaint
 * in issue #90. `folderGroups` now carries `parentId`, so the same data assembles
 * into the tree the user actually organised.
 */

interface FolderNode {
  group: RunnerFolderGroup
  children: FolderNode[]
  /** Every request at or below this folder — drives the role + checkbox state. */
  descendants: RunnerEndpointItem[]
}

interface SequenceTree {
  /** Requests that belong to no folder (suite root items, loose endpoints). */
  loose: RunnerEndpointItem[]
  roots: FolderNode[]
}

function buildTree(groups: RunnerFolderGroup[], endpoints: RunnerEndpointItem[]): SequenceTree {
  const byId = new Map(groups.map((g) => [g.folderId, g]))
  const childrenOf = new Map<string, RunnerFolderGroup[]>()
  const roots: RunnerFolderGroup[] = []
  for (const g of groups) {
    // A parent that isn't in the list (filtered suite, partial fetch) makes the
    // group a root rather than an orphan nobody can see.
    if (g.parentId && byId.has(g.parentId)) {
      const list = childrenOf.get(g.parentId)
      if (list) list.push(g)
      else childrenOf.set(g.parentId, [g])
    } else {
      roots.push(g)
    }
  }

  const visited = new Set<string>()
  const build = (group: RunnerFolderGroup): FolderNode | null => {
    // `parentId` is a stored column; a cycle in it must not hang the sequence.
    if (visited.has(group.folderId)) return null
    visited.add(group.folderId)
    const children = (childrenOf.get(group.folderId) ?? [])
      .map(build)
      .filter((n): n is FolderNode => n !== null)
    const descendants = [...group.endpoints, ...children.flatMap((c) => c.descendants)]
    // Prune branches that hold no requests at all. Empty folders are collected
    // on purpose (they keep the parent chain intact) but have nothing to show.
    if (descendants.length === 0) return null
    return { group, children, descendants }
  }

  const grouped = new Set(groups.flatMap((g) => g.endpoints.map((ep) => ep.id)))
  return {
    loose: endpoints.filter((ep) => !grouped.has(ep.id)),
    roots: roots.map(build).filter((n): n is FolderNode => n !== null),
  }
}

/** The role a folder shows: the one its requests agree on, or 'mixed'. */
function folderPhase(descendants: RunnerEndpointItem[]): RunPhase | 'mixed' {
  const first = descendants[0]?.phase ?? 'main'
  return descendants.every((ep) => (ep.phase ?? 'main') === first) ? first : 'mixed'
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
  onSetFolderPhase,
  onToggleFolder,
}: RunnerSequenceProps) {
  const { t } = useTranslation()
  const tree = useMemo(() => buildTree(folderGroups, endpoints), [folderGroups, endpoints])
  // Collapsed rather than expanded, so "open by default" needs no bookkeeping
  // for folders that appear later (a suite refetch, a different scope).
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  const toggleCollapse = (folderId: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }

  // Row numbers follow the order requests actually run in, so the sequence can
  // be read top to bottom even with the tree collapsed.
  let counter = 0
  const nextIndex = (): number => ++counter

  // Flat drop targets: "insert before the row that follows this one" needs the
  // linear order, which the tree hides.
  const flatOrder = useMemo(() => {
    const ids: string[] = []
    const walk = (nodes: FolderNode[]): void => {
      for (const n of nodes) {
        for (const ep of n.group.endpoints) ids.push(ep.id)
        walk(n.children)
      }
    }
    ids.push(...tree.loose.map((ep) => ep.id))
    walk(tree.roots)
    return ids
  }, [tree])

  const nextIdAfter = (id: string): string | null => {
    const i = flatOrder.indexOf(id)
    return i >= 0 && i + 1 < flatOrder.length ? flatOrder[i + 1] : null
  }

  const renderFolder = (node: FolderNode, depth: number): React.ReactNode => {
    const isCollapsed = collapsed.has(node.group.folderId)
    const selectedCount = node.descendants.filter((ep) => ep.selected).length
    const phase = folderPhase(node.descendants)
    return (
      <div key={node.group.folderId}>
        <FolderRow
          node={node}
          depth={depth}
          collapsed={isCollapsed}
          selectedCount={selectedCount}
          phase={phase}
          onToggleCollapse={() => toggleCollapse(node.group.folderId)}
          onToggleFolder={onToggleFolder}
          onSetFolderPhase={onSetFolderPhase}
          t={t}
        />
        {!isCollapsed && (
          <>
            {node.group.endpoints.map((ep) => (
              <EndpointRow
                key={ep.id}
                index={nextIndex()}
                depth={depth + 1}
                endpoint={ep}
                onToggle={() => onToggle(ep.id)}
                onReorder={onReorder}
                nextEndpointId={nextIdAfter(ep.id)}
                onSetPhase={onSetPhase}
                t={t}
              />
            ))}
            {node.children.map((child) => renderFolder(child, depth + 1))}
          </>
        )}
      </div>
    )
  }

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

      {/* Sequence — folder tree, with un-foldered requests at the top level */}
      <div className="flex-1 overflow-auto" data-testid="runner-sequence-list">
        {tree.loose.map((ep) => (
          <EndpointRow
            key={ep.id}
            index={nextIndex()}
            depth={0}
            endpoint={ep}
            onToggle={() => onToggle(ep.id)}
            onReorder={onReorder}
            nextEndpointId={nextIdAfter(ep.id)}
            onSetPhase={onSetPhase}
            t={t}
          />
        ))}
        {tree.roots.map((node) => renderFolder(node, 0))}
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

/* ── Folder row ────────────────────────────────────────────────
 *
 * Collapsible, and the place a role is applied to a whole subtree. The role
 * select reads "Mixed" when the requests underneath disagree — showing one of
 * them instead would claim a uniformity that isn't there, and the next click
 * would silently rewrite the others.
 */

function FolderRow({
  node,
  depth,
  collapsed,
  selectedCount,
  phase,
  onToggleCollapse,
  onToggleFolder,
  onSetFolderPhase,
  t,
}: {
  node: FolderNode
  depth: number
  collapsed: boolean
  selectedCount: number
  phase: RunPhase | 'mixed'
  onToggleCollapse: () => void
  onToggleFolder?: (folderId: string, selected: boolean) => void
  onSetFolderPhase?: (folderId: string, phase: RunPhase) => void
  t: (key: string) => string
}) {
  const [hovered, setHovered] = useState(false)
  const total = node.descendants.length
  const allSelected = selectedCount === total
  const noneSelected = selectedCount === 0

  return (
    <div
      className="flex items-center gap-2 border-b border-[var(--border)] py-[7px] pr-3"
      style={{
        paddingLeft: 12 + depth * 14,
        background: hovered ? 'var(--surface)' : 'var(--bg)',
        transition: 'background 0.1s',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-testid="runner-sequence-folder"
    >
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${node.group.label}`}
        className="flex shrink-0 cursor-pointer items-center border-none bg-transparent p-0"
        style={{ color: 'var(--muted)' }}
      >
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
      </button>

      {onToggleFolder && (
        <input
          type="checkbox"
          checked={allSelected}
          ref={(el) => {
            // Tri-state: a partially selected folder must not look unchecked,
            // or "Select all" and "nothing selected" render identically.
            if (el) el.indeterminate = !allSelected && !noneSelected
          }}
          onChange={() => onToggleFolder(node.group.folderId, !allSelected)}
          // No colon before the name, deliberately. The phase pickers are
          // labelled "Phase: <request>" / "Phase — <folder>", and specs address
          // them with `/: <name>$/`; a checkbox labelled "…: <name>" matches the
          // same pattern and turns one locator into two elements.
          aria-label={`Select folder ${node.group.label}`}
          className="h-[15px] w-[15px] shrink-0 cursor-pointer accent-[var(--accent)]"
        />
      )}

      <span className="flex shrink-0 items-center" style={{ color: 'var(--muted)' }}>
        {collapsed ? <FolderClosed size={13} /> : <FolderOpen size={13} />}
      </span>

      <span className="flex-1 truncate" style={{ color: 'var(--text)', fontWeight: 500 }}>
        {node.group.label}
      </span>

      <span className="shrink-0" style={{ color: 'var(--hint)', fontSize: 11 }}>
        {selectedCount}/{total}
      </span>

      {onSetFolderPhase && (
        <select
          value={phase}
          aria-label={`${t('runPhase.label')} — ${node.group.label}`}
          onChange={(e) => onSetFolderPhase(node.group.folderId, e.target.value as RunPhase)}
          className="shrink-0 cursor-pointer rounded-[5px] border border-[var(--border)] bg-[var(--white)] px-1 py-0.5 outline-none"
          style={{
            fontSize: 11,
            color: phase !== 'main' && phase !== 'mixed' ? 'var(--accent-text)' : 'var(--muted)',
            fontWeight: phase !== 'main' && phase !== 'mixed' ? 600 : 400,
          }}
        >
          {/* Present only while the subtree disagrees, and unselectable: it
              describes a state, it is not a role you can assign. */}
          {phase === 'mixed' && (
            <option value="mixed" disabled>
              {t('runPhase.mixed')}
            </option>
          )}
          <option value="main">{t('runPhase.main')}</option>
          <option value="setup">{t('runPhase.setup')}</option>
          <option value="teardown">{t('runPhase.teardown')}</option>
        </select>
      )}
    </div>
  )
}

/* ── Endpoint row ──────────────────────────────────────────── */

function EndpointRow({
  index,
  depth,
  endpoint,
  onToggle,
  onReorder,
  nextEndpointId,
  onSetPhase,
  t,
}: {
  index: number
  depth: number
  endpoint: RunnerEndpointItem
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
      className="relative flex items-center gap-2 border-b border-[var(--border)] py-[7px] pr-3"
      style={{
        paddingLeft: 12 + depth * 14,
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
        // See the folder checkbox: no colon, so this cannot collide with the
        // "Phase: <request>" locator convention.
        aria-label={`Select ${endpoint.name}`}
        className="h-[15px] w-[15px] shrink-0 cursor-pointer accent-[var(--accent)]"
      />

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
