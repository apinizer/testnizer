import { useRef, useMemo, useCallback, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useBranchStore } from '../../stores/branch.store'
import { useRequestStore } from '../../stores/request.store'
import { useResponseStore } from '../../stores/response.store'
import { useTabsStore } from '../../stores/tabs.store'
import { useSoapStore } from '../../stores/soap.store'
import type {
  TreeNode as TreeNodeType,
  HttpMethod,
  Protocol,
  KeyValuePair,
  RequestBody,
  AuthConfig,
  TestAssertion,
} from '../../types'
import TreeNodeComponent, { type DragPayload, type DropPosition } from './TreeNode'
import DeleteConfirmDialog from '../modals/DeleteConfirmDialog'
import { toast } from '../../lib/toast'
import { t } from '../../lib/i18n'

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
function flattenTree(nodes: TreeNode[], openIds: Set<string>, depth: number = 0): FlatNode[] {
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

/**
 * Flatten with every folder expanded — used while searching so all surviving
 * matches are visible regardless of the user's collapse state.
 */
function flattenAll(nodes: TreeNode[], depth: number = 0): FlatNode[] {
  const result: FlatNode[] = []
  for (const node of nodes) {
    result.push({ node, depth })
    if (node.children && node.children.length > 0) {
      result.push(...flattenAll(node.children, depth + 1))
    }
  }
  return result
}

/**
 * Keep a node when its label/path matches (case-insensitive) or any descendant
 * matches, preserving the path to each match. Powers the APIs search box
 * (issue #4) — typing previously updated state but never filtered the tree.
 */
function filterTree(nodes: TreeNode[], q: string): TreeNode[] {
  const out: TreeNode[] = []
  for (const node of nodes) {
    const selfMatch =
      node.label.toLowerCase().includes(q) || (node.path?.toLowerCase().includes(q) ?? false)
    const children = node.children ? filterTree(node.children, q) : []
    if (selfMatch || children.length > 0) {
      // A self-matching folder keeps its full subtree; a folder kept only
      // because a descendant matched shows just the matching branch.
      out.push({
        ...node,
        children: children.length > 0 ? children : selfMatch ? node.children : [],
      })
    }
  }
  return out
}

export default function TreeView() {
  const treeData = useWorkspaceStore((s) => s.treeData)
  const openNodeIds = useWorkspaceStore((s) => s.openNodeIds)
  const searchQuery = useWorkspaceStore((s) => s.searchQuery)
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

  const flatNodes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return flattenTree(treeData, openNodeIds)
    // When searching, filter the tree and show every surviving match expanded.
    return flattenAll(filterTree(treeData, q))
  }, [treeData, openNodeIds, searchQuery])

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
          const result = (await window.api?.savedRequest?.get(node.id)) as {
            success: boolean
            data?: {
              id: string
              name: string
              method: string
              url: string
              protocol: string
              params?: string
              headers?: string
              body?: string
              auth?: string
              pre_script?: string
              post_script?: string
              assertions?: string
            }
          }
          if (result?.success && result.data) {
            const sr = result.data
            const parsedParams: KeyValuePair[] = sr.params ? JSON.parse(sr.params) : []
            const parsedHeaders: KeyValuePair[] = sr.headers ? JSON.parse(sr.headers) : []
            const parsedBody: RequestBody = sr.body ? JSON.parse(sr.body) : { type: 'none' }
            const parsedAuth: AuthConfig = sr.auth ? JSON.parse(sr.auth) : { type: 'none' }
            // Saved requests carry preScript/postScript/assertions in dedicated columns.
            const parsedAsserts = sr.assertions ? JSON.parse(sr.assertions) : []

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
              preScript: sr.pre_script ?? '',
              postScript: sr.post_script ?? '',
              assertions: parsedAsserts,
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
          const result = (await window.api?.endpoint?.get(node.id)) as {
            success: boolean
            data?: {
              id: string
              name: string
              method: string
              path: string
              protocol: string
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
            let preScript = ''
            let postScript = ''
            let endpointAssertions: TestAssertion[] = []
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
                preScript = schema.preScript ?? ''
                postScript = schema.postScript ?? ''
                endpointAssertions = schema.assertions ?? []
                soapMeta = schema.soap
                if (schema.url) schemaUrl = schema.url
                if (schema.method) schemaMethod = schema.method
              } catch {
                /* ignore */
              }
            }

            const effectiveProtocol =
              protocol === 'soap' && soapMeta ? ('http' as Protocol) : protocol

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
                preScript,
                postScript,
                assertions: endpointAssertions,
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
    [
      setActiveNode,
      loadFromEndpoint,
      openPreviewTab,
      switchToTab,
      clearResponse,
      loadSoapFromEndpoint,
      switchSoapToTab,
    ],
  )

  // Delete confirmation dialog state
  const [deleteTarget, setDeleteTarget] = useState<TreeNode | null>(null)

  const handleDeleteRequest = useCallback((node: TreeNode) => {
    setDeleteTarget(node)
  }, [])

  const handleDeleteConfirm = useCallback(async () => {
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
    } catch {
      /* ignore */
    }
    setDeleteTarget(null)
  }, [deleteTarget, refreshTree])

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
      } catch {
        /* ignore */
      }
    },
    [refreshTree],
  )

  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const handleAddRequest = useCallback(
    async (parentNode: TreeNode, protocol: Protocol = 'http') => {
      if (!activeProjectId) return
      try {
        const folderId = parentNode.type === 'folder' ? parentNode.id : null
        // Default name + method follow the same conventions as the global
        // "+ New" dropdown (UX 4 — same operation, same defaults everywhere).
        const defaultsByProtocol: Partial<Record<Protocol, { name: string; method: string }>> = {
          http: { name: 'New Request', method: 'GET' },
          soap: { name: 'New SOAP Method', method: 'POST' },
          websocket: { name: 'New WebSocket', method: 'GET' },
          graphql: { name: 'New GraphQL', method: 'POST' },
          grpc: { name: 'New gRPC', method: 'POST' },
          sse: { name: 'New SSE', method: 'GET' },
          ai: { name: 'New AI Chat', method: 'POST' },
          mcp: { name: 'New MCP', method: 'GET' },
          socketio: { name: 'New Socket.IO', method: 'GET' },
        }
        const d = defaultsByProtocol[protocol] ?? defaultsByProtocol.http!
        const result = (await window.api?.savedRequest?.create({
          project_id: activeProjectId,
          folder_id: folderId,
          name: d.name,
          method: d.method,
          url: '',
          protocol,
          // Stamp the active branch so content created on a non-default branch
          // is isolated to it (#8). null on the default branch = shared.
          branch_id: useBranchStore.getState().getActiveBranchScope(),
        })) as { success: boolean; error?: string } | undefined
        // Previously this `await` was followed by a hard `refreshTree()` with
        // no inspection of the IPC result — a non-existent SQL constraint or
        // a missing IPC binding silently swallowed the request and the user
        // saw nothing happen ("right-click → Add Request → protocol → no
        // effect", v1.4.4 §12.1). Surface the failure both to the console
        // (for support diagnostics) and the user (so they don't keep
        // clicking expecting a result).
        if (!result?.success) {
          const reason = result?.error || 'no response'
          console.error('savedRequest.create failed:', reason)
          toast.error(`Failed to create request: ${reason}`)
          return
        }
        await refreshTree()
        // Auto-expand the parent folder so the freshly-added request is
        // visible immediately. Without this, the request was inserted with
        // the right folder_id but the user saw nothing change when their
        // folder was collapsed (v1.4.2 T-12.1).
        if (folderId) {
          const store = useWorkspaceStore.getState()
          if (!store.openNodeIds.has(folderId)) store.toggleNode(folderId)
        }
      } catch (err) {
        console.error('Add Request from context menu failed:', err)
        toast.error(`Failed to create request: ${(err as Error).message || 'unknown error'}`)
      }
    },
    [activeProjectId, refreshTree],
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
          // Branch-stamp so a folder added on a non-default branch stays on it
          // (#8 — the exact reported repro).
          branch_id: useBranchStore.getState().getActiveBranchScope(),
        })
        await refreshTree()
      } catch {
        /* ignore */
      }
    },
    [activeProjectId, refreshTree],
  )

  const handleDuplicate = useCallback(
    async (node: TreeNode) => {
      try {
        if (node.type === 'request') {
          const result = (await window.api?.savedRequest?.get(node.id)) as {
            success: boolean
            data?: Record<string, unknown>
          }
          if (result?.success && result.data) {
            const sr = result.data as Record<string, unknown> & { name: string; url: string }
            await window.api?.savedRequest?.create({
              ...sr,
              name: `${sr.name} (copy)`,
            } as Parameters<typeof window.api.savedRequest.create>[0])
          }
        } else if (node.type === 'endpoint') {
          const result = (await window.api?.endpoint?.get(node.id)) as {
            success: boolean
            data?: Record<string, unknown>
          }
          if (result?.success && result.data) {
            const ep = result.data as Record<string, unknown> & {
              name: string
              project_id: string
              path: string
            }
            await window.api?.endpoint?.create({
              ...ep,
              name: `${ep.name} (copy)`,
            } as Parameters<typeof window.api.endpoint.create>[0])
          }
        } else if (node.type === 'folder') {
          // Server-side deep clone — single transaction inside
          // project.handler.ts duplicateFolderDeep().
          const result = (await window.api?.folder?.duplicate(node.id)) as
            | { success: boolean; error?: string; data?: { newFolderId: string } }
            | undefined
          if (!result?.success) {
            toast.error(result?.error || 'Folder duplication failed')
            return
          }
          toast.success('Folder duplicated')
        } else if (node.type === 'module') {
          // Module-level (project root) duplication is handled by the
          // project hub menu (B3), not the tree node.
          toast.error('Use the project Duplicate action from the Project Hub.')
          return
        }
        await refreshTree()
      } catch {
        /* ignore */
      }
    },
    [refreshTree],
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
    [openTab],
  )

  const handleExport = useCallback(
    async (node: TreeNode) => {
      try {
        if (node.type === 'module') {
          // Project-root → full project export (kind: 'project') instead of
          // routing through exportFolder, which would look up a folders row
          // with id "project-<uuid>" and return a stub. v1.3.1 B22.
          if (!activeProjectId) return
          const result = (await window.api?.save?.exportProject?.(activeProjectId)) as {
            success: boolean
            error?: string
          }
          if (result?.success) {
            toast.success(t('toast.exported'))
          } else if (result?.error && result.error !== 'Cancelled') {
            console.error('Export project failed:', result.error)
            toast.error(`${t('toast.exportFailed')}: ${result.error}`)
          }
          return
        }
        if (node.type !== 'folder') return
        const result = (await window.api?.save?.exportFolder?.(node.id)) as {
          success: boolean
          error?: string
        }
        if (result?.success) {
          toast.success(t('toast.exported'))
        } else if (result?.error && result.error !== 'Cancelled') {
          console.error('Export folder failed:', result.error)
          toast.error(`${t('toast.exportFailed')}: ${result.error}`)
        }
      } catch (err) {
        console.error(err)
        toast.error(`${t('toast.exportFailed')}: ${(err as Error).message}`)
      }
    },
    [activeProjectId],
  )

  const handleImportFolder = useCallback(
    async (node: TreeNode) => {
      if (!activeProjectId) return
      try {
        const parentId = node.type === 'folder' ? node.id : null
        const result = (await window.api?.save?.importFolder?.({
          projectId: activeProjectId,
          parentFolderId: parentId,
        })) as { success: boolean; error?: string }
        if (result?.success) {
          await refreshTree()
        } else if (result?.error && result.error !== 'Cancelled') {
          console.error('Import folder failed:', result.error)
        }
      } catch (err) {
        console.error(err)
      }
    },
    [activeProjectId, refreshTree],
  )

  /**
   * Recursively gather every request/endpoint id under a folder, including
   * descendants in nested sub-folders. Operates on the in-memory tree so we
   * don't need a new IPC for "list endpoints recursively" (UX 6).
   */
  const collectRequestIdsRecursive = useCallback((folderNode: TreeNode): string[] => {
    const ids: string[] = []
    function walk(n: TreeNode): void {
      if (n.type === 'endpoint' || n.type === 'request') ids.push(n.id)
      if (n.children) for (const c of n.children) walk(c)
    }
    walk(folderNode)
    return ids
  }, [])

  const setActiveSidebarPage = (() => {
    // Late-import via dynamic require so we don't pull the store at module top
    // and break tree-shaking; lazily resolved when the user actually clicks.
    return (page: string) => {
      void import('../../stores/ui.store').then((m) =>
        m.useUIStore.getState().setActiveSidebarPage(page as never),
      )
    }
  })()

  const handleCreateTestSuite = useCallback(
    async (folderNode: TreeNode) => {
      if (!activeProjectId) return
      const ids = collectRequestIdsRecursive(folderNode)
      if (ids.length === 0) return
      try {
        const createRes = (await window.api?.testSuite?.create({
          project_id: activeProjectId,
          name: folderNode.label,
        })) as { success: boolean; data?: { id: string } }
        if (!createRes?.success || !createRes.data) return
        await window.api?.testSuite?.importEndpoints({
          suite_id: createRes.data.id,
          endpoint_ids: ids,
        })
        // Hand the user off to the Tests workbench so they can see the result.
        setActiveSidebarPage('tests')
      } catch (err) {
        console.error('createTestSuite from folder failed:', err)
      }
    },
    [activeProjectId, collectRequestIdsRecursive],
  )

  /**
   * Resolve which parent folder + insertBeforeId to use given a drop target
   * and a position. Folders are the only nodes that can host children, so
   * "drop inside a request" doesn't happen — the request's parent folder
   * receives the moved node instead. Returns null if the operation would
   * be a no-op (e.g. dropping a node onto itself's children).
   */
  const findParentFolderId = useCallback(
    (targetId: string): string | null => {
      function walk(
        nodes: TreeNode[],
        parentId: string | null,
      ): { found: boolean; parent: string | null } {
        for (const n of nodes) {
          if (n.id === targetId) return { found: true, parent: parentId }
          if (n.children) {
            const r = walk(n.children, n.type === 'folder' ? n.id : parentId)
            if (r.found) return r
          }
        }
        return { found: false, parent: null }
      }
      return walk(treeData, null).parent
    },
    [treeData],
  )

  const handleDrop = useCallback(
    async (target: TreeNode, payload: DragPayload, position: DropPosition) => {
      // Determine target folder + insertBeforeId from the drop intent.
      let targetFolderId: string | null
      let insertBeforeId: string | null = null

      if (target.type === 'folder' && position === 'inside') {
        targetFolderId = target.id
        insertBeforeId = null // append at end
      } else if (target.type === 'module' && position === 'inside') {
        targetFolderId = null // project root
        insertBeforeId = null
      } else {
        // "before" / "after" — target becomes a sibling.
        targetFolderId = findParentFolderId(target.id)
        insertBeforeId = position === 'before' ? target.id : null
      }

      try {
        const r = await window.api?.tree?.move({
          nodeId: payload.id,
          nodeType: payload.nodeType,
          targetFolderId,
          insertBeforeId,
        })
        if (!r?.success) {
          console.error('tree:move failed:', r?.error)
          return
        }
        await refreshTree()
      } catch (err) {
        console.error('tree:move threw:', err)
      }
    },
    [findParentFolderId, refreshTree],
  )

  const handleCreateMockServer = useCallback(
    async (folderNode: TreeNode) => {
      if (!activeProjectId) return
      const ids = collectRequestIdsRecursive(folderNode)
      if (ids.length === 0) return
      try {
        // Pick the next free port above 8080 (project-scoped). Mock-server
        // ports are bound to 127.0.0.1 so we don't need a global registry.
        const listRes = await window.api?.mock?.server?.list(activeProjectId)
        const usedPorts = new Set((listRes?.data ?? []).map((s) => s.port))
        let port = 8080
        while (usedPorts.has(port) && port < 65535) port++

        const serverRes = await window.api?.mock?.server?.create({
          projectId: activeProjectId,
          name: folderNode.label,
          host: '127.0.0.1',
          port,
        })
        if (!serverRes?.success || !serverRes.data) return

        // Pull each endpoint's method+path, then mirror as mock endpoints.
        // We deliberately don't copy bodies — mock responses are configured
        // separately and this flow just scaffolds the URL surface.
        for (const id of ids) {
          // saved requests and imported endpoints both live in the tree,
          // walk both APIs to find them. Endpoint lookup is preferred since
          // imported endpoints carry richer metadata.
          let path = ''
          let method = 'GET'
          const ep = (await window.api?.endpoint?.get?.(id)) as {
            success: boolean
            data?: { path?: string; method?: string }
          }
          if (ep?.success && ep.data) {
            path = ep.data.path || ''
            method = ep.data.method || 'GET'
          } else {
            const sr = (await window.api?.savedRequest?.get?.(id)) as {
              success: boolean
              data?: { url?: string; method?: string }
            }
            if (sr?.success && sr.data) {
              // Strip protocol/host so the mock binds the path portion only.
              try {
                const u = new URL(sr.data.url || '', 'http://placeholder')
                path = u.pathname || sr.data.url || ''
              } catch {
                path = sr.data.url || ''
              }
              method = sr.data.method || 'GET'
            }
          }
          if (!path) continue
          await window.api?.mock?.endpoint?.create({
            serverId: serverRes.data.id,
            method,
            path,
          })
        }

        setActiveSidebarPage('mocks')
      } catch (err) {
        console.error('createMockServer from folder failed:', err)
      }
    },
    [activeProjectId, collectRequestIdsRecursive],
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
                onImport={handleImportFolder}
                onCreateTestSuite={handleCreateTestSuite}
                onCreateMockServer={handleCreateMockServer}
                onDrop={handleDrop}
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
