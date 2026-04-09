import { useRef, useMemo, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useRequestStore } from '../../stores/request.store'
import { useResponseStore } from '../../stores/response.store'
import { useTabsStore } from '../../stores/tabs.store'
import type { TreeNode as TreeNodeType, HttpMethod, KeyValuePair, RequestBody, AuthConfig } from '../../types'
import TreeNodeComponent from './TreeNode'

// Re-alias for flattenTree signature
type TreeNode = TreeNodeType

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
  const loadFromEndpoint = useRequestStore((s) => s.loadFromEndpoint)
  const openTab = useTabsStore((s) => s.openTab)
  const switchToTab = useRequestStore((s) => s.switchToTab)
  const clearResponse = useResponseStore((s) => s.clearResponse)
  const refreshTree = useWorkspaceStore((s) => s.refreshTree)

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
    async (node: TreeNode) => {
      setActiveNode(node.id)

      // Only open tab for endpoints and saved requests
      if (node.type !== 'endpoint' && node.type !== 'request') return

      const tabId = `tab-${node.id}`
      const method = (node.method || 'GET') as HttpMethod

      if (node.type === 'request') {
        // Load full saved request data from DB
        try {
          const result = await window.api?.savedRequest?.get(node.id) as {
            success: boolean
            data?: {
              id: string; name: string; method: string; url: string; protocol: string
              params?: string; headers?: string; body?: string; auth?: string
              pre_script?: string; post_script?: string; assertions?: string
            }
          }
          if (result?.success && result.data) {
            const sr = result.data
            const parsedParams: KeyValuePair[] = sr.params ? JSON.parse(sr.params) : []
            const parsedHeaders: KeyValuePair[] = sr.headers ? JSON.parse(sr.headers) : []
            const parsedBody: RequestBody = sr.body ? JSON.parse(sr.body) : { type: 'none' }
            const parsedAuth: AuthConfig = sr.auth ? JSON.parse(sr.auth) : { type: 'none' }

            // Open tab
            openTab({
              id: tabId,
              name: sr.name,
              protocol: (sr.protocol || 'http') as 'http',
              method: sr.method || 'GET',
              url: sr.url,
              savedRequestId: sr.id,
            })

            // Switch and load data
            switchToTab(tabId)
            clearResponse()
            loadFromEndpoint({
              method: (sr.method || 'GET') as HttpMethod,
              url: sr.url,
              params: parsedParams,
              headers: parsedHeaders,
              body: parsedBody,
              auth: parsedAuth,
            })
            return
          }
        } catch {
          // fallback below
        }
      }

      if (node.type === 'endpoint') {
        // Load full endpoint data from DB
        try {
          const result = await window.api?.endpoint?.get(node.id) as {
            success: boolean
            data?: {
              id: string; name: string; method: string; path: string; protocol: string
              request_schema?: string
            }
          }
          if (result?.success && result.data) {
            const ep = result.data
            let params: KeyValuePair[] = []
            let headers: KeyValuePair[] = []
            let body: RequestBody = { type: 'none' }
            let auth: AuthConfig = { type: 'none' }

            if (ep.request_schema) {
              try {
                const schema = JSON.parse(ep.request_schema)
                params = schema.params || []
                headers = schema.headers || []
                body = schema.body || { type: 'none' }
                auth = schema.auth || { type: 'none' }
              } catch { /* ignore */ }
            }

            openTab({
              id: tabId,
              name: ep.name,
              protocol: (ep.protocol || 'http') as 'http',
              method: ep.method || 'GET',
              url: ep.path,
              endpointId: ep.id,
            })

            switchToTab(tabId)
            clearResponse()
            loadFromEndpoint({
              method: (ep.method || 'GET') as HttpMethod,
              url: ep.path,
              params,
              headers,
              body,
              auth,
            })
            return
          }
        } catch {
          // fallback below
        }
      }

      // Fallback: open with basic info from tree node
      openTab({
        id: tabId,
        name: node.label,
        protocol: 'http',
        method: method,
        url: node.path || '',
      })
      switchToTab(tabId)
      clearResponse()
      loadFromEndpoint({
        method,
        url: node.path || '',
      })
    },
    [setActiveNode, loadFromEndpoint, openTab, switchToTab, clearResponse]
  )

  const handleDelete = useCallback(
    async (node: TreeNode) => {
      try {
        if (node.type === 'request') {
          await window.api?.savedRequest?.delete(node.id)
        } else if (node.type === 'endpoint') {
          await window.api?.endpoint?.delete(node.id)
        } else if (node.type === 'folder') {
          await window.api?.folder?.delete(node.id)
        }
        await refreshTree()
      } catch { /* ignore */ }
    },
    [refreshTree]
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
                onDelete={handleDelete}
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
