import { create } from 'zustand'
import type { Workspace, Project, TreeNode, Folder, Endpoint, SavedRequest, Tab } from '../types'
import { useEnvironmentStore } from './environment.store'
import { useBranchStore } from './branch.store'
import { useTabsStore } from './tabs.store'
import { useConsoleStore } from './console.store'
import { loadJson, saveJson } from '../lib/persist-helpers'

/**
 * Did a write actually land?
 *
 * The bridge REPORTS failure as `{success:false, error}` and resolves; only a
 * missing bridge throws. Swallowing both meant `renameProject` / `updateProject`
 * reported nothing at all, and `ProjectDetailModal` went on to show
 * "Project settings saved" while the re-fetch quietly put the old name back.
 *
 * The store stays UI-agnostic; it returns the outcome and lets the caller say so.
 */
async function persisted(call: Promise<unknown> | undefined): Promise<boolean> {
  try {
    const res = (await call) as { success?: boolean } | undefined
    return !(res && res.success === false)
  } catch {
    return false
  }
}

interface ProjectTabSnapshot {
  tabs: Tab[]
  activeTabId: string | null
}

/**
 * Per-project open-tab snapshots (issue #1). Each project keeps its own set of
 * open tabs so switching projects no longer wipes them — the previous project's
 * tabs are stashed here and restored when you switch back.
 *
 * Persisted across app restarts (relaunch tab-loss fix): the map used to be
 * in-memory only, so on boot it was empty and the FIRST `setActiveProject`
 * restored an empty set via `replaceAllTabs([], …)`, wiping the tabs the user
 * had open. We now seed the map from localStorage on load and re-persist on
 * every mutation, so opening a project after a relaunch restores its tabs.
 */
const TABS_BY_PROJECT_KEY = 'testnizer-tabs-by-project'

const tabsByProject = new Map<string, ProjectTabSnapshot>(
  Object.entries(loadJson<Record<string, ProjectTabSnapshot>>(TABS_BY_PROJECT_KEY) ?? {}),
)

function persistTabsByProject(): void {
  saveJson(TABS_BY_PROJECT_KEY, Object.fromEntries(tabsByProject))
}

function snapshotProjectTabs(projectId: string | null): void {
  if (!projectId) return
  const ts = useTabsStore.getState()
  // Drop `isLoading` so a tab mid-flight at shutdown doesn't return stuck in a
  // spinner — same normalisation the tabs store applies to its own snapshot.
  tabsByProject.set(projectId, {
    tabs: ts.tabs.map((t) => ({ ...t, isLoading: false })),
    activeTabId: ts.activeTabId,
  })
  persistTabsByProject()
}

/**
 * Wipe state that's scoped to a single project before switching contexts.
 * Tabs hold endpoint/saved-request IDs that no longer exist in the new
 * project, console entries reference closed tab ids, and any in-flight
 * merge-conflict modal belongs to the project being left. Centralising
 * here keeps the four call-sites (setActiveWorkspace, setActiveProject,
 * deleteProject, deleteWorkspace) honest about what gets cleared.
 */
function resetProjectScopedState(): void {
  useTabsStore.getState().closeAllTabs()
  useConsoleStore.getState().clear()
  useBranchStore.getState().clearPendingConflict()
}

interface WorkspaceStore {
  initialized: boolean
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  projects: Project[]
  activeProjectId: string | null
  /** Projects with an open header tab (issue #1) — multiple stay open at once. */
  openProjectIds: string[]
  treeData: TreeNode[]
  openNodeIds: Set<string>
  activeNodeId: string | null
  searchQuery: string

  initialize: () => Promise<void>
  setActiveWorkspace: (id: string) => void
  setActiveProject: (id: string | null) => void
  setTreeData: (data: TreeNode[]) => void
  toggleNode: (id: string) => void
  /** Collapse every folder/request group in one action, keeping module roots open (issue #39). */
  /**
   * Bumped by collapse-all / expand-all. The tree ignores `openNodeIds` while
   * a search filter is active (matches are force-expanded), so without this
   * signal both buttons looked dead during a filter — the same defect issue
   * #70 reported for the per-folder chevron.
   */
  allNodesCommand: { kind: 'collapse' | 'expand'; seq: number }
  collapseAllNodes: () => void
  /** Expand every node that has children (issue #39). */
  expandAllNodes: () => void
  /**
   * Collapse every open descendant of the given folder, leaving the folder's
   * OWN open-state untouched — the user keeps seeing its direct children, now
   * all collapsed (issue #106, right-click → Collapse All). Unknown id = no-op.
   */
  collapseSubtree: (id: string) => void
  /**
   * Expand the given folder AND every descendant that has children (issue
   * #106, right-click → Expand All). Including the folder itself is
   * deliberate: expanding only the descendants of a closed folder would
   * visibly do nothing — the dead-control class of #39/#70. Unknown id = no-op.
   */
  expandSubtree: (id: string) => void
  setActiveNode: (id: string) => void
  /**
   * Signal for TreeView to scroll a revealed row into view (issue #115).
   * Bumped by `revealNode`; `seq === 0` means "nothing revealed yet".
   */
  revealCommand: { nodeId: string; seq: number }
  /**
   * Bring `id` into view in the APIs tree: open every ancestor folder, clear
   * the search box (a filtered tree can hide the very node being revealed),
   * select the row and ask TreeView to scroll to it.
   *
   * Returns false when the id is not in the tree — a request that has since
   * been deleted, or a suite item that never lived in APIs — so the caller can
   * say so instead of navigating to nothing.
   */
  revealNode: (id: string) => boolean
  setSearchQuery: (query: string) => void
  fetchWorkspaces: () => Promise<void>
  createWorkspace: (name: string, description?: string) => Promise<void>
  fetchProjects: (workspaceId: string) => Promise<void>
  createProject: (
    name: string,
    type: 'http' | 'grpc' | 'websocket',
    saveMode?: string,
    localPath?: string,
    iconEmoji?: string,
    iconColor?: string,
    displayName?: string,
  ) => Promise<string | null>
  /** Resolves false when the write was refused — see `persisted()` below. */
  renameProject: (id: string, newName: string) => Promise<boolean>
  updateProject: (
    id: string,
    data: {
      name?: string
      display_name?: string | null
      /**
       * Was missing from this type only — the IPC handler and the repo have
       * always accepted it. Because the type omitted it, `ProjectDetailModal`
       * could drop the user's Description on save without a compile error.
       */
      description?: string
      save_mode?: string
      local_path?: string | null
      icon_emoji?: string | null
      icon_color?: string | null
    },
  ) => Promise<boolean>
  deleteProject: (id: string) => Promise<void>
  /** Close a project's header tab (#1): drops its tab snapshot and, if it was
   *  active, falls back to another open project or Home. */
  closeProjectTab: (id: string) => void
  goHome: () => void
  /** Reload tree data from DB for active project */
  refreshTree: () => Promise<void>
}

interface FolderRow {
  id: string
  project_id: string
  parent_id: string | null
  name: string
  sort_order: number
}

interface EndpointRow {
  id: string
  project_id: string
  folder_id: string | null
  name: string
  method: string | null
  path: string
  protocol: string
}

interface SavedRequestRow {
  id: string
  project_id: string | null
  folder_id: string | null
  name: string
  method: string | null
  url: string
  protocol: string
}

async function buildTreeFromDB(projectId: string, projectName: string): Promise<TreeNode[]> {
  try {
    // Branch scope (#8): null on the default branch (shows shared content),
    // else the active branch name (shows shared + that branch's content).
    const branchScope = useBranchStore.getState().getActiveBranchScope()
    // Three independent IPC calls — fan out in parallel.
    const [foldersResult, endpointsResult, savedResult] = await Promise.all([
      window.api?.folder?.list(projectId, branchScope) as Promise<{
        success: boolean
        data?: FolderRow[]
      }>,
      window.api?.endpoint?.listByProject(projectId, branchScope) as Promise<{
        success: boolean
        data?: EndpointRow[]
      }>,
      window.api?.savedRequest?.list(projectId, branchScope) as Promise<{
        success: boolean
        data?: SavedRequestRow[]
      }>,
    ])
    const folders: FolderRow[] =
      foldersResult?.success && foldersResult.data ? foldersResult.data : []
    const endpoints: EndpointRow[] =
      endpointsResult?.success && endpointsResult.data ? endpointsResult.data : []
    const savedRequests: SavedRequestRow[] =
      savedResult?.success && savedResult.data ? savedResult.data : []

    // Build folder map (id → TreeNode) with direct children (endpoints + saved requests)
    const folderMap = new Map<string, TreeNode>()
    for (const f of folders) {
      const folderEndpoints: TreeNode[] = endpoints
        .filter((e) => e.folder_id === f.id)
        .map((e) => ({
          id: e.id,
          type: 'endpoint' as const,
          label: e.name,
          method: e.method || 'GET',
          path: e.path,
        }))

      const folderSaved: TreeNode[] = savedRequests
        .filter((r) => r.folder_id === f.id)
        .map((r) => ({
          id: r.id,
          type: 'request' as const,
          label: r.name,
          method: r.method || 'GET',
          path: r.url,
        }))

      folderMap.set(f.id, {
        id: f.id,
        type: 'folder' as const,
        label: f.name,
        icon: 'folder',
        children: [...folderEndpoints, ...folderSaved],
      })
    }

    // Nest child folders under their parents
    const rootFolderNodes: TreeNode[] = []
    for (const f of folders) {
      const node = folderMap.get(f.id)!
      if (f.parent_id && folderMap.has(f.parent_id)) {
        // Add as child of parent folder
        const parent = folderMap.get(f.parent_id)!
        if (!parent.children) parent.children = []
        parent.children.push(node)
      } else {
        // Root-level folder (no parent or parent not found)
        rootFolderNodes.push(node)
      }
    }

    // Root-level endpoints (no folder)
    const rootEndpoints: TreeNode[] = endpoints
      .filter((e) => !e.folder_id)
      .map((e) => ({
        id: e.id,
        type: 'endpoint' as const,
        label: e.name,
        method: e.method || 'GET',
        path: e.path,
      }))

    // Root-level saved requests (no folder)
    const rootSaved: TreeNode[] = savedRequests
      .filter((r) => !r.folder_id)
      .map((r) => ({
        id: r.id,
        type: 'request' as const,
        label: r.name,
        method: r.method || 'GET',
        path: r.url,
      }))

    // Build project root node
    const projectNode: TreeNode = {
      id: `project-${projectId}`,
      type: 'module',
      label: projectName,
      icon: 'collection',
      children: [...rootFolderNodes, ...rootEndpoints, ...rootSaved],
    }

    return [projectNode]
  } catch {
    return emptyTree()
  }
}

function emptyTree(): TreeNode[] {
  return [
    {
      id: 'default-module',
      type: 'module',
      label: 'Default module',
      icon: 'module',
      children: [],
    },
  ]
}

/**
 * Ids of every ancestor of `id`, outermost first — the folders that have to be
 * open for the node to be on screen. Empty when the node is a root, `null`
 * when it is not in the tree at all (the two are NOT the same: a root node is
 * revealable, a missing one is not).
 */
export function ancestorPath(nodes: TreeNode[], id: string): string[] | null {
  for (const n of nodes) {
    if (n.id === id) return []
    if (n.children) {
      const below = ancestorPath(n.children, id)
      if (below) return [n.id, ...below]
    }
  }
  return null
}

/** Depth-first lookup of a tree node by id. */
function findNodeById(nodes: TreeNode[], id: string): TreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    if (n.children) {
      const hit = findNodeById(n.children, id)
      if (hit) return hit
    }
  }
  return null
}

/**
 * Ids of every node in `nodes` — the nodes themselves included — that has
 * children, i.e. every expandable row. The ONLY subtree walker: the store's
 * expand/collapse actions and TreeView's search-session mirror all derive
 * from it (self-inclusive: pass `[node]`; descendants-only: pass
 * `node.children ?? []`), so the variants can't drift apart.
 */
export function collectExpandableIds(nodes: TreeNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.children && n.children.length > 0) {
      out.push(n.id)
      collectExpandableIds(n.children, out)
    }
  }
  return out
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  initialized: false,
  workspaces: [],
  activeWorkspaceId: null,
  projects: [],
  activeProjectId: null,
  openProjectIds: [],
  treeData: emptyTree(),
  openNodeIds: new Set(['default-module']),
  revealCommand: { nodeId: '', seq: 0 },
  allNodesCommand: { kind: 'expand', seq: 0 },
  activeNodeId: null,
  searchQuery: '',

  initialize: async () => {
    if (get().initialized) return

    try {
      const wsResult = await window.api?.workspace?.list()
      if (wsResult?.success && wsResult.data) {
        const workspaces = wsResult.data as Workspace[]
        set({ workspaces })

        if (workspaces.length > 0) {
          const wsId = workspaces[0].id
          set({ activeWorkspaceId: wsId })

          const projResult = await window.api?.project?.list(wsId)
          if (projResult?.success && projResult.data) {
            set({ projects: projResult.data as Project[] })
          }
        }
      }
    } catch {
      // IPC not available
    }

    set({ initialized: true })
  },

  setActiveWorkspace: (id) => {
    const prev = get().activeWorkspaceId
    if (prev && prev !== id) {
      resetProjectScopedState()
      // A different workspace has its own projects — reset the open-project
      // header tabs + their cached tab sets (#1).
      tabsByProject.clear()
      persistTabsByProject()
      set({ openProjectIds: [] })
    }
    set({ activeWorkspaceId: id, activeProjectId: null })
  },

  setActiveProject: async (id) => {
    const prevId = get().activeProjectId
    // Per-project tabs (#1): instead of wiping tabs on switch we restore the
    // incoming project's set. The leaving project's snapshot is kept current by
    // the tabs→localStorage subscription at the bottom of this file (it fires on
    // every tab change while a project is active), so no explicit stash is
    // needed here. Console + pending-conflict are scoped to the old project.
    if (prevId && prevId !== id) {
      useConsoleStore.getState().clear()
      useBranchStore.getState().clearPendingConflict()
    }
    set({ activeProjectId: id })
    if (id) {
      // Restore (or seed empty) the target project's tab set and remember it
      // as an open header tab.
      const snap = tabsByProject.get(id)
      useTabsStore.getState().replaceAllTabs(snap?.tabs ?? [], snap?.activeTabId ?? null)
      set((s) =>
        s.openProjectIds.includes(id) ? s : { openProjectIds: [...s.openProjectIds, id] },
      )
    } else {
      // Home: keep the project tabs stashed; the tab bar isn't shown here.
      useTabsStore.getState().replaceAllTabs([], null)
    }
    // Reload environments/globals for the new scope
    await useEnvironmentStore.getState().setCurrentProject(id)
    if (!id) {
      set({ treeData: emptyTree() })
      // Reset accent color to default
      document.documentElement.style.removeProperty('--accent')
      document.documentElement.style.removeProperty('--accent-text')
      return
    }
    // Find project and apply its color. Prefer `display_name` (human-friendly,
    // entered in the wizard) over `name` (the slug used for filenames / git).
    // v1.3.1 B4 surfaced the slug as the tree root label, which clashed with
    // the rest of the UI that already used display_name.
    const project = get().projects.find((p) => p.id === id)
    const projectName = project?.display_name || project?.name || 'Project'
    if (project?.icon_color) {
      document.documentElement.style.setProperty('--accent', project.icon_color)
      document.documentElement.style.setProperty('--accent-text', project.icon_color)
    }

    const tree = await buildTreeFromDB(id, projectName)
    const openIds = new Set<string>()
    // Auto-open the project root
    for (const node of tree) {
      openIds.add(node.id)
      // Also open first-level folders
      if (node.children) {
        for (const child of node.children) {
          if (child.type === 'folder') {
            openIds.add(child.id)
          }
        }
      }
    }
    set({ treeData: tree, openNodeIds: openIds })
  },

  setTreeData: (data) => set({ treeData: data }),

  toggleNode: (id) =>
    set((state) => {
      const next = new Set(state.openNodeIds)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return { openNodeIds: next }
    }),

  collapseAllNodes: () =>
    set((state) => {
      // Keep the top-level module roots open so the project stays visible,
      // but close every folder/group beneath them in one action (issue #39).
      const next = new Set<string>()
      const walk = (nodes: TreeNode[]) => {
        for (const n of nodes) {
          if (n.type === 'module') next.add(n.id)
          if (n.children) walk(n.children)
        }
      }
      walk(state.treeData)
      return {
        openNodeIds: next,
        allNodesCommand: { kind: 'collapse', seq: state.allNodesCommand.seq + 1 },
      }
    }),

  expandAllNodes: () =>
    set((state) => ({
      openNodeIds: new Set(collectExpandableIds(state.treeData)),
      allNodesCommand: { kind: 'expand', seq: state.allNodesCommand.seq + 1 },
    })),

  collapseSubtree: (id) =>
    set((state) => {
      const target = findNodeById(state.treeData, id)
      if (!target) return {}
      const next = new Set(state.openNodeIds)
      // Descendants only — the folder itself stays open so the collapsed
      // children remain in view (issue #106).
      for (const descendantId of collectExpandableIds(target.children ?? [])) {
        next.delete(descendantId)
      }
      return { openNodeIds: next }
    }),

  expandSubtree: (id) =>
    set((state) => {
      const target = findNodeById(state.treeData, id)
      if (!target) return {}
      const next = new Set(state.openNodeIds)
      // Self-inclusive — see the interface doc for why the folder opens too.
      for (const nodeId of collectExpandableIds([target])) {
        next.add(nodeId)
      }
      return { openNodeIds: next }
    }),

  setActiveNode: (id) => set({ activeNodeId: id }),

  revealNode: (id) => {
    const state = get()
    const path = ancestorPath(state.treeData, id)
    if (!path) return false
    const openNodeIds = new Set(state.openNodeIds)
    for (const ancestor of path) openNodeIds.add(ancestor)
    set({
      openNodeIds,
      activeNodeId: id,
      // A live filter force-expands its own matches and ignores `openNodeIds`
      // entirely, so revealing into a filtered tree would land on a row that
      // is not rendered. Clearing the box is the only way the reveal is
      // guaranteed to be visible.
      searchQuery: '',
      revealCommand: { nodeId: id, seq: state.revealCommand.seq + 1 },
    })
    return true
  },

  setSearchQuery: (query) => set({ searchQuery: query }),

  fetchWorkspaces: async () => {
    try {
      const result = await window.api?.workspace?.list()
      if (result?.success && result.data) {
        set({ workspaces: result.data as Workspace[] })
      }
    } catch {
      // IPC not available
    }
  },

  createWorkspace: async (name, description) => {
    try {
      const result = await window.api?.workspace?.create({ name, description })
      if (result?.success) {
        await get().fetchWorkspaces()
      }
    } catch {
      // IPC not available
    }
  },

  fetchProjects: async (workspaceId) => {
    try {
      const result = await window.api?.project?.list(workspaceId)
      if (result?.success && result.data) {
        set({ projects: result.data as Project[] })
      }
    } catch {
      // IPC not available
    }
  },

  createProject: async (name, type, saveMode, localPath, iconEmoji, iconColor, displayName) => {
    try {
      const wsId = get().activeWorkspaceId
      if (!wsId) return null
      const result = await window.api?.project?.create({
        workspace_id: wsId,
        name,
        type,
        save_mode: saveMode,
        local_path: localPath,
        icon_emoji: iconEmoji,
        icon_color: iconColor,
        display_name: displayName,
      })
      if (result?.success && result.data) {
        await get().fetchProjects(wsId)
        const created = result.data as Project
        return created.id
      }
    } catch {
      // IPC not available
    }
    return null
  },

  renameProject: async (id, newName) => {
    const ok = await persisted(window.api?.project?.update(id, { display_name: newName }))
    const wsId = get().activeWorkspaceId
    if (wsId) await get().fetchProjects(wsId)
    return ok
  },

  updateProject: async (id, data) => {
    const ok = await persisted(window.api?.project?.update(id, data))
    const wsId = get().activeWorkspaceId
    if (wsId) await get().fetchProjects(wsId)
    return ok
  },

  deleteProject: async (id) => {
    try {
      await window.api?.project?.delete(id)
      const wsId = get().activeWorkspaceId
      if (wsId) {
        await get().fetchProjects(wsId)
      }
      // The project is gone — drop its open header tab + cached tabs (#1).
      tabsByProject.delete(id)
      persistTabsByProject()
      set((s) => ({ openProjectIds: s.openProjectIds.filter((p) => p !== id) }))
      // If we just deleted the project we were viewing, drop all
      // project-scoped state (tabs / console / branch) so the UI stops
      // rendering against a dead row.
      if (get().activeProjectId === id) {
        // Null activeProjectId BEFORE resetProjectScopedState (its closeAllTabs
        // fires the snapshot subscription) so the deleted project isn't
        // re-persisted with an empty tab set.
        set({ activeProjectId: null })
        resetProjectScopedState()
        set({ treeData: emptyTree() })
      }
    } catch {
      // IPC not available
    }
  },

  goHome: () => {
    // The current project's tabs are already snapshotted live (subscription
    // below). Drop activeProjectId FIRST so the empty `replaceAllTabs` that
    // clears the view while Home (ProjectHome) is shown does NOT trip the
    // subscription into overwriting the project's stored tabs with an empty set.
    set({ activeProjectId: null })
    useTabsStore.getState().replaceAllTabs([], null)
  },

  closeProjectTab: (id) => {
    tabsByProject.delete(id)
    persistTabsByProject()
    const wasActive = get().activeProjectId === id
    set((s) => ({ openProjectIds: s.openProjectIds.filter((p) => p !== id) }))
    if (wasActive) {
      // Fall back to another still-open project, else Home.
      const next = get().openProjectIds[0] ?? null
      if (next) {
        void get().setActiveProject(next)
      } else {
        // Null first, then clear the view — same ordering as goHome so the
        // subscription doesn't re-snapshot the just-closed project.
        set({ activeProjectId: null })
        useTabsStore.getState().replaceAllTabs([], null)
      }
    }
  },

  refreshTree: async () => {
    const projectId = get().activeProjectId
    if (!projectId) return
    const project = get().projects.find((p) => p.id === projectId)
    // Same preference as setActiveProject — display_name beats the slug so a
    // rename made via the project hub shows up immediately on the next tree
    // refresh, not just on a full reload (B4).
    const projectName = project?.display_name || project?.name || 'Project'
    const tree = await buildTreeFromDB(projectId, projectName)
    // Preserve existing openNodeIds
    set({ treeData: tree })
  },
}))

// Keep the ACTIVE project's snapshot live + persisted. `snapshotProjectTabs` is
// otherwise only called when leaving a project; without this, closing the app
// while a project is focused would persist a stale snapshot (or none, on first
// open) and the just-opened/edited tabs would be lost on the next relaunch.
// While on Home (no active project) there is nothing to snapshot — the empty
// `replaceAllTabs([], null)` that drives Home must NOT overwrite a project's
// stored tabs.
useTabsStore.subscribe(() => {
  const projectId = useWorkspaceStore.getState().activeProjectId
  if (projectId) snapshotProjectTabs(projectId)
})
