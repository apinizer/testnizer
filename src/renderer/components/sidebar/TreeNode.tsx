import { useCallback, useState } from 'react'
import type { TreeNode as TreeNodeType } from '../../types'
import MethodBadge from '../shared/MethodBadge'
import {
  FileText,
  Box,
  Briefcase,
  Folder,
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
  openIds,
  isFlat = false,
}: TreeNodeProps) {
  const isOpen = openIds.has(node.id)
  const hasChildren = node.children && node.children.length > 0
  const isRequest = !!node.method
  const isActive = activeId === node.id
  const indent = depth * 14
  const [hovered, setHovered] = useState(false)

  const handleClick = useCallback(() => {
    if (hasChildren) onToggle(node.id)
    if (isRequest) onSelect(node)
  }, [hasChildren, isRequest, node, onToggle, onSelect])

  return (
    <div>
      <div
        onClick={handleClick}
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

        {/* Label */}
        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{node.label}</span>

        {/* Delete button — shown on hover for deletable items */}
        {hovered && onDelete && (node.type === 'request' || node.type === 'endpoint' || node.type === 'folder') && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(node) }}
            className="shrink-0 rounded p-0.5"
            style={{ background: 'transparent', border: 'none', color: 'var(--hint)', cursor: 'pointer', lineHeight: 1 }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--red)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--hint)' }}
            title="Sil"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
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
          openIds={openIds}
        />
      ))}
    </div>
  )
}
