import { useRef, useMemo, useCallback, useState, useEffect } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useWorkspaceStore, collectExpandableIds } from '../../stores/workspace.store'
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
import FolderSettingsModal from '../modals/FolderSettingsModal'
import CreateSuiteFromFolderModal from '../modals/CreateSuiteFromFolderModal'
import { collectRequestIds } from '../../lib/folder-request-selection'
import { toast } from '../../lib/toast'
import { t } from '../../lib/i18n'
import { openFolderRunner } from '../../lib/open-runner-tab'
import { openEndpointTab, focusOpenTabFor } from '../../lib/open-endpoint-tab'
import { restoreProtocolFromMetadata } from '../../lib/save-active-request'

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
 * Flatten while searching: every folder is expanded so all surviving matches
 * are visible, EXCEPT the ones the user collapsed during this filter session.
 * Previously this expanded unconditionally, which silently swallowed the
 * chevron click — `toggleNode` wrote to `openNodeIds`, a set this path never
 * read (issue #70). Ids of the folders actually expanded are collected into
 * `openOut` so the chevron arrow matches what is rendered.
 */
function flattenFiltered(
  nodes: TreeNode[],
  collapsedIds: Set<string>,
  openOut: Set<string>,
  depth: number = 0,
): FlatNode[] {
  const result: FlatNode[] = []
  for (const node of nodes) {
    result.push({ node, depth })
    if (node.children && node.children.length > 0 && !collapsedIds.has(node.id)) {
      openOut.add(node.id)
      result.push(...flattenFiltered(node.children, collapsedIds, openOut, depth + 1))
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
      // A self-matching folder keeps its full subtree (Postman/Insomnia/Bruno
      // behaviour); a folder kept only because a descendant matched shows just
      // the matching branch. The self-match check must win: preferring the
      // filtered children whenever ANY descendant also matched silently
      // dropped the folder's non-matching direct children — e.g. a request at
      // the root of a matching folder that also had matching sub-folders
      // (issue #107).
      out.push({
        ...node,
        children: selfMatch ? node.children : children,
      })
    }
  }
  return out
}

/** Row id of the not-yet-created folder placeholder (issue #68). */
const NEW_FOLDER_DRAFT_ID = '__new-folder-draft__'

/**
 * Inline editor for a folder that does not exist yet. Mirrors TreeNode's
 * rename input (same borders, same Enter/Escape/blur contract) so creating a
 * folder feels identical to renaming one. Confirming with an empty name is a
 * cancel — nothing is written.
 */
function NewFolderRow({
  depth,
  placeholder,
  onConfirm,
  onCancel,
}: {
  depth: number
  placeholder: string
  onConfirm: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // Guards against blur firing after Enter/Escape already settled the row,
  // which would create the folder twice.
  const settled = useRef(false)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const settle = (commit: boolean) => {
    if (settled.current) return
    settled.current = true
    const trimmed = value.trim()
    if (commit && trimmed) onConfirm(trimmed)
    else onCancel()
  }

  return (
    <div
      className="flex items-center gap-[5px] rounded-md"
      style={{ padding: `4px 10px 4px ${10 + depth * 14}px` }}
    >
      <span className="inline-block w-2.5 shrink-0" />
      <input
        ref={inputRef}
        data-testid="new-folder-input"
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            settle(true)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            settle(false)
          }
        }}
        onBlur={() => settle(true)}
        onClick={(e) => e.stopPropagation()}
        className="flex-1 rounded border px-1.5 py-0.5 outline-none"
        style={{
          borderColor: 'var(--accent)',
          background: 'var(--white)',
          color: 'var(--text)',
          minWidth: 0,
        }}
      />
    </div>
  )
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

  // Folders the user collapsed while the search box has text. Lives outside
  // `openNodeIds` so the real collapse state survives the filter session
  // untouched; reset once the query is cleared (issue #70).
  const [filterCollapsedIds, setFilterCollapsedIds] = useState<Set<string>>(() => new Set())
  // Parent awaiting the inline "new folder" name prompt (issue #68).
  const [pendingFolder, setPendingFolder] = useState<{
    parentNodeId: string
    parentFolderId: string | null
  } | null>(null)

  useEffect(() => {
    if (!searchQuery.trim()) setFilterCollapsedIds((prev) => (prev.size > 0 ? new Set() : prev))
  }, [searchQuery])

  // Collapse-all / expand-all write `openNodeIds`, which the filtered view does
  // not read — so during a search both buttons did nothing. Mirror the command
  // into the filter session instead (issue #70, sibling of the chevron fix).
  const allNodesCommand = useWorkspaceStore((s) => s.allNodesCommand)
  useEffect(() => {
    if (!searchQuery.trim() || allNodesCommand.seq === 0) return
    if (allNodesCommand.kind === 'expand') {
      setFilterCollapsedIds((prev) => (prev.size > 0 ? new Set() : prev))
      return
    }
    const ids = new Set<string>()
    const walk = (nodes: TreeNode[]): void => {
      for (const n of nodes) {
        if (n.children && n.children.length > 0) {
          ids.add(n.id)
          walk(n.children)
        }
      }
    }
    walk(filterTree(treeData, searchQuery.trim().toLowerCase()))
    setFilterCollapsedIds(ids)
    // `treeData`/`searchQuery` are read, not tracked: the command seq is the
    // only trigger — re-running on every keystroke would fight the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allNodesCommand])

  const { flatNodes, effectiveOpenIds } = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return { flatNodes: flattenTree(treeData, openNodeIds), effectiveOpenIds: openNodeIds }
    // When searching, filter the tree and show every surviving match expanded
    // unless the user collapsed that folder during this filter session.
    const expanded = new Set<string>()
    const nodes = flattenFiltered(filterTree(treeData, q), filterCollapsedIds, expanded)
    return { flatNodes: nodes, effectiveOpenIds: expanded }
  }, [treeData, openNodeIds, searchQuery, filterCollapsedIds])

  // Splice the pending-folder placeholder in directly under its parent so the
  // virtualizer counts it like any other row.
  const rows = useMemo(() => {
    if (!pendingFolder) return flatNodes
    const idx = flatNodes.findIndex((f) => f.node.id === pendingFolder.parentNodeId)
    if (idx === -1) return flatNodes
    const draft: FlatNode = {
      node: { id: NEW_FOLDER_DRAFT_ID, label: '', type: 'folder' },
      depth: flatNodes[idx].depth + 1,
    }
    return [...flatNodes.slice(0, idx + 1), draft, ...flatNodes.slice(idx + 1)]
  }, [flatNodes, pendingFolder])

  const handleToggle = useCallback(
    (id: string) => {
      // While filtering, the tree is force-expanded and `openNodeIds` is not
      // consulted — writing to it made the chevron look dead (issue #70).
      // Record the collapse in the filter-session set instead.
      if (searchQuery.trim()) {
        setFilterCollapsedIds((prev) => {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
        return
      }
      toggleNode(id)
    },
    [searchQuery, toggleNode],
  )

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 30,
    overscan: 10,
  })

  // Scroll a revealed row into view (issue #115). The store has already opened
  // the ancestors and cleared the search box; by the time this effect runs the
  // row is in `rows`, so its index is scrollable. Runs on the command seq only
  // — re-scrolling on every `rows` change would fight the user's own scrolling.
  const revealCommand = useWorkspaceStore((s) => s.revealCommand)
  useEffect(() => {
    if (revealCommand.seq === 0) return
    const idx = rows.findIndex((r) => r.node.id === revealCommand.nodeId)
    if (idx === -1) return
    virtualizer.scrollToIndex(idx, { align: 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealCommand])

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

      /*
       * The request may already be open. Every branch below opens a preview
       * tab and then re-hydrates it from the DB and calls `clearResponse()` —
       * but `openPreviewTab` recognises an already-open endpoint / saved
       * request and just ACTIVATES it, so those two calls landed on a live
       * tab: the response the user had just received was wiped and the tab
       * reset to its saved state (issue #112, second path — the tab strip was
       * fixed, the tree was not). Focus it and stop; the open tab already
       * holds that state, unsaved edits included.
       */
      if (focusOpenTabFor(node.id)) return

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
              metadata?: string
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
            // Re-hydrate protocol-specific state (WS/SSE/Socket.IO/gRPC/GraphQL/
            // SOAP) that snapshotProtocol wrote into the `metadata` column.
            // This inline tree-click handler is a parallel load path to
            // `openEndpointTab` (TreeView caches stores/setActiveNode itself),
            // and it used to drop `metadata` entirely — so a saved WebSocket
            // request reopened from the tree showed the default URL while the
            // helper-driven paths restored correctly (MST-120). Keep this in
            // sync with `openEndpointTab` in lib/open-endpoint-tab.ts.
            if (sr.metadata) {
              try {
                restoreProtocolFromMetadata(
                  (sr.protocol || 'http') as string,
                  JSON.parse(sr.metadata),
                )
              } catch {
                /* malformed metadata — skip protocol restore */
              }
            }
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
  // Folder/project → test suite request-selection modal (issue #102)
  const [suiteSelectTarget, setSuiteSelectTarget] = useState<TreeNode | null>(null)
  const [folderSettingsTarget, setFolderSettingsTarget] = useState<{
    id: string
    name: string
  } | null>(null)
  const handleFolderSettings = useCallback((node: TreeNode) => {
    setFolderSettingsTarget({ id: node.id, name: node.label })
  }, [])

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
        // Keep an open tab for this node in sync with the new name — renaming
        // in the tree left the tab chip showing the stale title until close +
        // reopen (issue #40). Match by tab id (`tab-<nodeId>`) or by the
        // endpoint/saved-request id the tab is backed by.
        if (node.type === 'endpoint' || node.type === 'request') {
          const tabsStore = useTabsStore.getState()
          const openTab = tabsStore.tabs.find(
            (tb) =>
              tb.id === `tab-${node.id}` ||
              tb.endpointId === node.id ||
              tb.savedRequestId === node.id,
          )
          if (openTab) tabsStore.updateTab(openTab.id, { name: newName })
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
          // 'New Endpoint', not 'New Request': the Workbench treats a tab named
          // exactly "New Request" with an empty url as the blank scratch tab
          // and renders the protocol picker instead of the HTTP editor, so the
          // freshly-created request opened onto the landing screen while every
          // other protocol (all distinctly named) opened its editor (issue
          // #69). This also restores the name the global "+ New" dropdown uses.
          http: { name: 'New Endpoint', method: 'GET' },
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
        })) as { success: boolean; error?: string; data?: { id: string } } | undefined
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
        // Open + focus the freshly-created request, matching the global "+ New"
        // dropdown (which opens its tab immediately). Without this the request
        // appeared in the tree but the user had to find and click it manually
        // (issue #6). `openEndpointTab` opens the tab, switches to it, and
        // hydrates protocol-specific state for non-HTTP types.
        if (result.data?.id) {
          await openEndpointTab(result.data.id)
        }
      } catch (err) {
        console.error('Add Request from context menu failed:', err)
        toast.error(`Failed to create request: ${(err as Error).message || 'unknown error'}`)
      }
    },
    [activeProjectId, refreshTree],
  )

  // Issue #68: this used to write a "New Folder" row straight to the DB, so a
  // mis-click always left a folder behind to delete. Open the inline draft row
  // instead — nothing is persisted until the user confirms a name.
  const handleAddFolder = useCallback(
    (parentNode: TreeNode) => {
      if (!activeProjectId) return
      // Expand the parent so the draft row (spliced in right below it) is
      // actually on screen.
      const store = useWorkspaceStore.getState()
      if (!store.openNodeIds.has(parentNode.id)) store.toggleNode(parentNode.id)
      setPendingFolder({
        parentNodeId: parentNode.id,
        parentFolderId: parentNode.type === 'folder' ? parentNode.id : null,
      })
    },
    [activeProjectId],
  )

  const handleCreateFolderConfirm = useCallback(
    async (name: string) => {
      const target = pendingFolder
      setPendingFolder(null)
      if (!target || !activeProjectId) return
      try {
        await window.api?.folder?.create({
          project_id: activeProjectId,
          parent_id: target.parentFolderId,
          name,
          // Branch-stamp so a folder added on a non-default branch stays on it
          // (#8 — the exact reported repro).
          branch_id: useBranchStore.getState().getActiveBranchScope(),
        })
        await refreshTree()
      } catch {
        /* ignore */
      }
    },
    [pendingFolder, activeProjectId, refreshTree],
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

  // Issue #106: right-click → Collapse All / Expand All on a folder. While a
  // search filter is active the tree renders from the filter session
  // (`filterCollapsedIds`) and ignores `openNodeIds`, so the command is
  // mirrored there instead — the same dead-control trap issue #70 documented
  // for the chevron and the panel-level collapse/expand buttons.
  const collapseSubtree = useWorkspaceStore((s) => s.collapseSubtree)
  const expandSubtree = useWorkspaceStore((s) => s.expandSubtree)

  const handleCollapseSubtree = useCallback(
    (node: TreeNode) => {
      if (searchQuery.trim()) {
        setFilterCollapsedIds((prev) => {
          const next = new Set(prev)
          // Descendants only — the folder row itself stays open, matching
          // the store action's semantics.
          for (const id of collectExpandableIds(node.children ?? [])) next.add(id)
          return next
        })
        return
      }
      collapseSubtree(node.id)
    },
    [searchQuery, collapseSubtree],
  )

  const handleExpandSubtree = useCallback(
    (node: TreeNode) => {
      if (searchQuery.trim()) {
        setFilterCollapsedIds((prev) => {
          const next = new Set(prev)
          // Self-inclusive — mirrors the store action's expandSubtree.
          for (const id of collectExpandableIds([node])) next.delete(id)
          return next
        })
        return
      }
      expandSubtree(node.id)
    },
    [searchQuery, expandSubtree],
  )

  const handleRunFolder = useCallback((node: TreeNode) => {
    // Open the runner AND switch to the Tests page where it renders — without
    // the page switch the tab opened but stayed hidden behind the APIs view, so
    // right-click → Run looked like a no-op (#39).
    openFolderRunner(node.id, node.label)
  }, [])

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
  const collectRequestIdsRecursive = useCallback(
    (folderNode: TreeNode): string[] => collectRequestIds(folderNode),
    [],
  )

  const setActiveSidebarPage = (() => {
    // Late-import via dynamic require so we don't pull the store at module top
    // and break tree-shaking; lazily resolved when the user actually clicks.
    return (page: string) => {
      void import('../../stores/ui.store').then((m) =>
        m.useUIStore.getState().setActiveSidebarPage(page as never),
      )
    }
  })()

  /**
   * Convert a folder into a test suite — and say what happened (issue #96).
   *
   * Every outcome here used to be silent. An empty folder made the menu item
   * look broken, a failed create left the user on the APIs tree with no
   * explanation, the import's result was discarded entirely, and the error path
   * reached devtools only. Even success said nothing: the sidebar switched to
   * Tests and the user had to go find the suite.
   *
   * `rejected` matters as much as the failures: a suite built from 40 requests
   * that copied 37 is not a success, and reporting it as one is how a run comes
   * up short later for no visible reason.
   *
   * Shared by the direct single-request path and the selection modal's confirm
   * (#102) — `ids` is the (possibly user-narrowed) request set to copy.
   */
  const performCreateTestSuite = useCallback(
    async (folderNode: TreeNode, ids: string[]) => {
      if (!activeProjectId || ids.length === 0) return
      try {
        const createRes = (await window.api?.testSuite?.create({
          project_id: activeProjectId,
          name: folderNode.label,
        })) as { success: boolean; data?: { id: string }; error?: string }
        if (!createRes?.success || !createRes.data) {
          toast.error(`${t('tree.suiteCreateFailed')}: ${createRes?.error || 'unknown error'}`)
          return
        }
        const importRes = (await window.api?.testSuite?.importEndpoints({
          suite_id: createRes.data.id,
          endpoint_ids: ids,
          // The suite IS this folder, so its subfolders should land at the
          // suite's root rather than inside a copy of it (issue #94).
          source_folder_id: folderNode.id,
        })) as {
          success: boolean
          data?: { added: number; rejected: number }
          error?: string
        }
        // Hand the user off to the Tests workbench so they can see the result.
        // Done before reporting, so a warning lands next to what it describes.
        setActiveSidebarPage('tests')
        if (!importRes?.success) {
          toast.error(`${t('tree.suiteCreateFailed')}: ${importRes?.error || 'unknown error'}`)
          return
        }
        const added = importRes.data?.added ?? 0
        const rejected = importRes.data?.rejected ?? 0
        if (rejected > 0) {
          toast.warning(`${t('tree.suiteImportPartial')} — ${added}/${ids.length}`)
        } else {
          toast.success(`${t('tree.suiteCreated')}: ${folderNode.label} (${added})`)
        }
      } catch (err) {
        toast.error(`${t('tree.suiteCreateFailed')}: ${(err as Error).message || 'unknown error'}`)
      }
    },
    [activeProjectId],
  )

  /**
   * Entry point for the three context-menu items. A single request has nothing
   * to choose from, so it creates directly; folders and the project root get a
   * selection step first — the old behaviour copied EVERY request under the
   * folder into the suite, and a subset required post-create pruning (#102).
   */
  const handleCreateTestSuite = useCallback(
    (folderNode: TreeNode) => {
      if (!activeProjectId) return
      const ids = collectRequestIdsRecursive(folderNode)
      if (ids.length === 0) {
        toast.info(t('tree.suiteEmptyFolder'))
        return
      }
      if (folderNode.type === 'folder' || folderNode.type === 'module') {
        setSuiteSelectTarget(folderNode)
        return
      }
      void performCreateTestSuite(folderNode, ids)
    },
    [activeProjectId, collectRequestIdsRecursive, performCreateTestSuite],
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
          const { node, depth } = rows[virtualRow.index]
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
              {node.id === NEW_FOLDER_DRAFT_ID ? (
                <NewFolderRow
                  depth={depth}
                  placeholder={t('tree.newFolderPlaceholder')}
                  onConfirm={handleCreateFolderConfirm}
                  onCancel={() => setPendingFolder(null)}
                />
              ) : (
                <TreeNodeComponent
                  node={node}
                  depth={depth}
                  activeId={activeNodeId}
                  onSelect={handleSelect}
                  onToggle={handleToggle}
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
                  onFolderSettings={handleFolderSettings}
                  onCollapseAll={handleCollapseSubtree}
                  onExpandAll={handleExpandSubtree}
                  onDrop={handleDrop}
                  openIds={effectiveOpenIds}
                  isFlat
                />
              )}
            </div>
          )
        })}
      </div>

      {/* Folder-level auth + scripts editor */}
      {folderSettingsTarget && (
        <FolderSettingsModal
          open
          folderId={folderSettingsTarget.id}
          folderName={folderSettingsTarget.name}
          onClose={() => setFolderSettingsTarget(null)}
        />
      )}

      {/* Folder/project → test suite request selection (issue #102). Mounted
          per open so the modal's "all selected" default resets every time. */}
      {suiteSelectTarget && (
        <CreateSuiteFromFolderModal
          open
          folder={suiteSelectTarget}
          onConfirm={(ids) => {
            const target = suiteSelectTarget
            setSuiteSelectTarget(null)
            void performCreateTestSuite(target, ids)
          }}
          onCancel={() => setSuiteSelectTarget(null)}
        />
      )}

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
