import { useRef, useMemo, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useRequestStore } from '../../stores/request.store'
import type { TreeNode, HttpMethod } from '../../types'
import TreeNodeComponent from './TreeNode'

interface FlatNode {
  node: TreeNode
  depth: number
}

/**
 * Flatten tree into a list of visible nodes based on open/closed state.
 * Only expanded folder children are included.
 */
function flattenTree(
  nodes: TreeNode[],
  openIds: Set<string>,
  depth: number = 0
): FlatNode[] {
  const result: FlatNode[] = []
  for (const node of nodes) {
    result.push({ node, depth })
    if (node.children && node.children.length > 0 && openIds.has(node.id)) {
      const children = flattenTree(node.children, openIds, depth + 1)
      for (const child of children) {
        result.push(child)
      }
    }
  }
  return result
}

export default function TreeView() {
  const treeData = useWorkspaceStore((s) => s.treeData)
  const openNodeIds = useWorkspaceStore((s) => s.openNodeIds)
  const activeNodeId = useWorkspaceStore((s) => s.activeNodeId)
  const toggleNode = useWorkspaceStore((s) => s.toggleNode)
  const setActiveNode = useWorkspaceStore((s) => s.setActiveNode)
  const setMethod = useRequestStore((s) => s.setMethod)
  const setUrl = useRequestStore((s) => s.setUrl)

  const parentRef = useRef<HTMLDivElement>(null)

  const flatNodes = useMemo(
    () => flattenTree(treeData, openNodeIds),
    [treeData, openNodeIds]
  )

  const virtualizer = useVirtualizer({
    count: flatNodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 30,
    overscan: 10,
  })

  const handleSelect = useCallback(
    (node: TreeNode) => {
      setActiveNode(node.id)
      if (node.method) {
        setMethod(node.method as HttpMethod)
      }
      if (node.path) {
        setUrl(`https://api.example.com${node.path}`)
      }
    },
    [setActiveNode, setMethod, setUrl]
  )

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto px-1.5 py-2">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const { node, depth } = flatNodes[virtualRow.index]
          return (
            <div
              key={virtualRow.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <TreeNodeComponent
                node={node}
                depth={depth}
                activeId={activeNodeId}
                onSelect={handleSelect}
                onToggle={toggleNode}
                openIds={openNodeIds}
                isFlat
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
