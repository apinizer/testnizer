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
  openIds: Set<string>
  /** When true, children are not rendered (handled by virtualizer) */
  isFlat?: boolean
}

function NodeIcon({ icon }: { icon?: string }) {
  if (!icon) return null

  const iconMap: Record<string, React.ReactNode> = {
    module: <MoreHorizontal size={13} className="text-[var(--hint)]" />,
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
    folder: <Folder size={13} className="fill-[#888] text-[#888]" />,
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
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">{node.label}</span>

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
          openIds={openIds}
        />
      ))}
    </div>
  )
}
