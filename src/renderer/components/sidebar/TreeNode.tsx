import { useCallback, useState, useRef, useEffect } from 'react'
import type { TreeNode as TreeNodeType } from '../../types'
import MethodBadge from '../shared/MethodBadge'
import {
  FileText,
  Box,
  Briefcase,
  Folder,
  MoreHorizontal,
  Zap,
  Pencil,
  Trash2,
} from 'lucide-react'

interface TreeNodeProps {
  node: TreeNodeType
  depth?: number
  activeId: string | null
  onSelect: (node: TreeNodeType) => void
  onToggle: (id: string) => void
  onDelete?: (node: TreeNodeType) => void
  onRename?: (node: TreeNodeType, newName: string) => void
  openIds: Set<string>
  /** When true, children are not rendered (handled by virtualizer) */
  isFlat?: boolean
}

function NodeIcon({ icon }: { icon?: string }) {
  if (!icon) return null

  const iconMap: Record<string, React.ReactNode> = {
    module: <MoreHorizontal size={13} className="text-[var(--hint)]" />,
    collection: (
      <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded" style={{ background: '#5b6af0' }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="white">
          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <polyline points="13 2 13 9 20 9" fill="none" stroke="white" strokeWidth="2" />
        </svg>
      </div>
    ),
    endpoints: (
      <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-[var(--accent)]">
        <FileText size={10} className="text-white" />
      </div>
    ),
    schemas: (
      <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-[#4caf82]">
        <Box size={10} className="text-white" />
      </div>
    ),
    components: (
      <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-[#e88c3a]">
        <Briefcase size={10} className="text-white" />
      </div>
    ),
    folder: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="#fbbf24" stroke="none">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
    calc: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#bbb" strokeWidth="2"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="12" y2="14"/></svg>,
    quick: <Zap size={13} className="text-[var(--hint)]" />,
  }

  return <>{iconMap[icon] || null}</>
}

export default function TreeNodeComponent({
  node,
  depth = 0,
  activeId,
  onSelect,
  onToggle,
  onDelete,
  onRename,
  openIds,
  isFlat = false,
}: TreeNodeProps) {
  const isOpen = openIds.has(node.id)
  const hasChildren = node.children && node.children.length > 0
  const isRequest = !!node.method
  const isActive = activeId === node.id
  const indent = depth * 14
  const [hovered, setHovered] = useState(false)

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const contextRef = useRef<HTMLDivElement>(null)

  // Inline rename state
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  const canModify = node.type === 'folder' || node.type === 'endpoint' || node.type === 'request'

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [contextMenu])

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (renaming) {
      setTimeout(() => {
        renameInputRef.current?.focus()
        renameInputRef.current?.select()
      }, 20)
    }
  }, [renaming])

  const handleClick = useCallback(() => {
    if (renaming) return
    if (hasChildren) onToggle(node.id)
    if (isRequest) onSelect(node)
  }, [hasChildren, isRequest, node, onToggle, onSelect, renaming])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!canModify) return
      e.preventDefault()
      e.stopPropagation()
      setContextMenu({ x: e.clientX, y: e.clientY })
    },
    [canModify]
  )

  const startRename = useCallback(() => {
    setRenameValue(node.label)
    setRenaming(true)
    setContextMenu(null)
  }, [node.label])

  const confirmRename = useCallback(() => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== node.label && onRename) {
      onRename(node, trimmed)
    }
    setRenaming(false)
  }, [renameValue, node, onRename])

  const cancelRename = useCallback(() => {
    setRenaming(false)
  }, [])

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        confirmRename()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancelRename()
      }
    },
    [confirmRename, cancelRename]
  )

  const handleDeleteClick = useCallback(() => {
    setContextMenu(null)
    onDelete?.(node)
  }, [node, onDelete])

  return (
    <div>
      <div
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="flex cursor-pointer select-none items-center gap-[5px] rounded-md text-[0.875rem] transition-colors"
        style={{
          padding: `4px 10px 4px ${10 + indent}px`,
          background: isActive ? 'var(--accent-light)' : hovered ? 'var(--bg)' : 'transparent',
          color: isActive ? 'var(--accent-text)' : node.italic ? '#aaa' : '#444',
          fontStyle: node.italic ? 'italic' : 'normal',
        }}
      >
        {/* Arrow for folders */}
        {hasChildren && (
          <span
            className="inline-block shrink-0 text-[0.57rem] text-[var(--hint)] transition-transform duration-150"
            style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >
            {'\u25B6'}
          </span>
        )}
        {!hasChildren && !isRequest && <span className="inline-block w-2.5 shrink-0" />}

        {/* Icon */}
        {node.icon && node.icon !== 'folder' && <NodeIcon icon={node.icon} />}
        {isRequest && <MethodBadge method={node.method || 'GET'} small />}
        {node.icon === 'folder' && <NodeIcon icon="folder" />}

        {/* Label or rename input */}
        {renaming ? (
          <input
            ref={renameInputRef}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={confirmRename}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 rounded border px-1.5 py-0.5 text-sm outline-none"
            style={{
              borderColor: 'var(--accent)',
              background: 'var(--white)',
              color: 'var(--text)',
              minWidth: 0,
            }}
          />
        ) : (
          <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{node.label}</span>
        )}

        {/* Action buttons — shown on hover for modifiable items */}
        {!renaming && hovered && canModify && (
          <div className="flex shrink-0 items-center gap-0.5">
            {onRename && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); startRename() }}
                className="shrink-0 rounded p-0.5"
                style={{ background: 'transparent', border: 'none', color: 'var(--hint)', cursor: 'pointer', lineHeight: 1 }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--accent)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--hint)' }}
                title="Rename"
              >
                <Pencil size={12} />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDelete(node) }}
                className="shrink-0 rounded p-0.5"
                style={{ background: 'transparent', border: 'none', color: 'var(--hint)', cursor: 'pointer', lineHeight: 1 }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#cc2200' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--hint)' }}
                title="Delete"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        )}

        {/* Count badge */}
        {node.count != null && (
          <span
            className="ml-1 shrink-0 rounded-full px-[5px] text-[0.75rem]"
            style={{
              background: node.countBg || '#f0f0f5',
              color: node.countColor || '#888',
            }}
          >
            {node.count}
          </span>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextRef}
          className="fixed z-[9999] min-w-[160px] rounded-lg border py-1 shadow-lg"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            background: 'var(--white)',
            borderColor: 'var(--border)',
          }}
        >
          {onRename && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); startRename() }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--bg)]"
              style={{ color: 'var(--text)', border: 'none', background: 'transparent', cursor: 'pointer' }}
            >
              <Pencil size={13} style={{ color: 'var(--muted)' }} />
              Rename
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleDeleteClick() }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--bg)]"
              style={{ color: '#cc2200', border: 'none', background: 'transparent', cursor: 'pointer' }}
            >
              <Trash2 size={13} />
              Delete
            </button>
          )}
        </div>
      )}

      {/* Children — only rendered in non-flat (non-virtualized) mode */}
      {!isFlat && hasChildren && isOpen && node.children!.map((child) => (
        <TreeNodeComponent
          key={child.id}
          node={child}
          depth={depth + 1}
          activeId={activeId}
          onSelect={onSelect}
          onToggle={onToggle}
          onDelete={onDelete}
          onRename={onRename}
          openIds={openIds}
        />
      ))}
    </div>
  )
}
