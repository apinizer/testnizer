import { useRef, useMemo, useCallback, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useRequestStore } from '../../stores/request.store'
import { useResponseStore } from '../../stores/response.store'
import { useTabsStore } from '../../stores/tabs.store'
import { useSoapStore } from '../../stores/soap.store'
import type { TreeNode as TreeNodeType, HttpMethod, Protocol, KeyValuePair, RequestBody, AuthConfig } from '../../types'
import TreeNodeComponent from './TreeNode'
import DeleteConfirmDialog from '../modals/DeleteConfirmDialog'

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
  const openPreviewTab = useTabsStore((s) => s.openPreviewTab)
  const switchToTab = useRequestStore((s) => s.switchToTab)
  const clearResponse = useResponseStore((s) => s.clearResponse)
  const refreshTree = useWorkspaceStore((s) => s.refreshTree)
  const loadSoapFromEndpoint = useSoapStore((s) => s.loadFromEndpoint)
  const switchSoapToTab = useSoapStore((s) => s.switchToTab)

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

  /** After openPreviewTab, get the actual active tab ID (might be a reused preview tab) */
  function getActiveTabId(): string {
    return useTabsStore.getState().activeTabId || ''
  }

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

            openPreviewTab({
              id: tabId,
              name: sr.name,
              protocol: (sr.protocol || 'http') as 'http',
              method: sr.method || 'GET',
              url: sr.url,
              savedRequestId: sr.id,
            })

            const realTabId = getActiveTabId()
            switchToTab(realTabId)
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
            const protocol = (ep.protocol || 'http') as Protocol
            let params: KeyValuePair[] = []
            let headers: KeyValuePair[] = []
            let body: RequestBody = { type: 'none' }
            let auth: AuthConfig = { type: 'none' }
            let soapMeta: Record<string, unknown> | undefined
            let schemaUrl = ep.path
            let schemaMethod = ep.method || 'GET'

            if (ep.request_schema) {
              try {
                const schema = JSON.parse(ep.request_schema)
                params = schema.params || []
                headers = schema.headers || []
                body = schema.body || { type: 'none' }
                auth = schema.auth || { type: 'none' }
                soapMeta = schema.soap
                if (schema.url) schemaUrl = schema.url
                if (schema.method) schemaMethod = schema.method
              } catch { /* ignore */ }
            }

            const effectiveProtocol = (protocol === 'soap' && soapMeta) ? 'http' as Protocol : protocol

            openPreviewTab({
              id: tabId,
              name: ep.name,
              protocol: effectiveProtocol,
              method: schemaMethod,
              url: schemaUrl,
              endpointId: ep.id,
            })

            const realTabId = getActiveTabId()
            switchToTab(realTabId)
            clearResponse()

            if (effectiveProtocol === 'soap') {
              switchSoapToTab(realTabId)
              loadSoapFromEndpoint({
                url: schemaUrl,
                body: body as { type: string; content?: string },
                headers: headers as Array<{ key: string; value: string; enabled: boolean }>,
                soap: undefined,
              })
            } else {
              loadFromEndpoint({
                method: schemaMethod as HttpMethod,
                url: schemaUrl,
                params,
                headers,
                body,
                auth,
              })
            }
            return
          }
        } catch {
          // fallback below
        }
      }

      // Fallback: open with basic info from tree node
      openPreviewTab({
        id: tabId,
        name: node.label,
        protocol: 'http',
        method: method,
        url: node.path || '',
      })
      const realTabId = getActiveTabId()
      switchToTab(realTabId)
      clearResponse()
      loadFromEndpoint({
        method,
        url: node.path || '',
      })
    },
    [setActiveNode, loadFromEndpoint, openPreviewTab, switchToTab, clearResponse, loadSoapFromEndpoint, switchSoapToTab]
  )

  // Delete confirmation dialog state
  const [deleteTarget, setDeleteTarget] = useState<TreeNode | null>(null)

  const handleDeleteRequest = useCallback(
    (node: TreeNode) => {
      setDeleteTarget(node)
    },
    []
  )

  const handleDeleteConfirm = useCallback(
    async () => {
      if (!deleteTarget) return
      try {
        if (deleteTarget.type === 'request') {
          await window.api?.savedRequest?.delete(deleteTarget.id)
        } else if (deleteTarget.type === 'endpoint') {
          await window.api?.endpoint?.delete(deleteTarget.id)
        } else if (deleteTarget.type === 'folder') {
          await window.api?.folder?.delete(deleteTarget.id)
        }
        await refreshTree()
      } catch { /* ignore */ }
      setDeleteTarget(null)
    },
    [deleteTarget, refreshTree]
  )

  const handleDeleteCancel = useCallback(() => {
    setDeleteTarget(null)
  }, [])

  const handleRename = useCallback(
    async (node: TreeNode, newName: string) => {
      try {
        if (node.type === 'folder') {
          await window.api?.folder?.update(node.id, { name: newName })
        } else if (node.type === 'endpoint') {
          await window.api?.endpoint?.update(node.id, { name: newName })
        } else if (node.type === 'request') {
          await window.api?.savedRequest?.update(node.id, { name: newName })
        }
        await refreshTree()
      } catch { /* ignore */ }
    },
    [refreshTree]
  )

  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const handleAddRequest = useCallback(
    async (parentNode: TreeNode) => {
      if (!activeProjectId) return
      try {
        const folderId = parentNode.type === 'folder' ? parentNode.id : null
        await window.api?.savedRequest?.create({
          project_id: activeProjectId,
          folder_id: folderId,
          name: 'New Request',
          method: 'GET',
          url: '',
          protocol: 'http',
        })
        await refreshTree()
      } catch { /* ignore */ }
    },
    [activeProjectId, refreshTree]
  )

  const handleAddFolder = useCallback(
    async (parentNode: TreeNode) => {
      if (!activeProjectId) return
      try {
        const parentFolderId = parentNode.type === 'folder' ? parentNode.id : null
        await window.api?.folder?.create({
          project_id: activeProjectId,
          parent_id: parentFolderId,
          name: 'New Folder',
        })
        await refreshTree()
      } catch { /* ignore */ }
    },
    [activeProjectId, refreshTree]
  )

  const handleDuplicate = useCallback(
    async (node: TreeNode) => {
      try {
        if (node.type === 'request') {
          const result = await window.api?.savedRequest?.get(node.id) as { success: boolean; data?: Record<string, unknown> }
          if (result?.success && result.data) {
            const sr = result.data
            await window.api?.savedRequest?.create({
              ...sr,
              name: `${sr.name} (copy)`,
            })
          }
        } else if (node.type === 'endpoint') {
          const result = await window.api?.endpoint?.get(node.id) as { success: boolean; data?: Record<string, unknown> }
          if (result?.success && result.data) {
            const ep = result.data
            await window.api?.endpoint?.create({
              ...ep,
              name: `${ep.name} (copy)`,
            })
          }
        }
        await refreshTree()
      } catch { /* ignore */ }
    },
    [refreshTree]
  )

  const openTab = useTabsStore((s) => s.openTab)

  const handleRunFolder = useCallback(
    (node: TreeNode) => {
      const tabId = 'runner-' + node.id
      openTab({
        id: tabId,
        name: 'Runner',
        protocol: 'runner',
        folderId: node.id,
      })
    },
    [openTab]
  )

  const handleExport = useCallback(
    async (node: TreeNode) => {
      try {
        await window.api?.save?.exportCollection?.({ folderId: node.id })
      } catch { /* ignore */ }
    },
    []
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
                onDelete={handleDeleteRequest}
                onRename={handleRename}
                onAddRequest={handleAddRequest}
                onAddFolder={handleAddFolder}
                onDuplicate={handleDuplicate}
                onRunFolder={handleRunFolder}
                onExport={handleExport}
                openIds={openNodeIds}
                isFlat
              />
            </div>
          )
        })}
      </div>

      {/* Delete confirmation dialog */}
      <DeleteConfirmDialog
        open={!!deleteTarget}
        itemName={deleteTarget?.label || ''}
        itemType={deleteTarget?.type || 'endpoint'}
        requireTyping={deleteTarget?.type === 'folder'}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
    </div>
  )
}
