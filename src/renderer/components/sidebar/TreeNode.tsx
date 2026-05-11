import { useCallback, useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { TreeNode as TreeNodeType, Protocol } from '../../types'
import MethodBadge from '../shared/MethodBadge'
import { useTranslation } from '../../lib/i18n'
import {
  FileText,
  Box,
  Briefcase,
  MoreHorizontal,
  Zap,
  Globe,
  Radio,
  Activity,
  Cpu,
  Bot,
  FileCode2,
  Hexagon,
  Cloud,
} from 'lucide-react'

export interface DragPayload {
  id: string
  nodeType: 'folder' | 'endpoint' | 'request'
}

export type DropPosition = 'inside' | 'before' | 'after'

interface TreeNodeProps {
  node: TreeNodeType
  depth?: number
  activeId: string | null
  onSelect: (node: TreeNodeType) => void
  onToggle: (id: string) => void
  onDelete?: (node: TreeNodeType) => void
  onRename?: (node: TreeNodeType, newName: string) => void
  onAddRequest?: (parentNode: TreeNodeType, protocol?: Protocol) => void
  onAddFolder?: (parentNode: TreeNodeType) => void
  onDuplicate?: (node: TreeNodeType) => void
  onRunFolder?: (node: TreeNodeType) => void
  onExport?: (node: TreeNodeType) => void
  onImport?: (node: TreeNodeType) => void
  onCreateTestSuite?: (node: TreeNodeType) => void
  onCreateMockServer?: (node: TreeNodeType) => void
  onDrop?: (target: TreeNodeType, payload: DragPayload, position: DropPosition) => void
  openIds: Set<string>
  isFlat?: boolean
}

function NodeIcon({ icon }: { icon?: string }) {
  if (!icon) return null
  const iconMap: Record<string, React.ReactNode> = {
    module: <MoreHorizontal size={13} style={{ color: 'var(--hint)' }} />,
    collection: (
      <div
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded"
        style={{ background: 'var(--accent)' }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="white">
          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <polyline points="13 2 13 9 20 9" fill="none" stroke="white" strokeWidth="2" />
        </svg>
      </div>
    ),
    endpoints: (
      <div
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded"
        style={{ background: 'var(--accent)' }}
      >
        <FileText size={10} className="text-white" />
      </div>
    ),
    schemas: (
      <div
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded"
        style={{ background: 'var(--tree-schemas, #4caf82)' }}
      >
        <Box size={10} className="text-white" />
      </div>
    ),
    components: (
      <div
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded"
        style={{ background: 'var(--tree-components, #e88c3a)' }}
      >
        <Briefcase size={10} className="text-white" />
      </div>
    ),
    folder: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--tree-folder)"
        strokeWidth="1.8"
      >
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
    calc: (
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--hint)"
        strokeWidth="2"
      >
        <rect x="4" y="2" width="16" height="20" rx="2" />
        <line x1="8" y1="6" x2="16" y2="6" />
        <line x1="8" y1="10" x2="16" y2="10" />
        <line x1="8" y1="14" x2="12" y2="14" />
      </svg>
    ),
    quick: <Zap size={13} style={{ color: 'var(--hint)' }} />,
  }
  return <>{iconMap[icon] || null}</>
}

/* ── Context menu item ── */
interface MenuItemDef {
  label: string
  icon?: React.ReactNode
  iconBg?: string
  iconColor?: string
  danger?: boolean
  separator?: boolean
  action?: () => void
  submenu?: MenuItemDef[]
}

const ChevronRightMini = (
  <svg
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

function ContextMenu({
  items,
  x,
  y,
  onClose,
}: {
  items: MenuItemDef[]
  x: number
  y: number
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [openSubmenuIdx, setOpenSubmenuIdx] = useState<number | null>(null)
  const [submenuAnchor, setSubmenuAnchor] = useState<{ x: number; y: number } | null>(null)

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

  const openSubmenu = (idx: number) => {
    const btn = itemRefs.current[idx]
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    setOpenSubmenuIdx(idx)
    setSubmenuAnchor({ x: rect.right - 4, y: rect.top - 4 })
  }

  return createPortal(
    <>
      <div ref={ref} style={style}>
        {items.map((item, i) => {
          const hasSubmenu = !!(item.submenu && item.submenu.length > 0)
          return (
            <div key={i}>
              {item.separator && i > 0 && (
                <div style={{ height: 1, background: 'var(--border)', margin: '4px 8px' }} />
              )}
              <button
                type="button"
                ref={(el) => {
                  itemRefs.current[i] = el
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  if (hasSubmenu) {
                    openSubmenu(i)
                  } else if (item.action) {
                    item.action()
                    onClose()
                  }
                }}
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLElement).style.background = 'var(--item-hover)'
                  if (hasSubmenu) openSubmenu(i)
                  else if (openSubmenuIdx !== null) setOpenSubmenuIdx(null)
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                }}
                className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-[6px] text-left transition-colors"
                style={{
                  color: item.danger ? 'var(--red)' : 'var(--text)',
                  background: 'transparent',
                  border: 'none',
                }}
              >
                {item.icon && (
                  <span
                    className="flex w-4 shrink-0 items-center justify-center"
                    style={{
                      color: item.iconColor || (item.danger ? 'var(--red)' : 'var(--muted)'),
                      background: item.iconBg,
                      borderRadius: item.iconBg ? 4 : undefined,
                      height: item.iconBg ? 18 : undefined,
                      width: item.iconBg ? 18 : undefined,
                    }}
                  >
                    {item.icon}
                  </span>
                )}
                <span style={{ flex: 1 }}>{item.label}</span>
                {hasSubmenu && (
                  <span style={{ color: 'var(--hint)', display: 'flex' }}>{ChevronRightMini}</span>
                )}
              </button>
            </div>
          )
        })}
      </div>
      {openSubmenuIdx !== null && submenuAnchor && items[openSubmenuIdx]?.submenu && (
        <ContextMenu
          items={items[openSubmenuIdx]!.submenu!}
          x={submenuAnchor.x}
          y={submenuAnchor.y}
          onClose={onClose}
        />
      )}
    </>,
    document.body,
  )
}

/* ── SVG mini icons for menu ── */
const PlusIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)
const FolderPlusIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    <line x1="12" y1="11" x2="12" y2="17" />
    <line x1="9" y1="14" x2="15" y2="14" />
  </svg>
)
const PlayIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
)
const CopyIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
)
const ExportIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
)
const ImportIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)
const PencilIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
)
const TrashIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
)
const DotsIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="1.5" />
    <circle cx="12" cy="12" r="1.5" />
    <circle cx="12" cy="19" r="1.5" />
  </svg>
)
const TestSuiteIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="9 11 12 14 22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
)
const MockServerIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
)

/**
 * Protocols offered by the folder right-click → Add Request submenu. Mirrors
 * the global "+ New" dropdown so users get the same 9 choices wherever they
 * create a request (UX 4).
 */
const PROTOCOL_OPTIONS: Array<{
  key: Protocol
  labelKey: string
  defaultMethod?: string
  icon: React.ReactNode
  iconColor: string
  iconBg: string
}> = [
  {
    key: 'http',
    labelKey: 'newDropdown.httpEndpoint',
    defaultMethod: 'GET',
    icon: <Globe size={12} strokeWidth={2} />,
    iconColor: '#1976D2',
    iconBg: '#E3F2FD',
  },
  {
    key: 'soap',
    labelKey: 'newDropdown.soapMethod',
    icon: <FileCode2 size={12} strokeWidth={2} />,
    iconColor: '#E65100',
    iconBg: '#FFF3E0',
  },
  {
    key: 'websocket',
    labelKey: 'newDropdown.websocket',
    icon: <Radio size={12} strokeWidth={2} />,
    iconColor: '#00838F',
    iconBg: '#E0F7FA',
  },
  {
    key: 'graphql',
    labelKey: 'newDropdown.graphql',
    icon: <Cpu size={12} strokeWidth={2} />,
    iconColor: '#6A1B9A',
    iconBg: '#F3E5F5',
  },
  {
    key: 'ai',
    labelKey: 'newDropdown.aiSse',
    icon: <Bot size={12} strokeWidth={2} />,
    iconColor: '#5E35B1',
    iconBg: '#EDE7F6',
  },
  {
    key: 'grpc',
    labelKey: 'newDropdown.grpc',
    defaultMethod: 'POST',
    icon: <Hexagon size={12} strokeWidth={2} />,
    iconColor: '#2E7D32',
    iconBg: '#E8F5E9',
  },
  {
    key: 'sse',
    labelKey: 'newDropdown.sse',
    icon: <Activity size={12} strokeWidth={2} />,
    iconColor: '#0277BD',
    iconBg: '#E1F5FE',
  },
  {
    key: 'mcp',
    labelKey: 'newDropdown.mcp',
    icon: <Cloud size={12} strokeWidth={2} />,
    iconColor: '#0277BD',
    iconBg: '#E1F5FE',
  },
  {
    key: 'socketio',
    labelKey: 'newDropdown.socketio',
    icon: <Zap size={12} strokeWidth={2} />,
    iconColor: '#E65100',
    iconBg: '#FFF3E0',
  },
]

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
  onImport,
  onCreateTestSuite,
  onCreateMockServer,
  onDrop,
  openIds,
  isFlat = false,
}: TreeNodeProps) {
  const { t } = useTranslation()
  const isOpen = openIds.has(node.id)
  const hasChildren = node.children && node.children.length > 0
  const isRequest = !!node.method
  const isActive = activeId === node.id
  const indent = depth * 14
  const [hovered, setHovered] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [dropPos, setDropPos] = useState<DropPosition | null>(null)

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
        items.push({
          label: t('tree.addRequest'),
          icon: PlusIcon,
          submenu: PROTOCOL_OPTIONS.map((p) => ({
            label: t(p.labelKey),
            icon: p.icon,
            iconColor: p.iconColor,
            iconBg: p.iconBg,
            action: () => onAddRequest(node, p.key),
          })),
        })
      }
      if (onAddFolder) {
        items.push({
          label: t('tree.addFolder'),
          icon: FolderPlusIcon,
          action: () => onAddFolder(node),
        })
      }
      if (onRunFolder) {
        items.push({
          label: t('tree.run'),
          icon: PlayIcon,
          separator: true,
          action: () => onRunFolder(node),
        })
      }
      // UX 6: One-click "convert this folder to a test suite / mock server" —
      // surfaces the recursive endpoint collector + suite/mock-server creation
      // flows that previously required manual setup.
      if (onCreateTestSuite && isFolder) {
        items.push({
          label: t('tree.createTestSuite'),
          icon: TestSuiteIcon,
          separator: true,
          action: () => onCreateTestSuite(node),
        })
      }
      if (onCreateMockServer && isFolder) {
        items.push({
          label: t('tree.createMockServer'),
          icon: MockServerIcon,
          action: () => onCreateMockServer(node),
        })
      }
      if (onDuplicate) {
        items.push({
          label: t('tree.duplicate'),
          icon: CopyIcon,
          separator: true,
          action: () => onDuplicate(node),
        })
      }
      if (onExport && isTopLevel) {
        items.push({ label: t('tree.export'), icon: ExportIcon, action: () => onExport(node) })
      }
      if (onImport) {
        items.push({
          label: t('tree.importFolder'),
          icon: ImportIcon,
          action: () => onImport(node),
        })
      }
      if (onRename && canModify) {
        items.push({
          label: t('tree.rename'),
          icon: PencilIcon,
          separator: true,
          action: startRename,
        })
      }
      if (onDelete && canModify) {
        items.push({
          label: t('tree.delete'),
          icon: TrashIcon,
          danger: true,
          action: () => onDelete(node),
        })
      }
    } else {
      // Endpoint / request — sub-item actions
      if (onDuplicate) {
        items.push({ label: t('tree.duplicate'), icon: CopyIcon, action: () => onDuplicate(node) })
      }
      if (onRename && canModify) {
        items.push({ label: t('tree.rename'), icon: PencilIcon, action: startRename })
      }
      if (onDelete && canModify) {
        items.push({
          label: t('tree.delete'),
          icon: TrashIcon,
          danger: true,
          separator: true,
          action: () => onDelete(node),
        })
      }
    }

    return items
  }

  const showActions = !renaming && hovered && (canModify || isFolder || node.type === 'module')

  // Drag-drop wiring (UX 5). Only request/endpoint/folder nodes are draggable;
  // the project root and synthetic groups (schemas, components) are skipped.
  const draggable = canModify && !renaming
  const dropTargetType: 'folder' | 'endpoint' | 'request' | null = isFolder
    ? 'folder'
    : node.type === 'endpoint'
      ? 'endpoint'
      : node.type === 'request'
        ? 'request'
        : null

  const handleDragStart = (e: React.DragEvent) => {
    if (!draggable) return
    const payload: DragPayload = {
      id: node.id,
      nodeType: isFolder ? 'folder' : node.type === 'endpoint' ? 'endpoint' : 'request',
    }
    e.dataTransfer.setData('application/testnizer-tree-node', JSON.stringify(payload))
    e.dataTransfer.effectAllowed = 'move'
    e.stopPropagation()
  }

  const handleDragOver = (e: React.DragEvent) => {
    if (!onDrop || !dropTargetType) return
    const hasPayload = e.dataTransfer.types.includes('application/testnizer-tree-node')
    if (!hasPayload) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const h = rect.height
    // Top quarter = before, bottom quarter = after, middle = inside (folders
    // only — for requests the middle also maps to "after" since they can't
    // own children).
    let pos: DropPosition
    if (dropTargetType === 'folder') {
      if (y < h * 0.25) pos = 'before'
      else if (y > h * 0.75) pos = 'after'
      else pos = 'inside'
    } else {
      pos = y < h * 0.5 ? 'before' : 'after'
    }
    if (dropPos !== pos) setDropPos(pos)
  }

  const handleDragLeave = () => {
    if (dropPos !== null) setDropPos(null)
  }

  const handleDropOnNode = (e: React.DragEvent) => {
    if (!onDrop) return
    const raw = e.dataTransfer.getData('application/testnizer-tree-node')
    if (!raw) return
    e.preventDefault()
    e.stopPropagation()
    try {
      const payload = JSON.parse(raw) as DragPayload
      if (payload.id === node.id) {
        setDropPos(null)
        return
      }
      const pos = dropPos ?? 'inside'
      onDrop(node, payload, pos)
    } catch {
      /* ignore malformed payload */
    } finally {
      setDropPos(null)
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      {/* Drop indicators — drawn relative to this row */}
      {dropPos === 'before' && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 8 + indent,
            right: 8,
            height: 2,
            background: 'var(--accent)',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        />
      )}
      {dropPos === 'after' && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 8 + indent,
            right: 8,
            height: 2,
            background: 'var(--accent)',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        />
      )}
      <div
        draggable={draggable}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDropOnNode}
        onClick={handleClick}
        onContextMenu={
          canModify || isFolder || node.type === 'module' ? openContextMenu : undefined
        }
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="flex cursor-pointer select-none items-center gap-[5px] rounded-md transition-colors"
        style={{
          padding: `4px 10px 4px ${10 + indent}px`,
          background:
            dropPos === 'inside'
              ? 'var(--accent-light)'
              : isActive
                ? 'var(--accent-light)'
                : hovered
                  ? 'var(--item-hover)'
                  : 'transparent',
          outline: dropPos === 'inside' ? '1.5px solid var(--accent)' : undefined,
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
              if (e.key === 'Enter') {
                e.preventDefault()
                confirmRename()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setRenaming(false)
              }
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
          <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
            {node.label}
          </span>
        )}

        {/* ··· button on hover */}
        {showActions && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              openContextMenu(e)
            }}
            className="shrink-0 rounded p-0.5"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--hint)',
              cursor: 'pointer',
              lineHeight: 1,
            }}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLElement).style.color = 'var(--accent)'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLElement).style.color = 'var(--hint)'
            }}
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
      {!isFlat &&
        hasChildren &&
        isOpen &&
        node.children!.map((child) => (
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
            onImport={onImport}
            onCreateTestSuite={onCreateTestSuite}
            onCreateMockServer={onCreateMockServer}
            onDrop={onDrop}
            openIds={openIds}
          />
        ))}
    </div>
  )
}
