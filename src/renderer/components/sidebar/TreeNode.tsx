import { useCallback, useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { TreeNode as TreeNodeType } from '../../types'
import MethodBadge from '../shared/MethodBadge'
import {
  FileText,
  Box,
  Briefcase,
  MoreHorizontal,
  Zap,
} from 'lucide-react'

interface TreeNodeProps {
  node: TreeNodeType
  depth?: number
  activeId: string | null
  onSelect: (node: TreeNodeType) => void
  onToggle: (id: string) => void
  onDelete?: (node: TreeNodeType) => void
  onRename?: (node: TreeNodeType, newName: string) => void
  onAddRequest?: (parentNode: TreeNodeType) => void
  onAddFolder?: (parentNode: TreeNodeType) => void
  onDuplicate?: (node: TreeNodeType) => void
  onRunFolder?: (node: TreeNodeType) => void
  onExport?: (node: TreeNodeType) => void
  openIds: Set<string>
  isFlat?: boolean
}

function NodeIcon({ icon }: { icon?: string }) {
  if (!icon) return null
  const iconMap: Record<string, React.ReactNode> = {
    module: <MoreHorizontal size={13} style={{ color: 'var(--hint)' }} />,
    collection: (
      <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded" style={{ background: 'var(--accent)' }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="white">
          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <polyline points="13 2 13 9 20 9" fill="none" stroke="white" strokeWidth="2" />
        </svg>
      </div>
    ),
    endpoints: (
      <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded" style={{ background: 'var(--accent)' }}>
        <FileText size={10} className="text-white" />
      </div>
    ),
    schemas: (
      <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded" style={{ background: 'var(--tree-schemas, #4caf82)' }}>
        <Box size={10} className="text-white" />
      </div>
    ),
    components: (
      <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded" style={{ background: 'var(--tree-components, #e88c3a)' }}>
        <Briefcase size={10} className="text-white" />
      </div>
    ),
    folder: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--tree-folder)" strokeWidth="1.8">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
    calc: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--hint)" strokeWidth="2"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="12" y2="14"/></svg>,
    quick: <Zap size={13} style={{ color: 'var(--hint)' }} />,
  }
  return <>{iconMap[icon] || null}</>
}

/* ── Context menu item ── */
interface MenuItemDef {
  label: string
  icon?: React.ReactNode
  danger?: boolean
  separator?: boolean
  action: () => void
}

function ContextMenu({ items, x, y, onClose }: { items: MenuItemDef[]; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  // Clamp to viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(x, window.innerWidth - 220),
    top: Math.min(y, window.innerHeight - items.length * 32 - 20),
    zIndex: 9999,
    minWidth: 200,
    background: 'var(--white)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '4px 0',
    boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
  }

  return createPortal(
    <div ref={ref} style={style}>
      {items.map((item, i) => (
        <div key={i}>
          {item.separator && i > 0 && (
            <div style={{ height: 1, background: 'var(--border)', margin: '4px 8px' }} />
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); item.action(); onClose() }}
            className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-[6px] text-left transition-colors"
            style={{
              color: item.danger ? 'var(--red)' : 'var(--text)',
              background: 'transparent',
              border: 'none',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--item-hover)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            {item.icon && <span className="flex w-4 shrink-0 items-center justify-center" style={{ color: item.danger ? 'var(--red)' : 'var(--muted)' }}>{item.icon}</span>}
            {item.label}
          </button>
        </div>
      ))}
    </div>,
    document.body
  )
}

/* ── SVG mini icons for menu ── */
const PlusIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
const FolderPlusIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
const PlayIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
const CopyIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
const ExportIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
const PencilIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
const TrashIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
const DotsIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>

export default function TreeNodeComponent({
  node,
  depth = 0,
  activeId,
  onSelect,
  onToggle,
  onDelete,
  onRename,
  onAddRequest,
  onAddFolder,
  onDuplicate,
  onRunFolder,
  onExport,
  openIds,
  isFlat = false,
}: TreeNodeProps) {
  const isOpen = openIds.has(node.id)
  const hasChildren = node.children && node.children.length > 0
  const isRequest = !!node.method
  const isActive = activeId === node.id
  const indent = depth * 14
  const [hovered, setHovered] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  // Inline rename
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  const canModify = node.type === 'folder' || node.type === 'endpoint' || node.type === 'request'
  const isFolder = node.type === 'folder' || node.type === 'module'
  const isTopLevel = depth <= 1

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

  const openContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const startRename = useCallback(() => {
    setRenameValue(node.label)
    setRenaming(true)
  }, [node.label])

  const confirmRename = useCallback(() => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== node.label && onRename) {
      onRename(node, trimmed)
    }
    setRenaming(false)
  }, [renameValue, node, onRename])

  /* Build context menu items based on node type */
  function getMenuItems(): MenuItemDef[] {
    const items: MenuItemDef[] = []

    if (isFolder || node.type === 'module') {
      // Folder / collection — top-level actions
      if (onAddRequest) {
        items.push({ label: 'Add Request', icon: PlusIcon, action: () => onAddRequest(node) })
      }
      if (onAddFolder) {
        items.push({ label: 'Add Folder', icon: FolderPlusIcon, action: () => onAddFolder(node) })
      }
      if (onRunFolder) {
        items.push({ label: 'Run', icon: PlayIcon, separator: true, action: () => onRunFolder(node) })
      }
      if (onDuplicate) {
        items.push({ label: 'Duplicate', icon: CopyIcon, separator: !isTopLevel, action: () => onDuplicate(node) })
      }
      if (onExport && isTopLevel) {
        items.push({ label: 'Export', icon: ExportIcon, action: () => onExport(node) })
      }
      if (onRename && canModify) {
        items.push({ label: 'Rename', icon: PencilIcon, separator: true, action: startRename })
      }
      if (onDelete && canModify) {
        items.push({ label: 'Delete', icon: TrashIcon, danger: true, action: () => onDelete(node) })
      }
    } else {
      // Endpoint / request — sub-item actions
      if (onDuplicate) {
        items.push({ label: 'Duplicate', icon: CopyIcon, action: () => onDuplicate(node) })
      }
      if (onRename && canModify) {
        items.push({ label: 'Rename', icon: PencilIcon, action: startRename })
      }
      if (onDelete && canModify) {
        items.push({ label: 'Delete', icon: TrashIcon, danger: true, separator: true, action: () => onDelete(node) })
      }
    }

    return items
  }

  const showActions = !renaming && hovered && (canModify || isFolder || node.type === 'module')

  return (
    <div>
      <div
        onClick={handleClick}
        onContextMenu={canModify || isFolder || node.type === 'module' ? openContextMenu : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="flex cursor-pointer select-none items-center gap-[5px] rounded-md transition-colors"
        style={{
          padding: `4px 10px 4px ${10 + indent}px`,
          background: isActive ? 'var(--accent-light)' : hovered ? 'var(--item-hover)' : 'transparent',
          color: isActive ? 'var(--accent-text)' : node.italic ? 'var(--hint)' : 'var(--sub)',
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
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); confirmRename() }
              else if (e.key === 'Escape') { e.preventDefault(); setRenaming(false) }
            }}
            onBlur={confirmRename}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 rounded border px-1.5 py-0.5 outline-none"
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

        {/* ··· button on hover */}
        {showActions && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); openContextMenu(e) }}
            className="shrink-0 rounded p-0.5"
            style={{ background: 'transparent', border: 'none', color: 'var(--hint)', cursor: 'pointer', lineHeight: 1 }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--accent)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--hint)' }}
          >
            {DotsIcon}
          </button>
        )}

        {/* Count badge */}
        {node.count != null && !showActions && (
          <span
            className="ml-1 shrink-0 rounded-full px-[5px]"
            style={{ background: node.countBg || '#f0f0f5', color: node.countColor || '#888' }}
          >
            {node.count}
          </span>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          items={getMenuItems()}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Children — only rendered in non-flat mode */}
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
          onAddRequest={onAddRequest}
          onAddFolder={onAddFolder}
          onDuplicate={onDuplicate}
          onRunFolder={onRunFolder}
          onExport={onExport}
          openIds={openIds}
        />
      ))}
    </div>
  )
}
