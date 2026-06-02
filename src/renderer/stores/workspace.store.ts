import { create } from 'zustand'
import type { Workspace, Project, TreeNode, Folder, Endpoint, SavedRequest, Tab } from '../types'
import { useEnvironmentStore } from './environment.store'
import { useBranchStore } from './branch.store'
import { useTabsStore } from './tabs.store'
import { useConsoleStore } from './console.store'

/**
 * Per-project open-tab snapshots (issue #1). Each project keeps its own set of
 * open tabs so switching projects no longer wipes them — the previous project's
 * tabs are stashed here and restored when you switch back. Module-level (not
 * persisted): it's session state, and only the active project's tabs round-trip
 * through the tabs store's own localStorage.
 */
const tabsByProject = new Map<string, { tabs: Tab[]; activeTabId: string | null }>()

function snapshotProjectTabs(projectId: string | null): void {
  if (!projectId) return
  const ts = useTabsStore.getState()
  tabsByProject.set(projectId, { tabs: ts.tabs, activeTabId: ts.activeTabId })
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
  setActiveNode: (id: string) => void
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
  renameProject: (id: string, newName: string) => Promise<void>
  updateProject: (
    id: string,
    data: {
      name?: string
      display_name?: string | null
      save_mode?: string
      local_path?: string | null
      icon_emoji?: string | null
      icon_color?: string | null
    },
  ) => Promise<void>
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

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  initialized: false,
  workspaces: [],
  activeWorkspaceId: null,
  projects: [],
  activeProjectId: null,
  openProjectIds: [],
  treeData: emptyTree(),
  openNodeIds: new Set(['default-module']),
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
      set({ openProjectIds: [] })
    }
    set({ activeWorkspaceId: id, activeProjectId: null })
  },

  setActiveProject: async (id) => {
    const prevId = get().activeProjectId
    // Per-project tabs (#1): instead of wiping tabs on switch, stash the
    // leaving project's tabs and restore the incoming project's. Console +
    // pending-conflict are still cleared (they're scoped to the old project).
    if (prevId && prevId !== id) {
      snapshotProjectTabs(prevId)
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

  setActiveNode: (id) => set({ activeNodeId: id }),
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
    try {
      await window.api?.project?.update(id, { display_name: newName })
      const wsId = get().activeWorkspaceId
      if (wsId) await get().fetchProjects(wsId)
    } catch {
      // IPC not available
    }
  },

  updateProject: async (id, data) => {
    try {
      await window.api?.project?.update(id, data)
      const wsId = get().activeWorkspaceId
      if (wsId) await get().fetchProjects(wsId)
    } catch {
      // IPC not available
    }
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
      set((s) => ({ openProjectIds: s.openProjectIds.filter((p) => p !== id) }))
      // If we just deleted the project we were viewing, drop all
      // project-scoped state (tabs / console / branch) so the UI stops
      // rendering against a dead row.
      if (get().activeProjectId === id) {
        resetProjectScopedState()
        set({ activeProjectId: null, treeData: emptyTree() })
      }
    } catch {
      // IPC not available
    }
  },

  goHome: () => {
    // Stash the current project's tabs so returning to it restores them (#1),
    // and clear the tab view while Home (ProjectHome) is shown.
    snapshotProjectTabs(get().activeProjectId)
    useTabsStore.getState().replaceAllTabs([], null)
    set({ activeProjectId: null })
  },

  closeProjectTab: (id) => {
    tabsByProject.delete(id)
    const wasActive = get().activeProjectId === id
    set((s) => ({ openProjectIds: s.openProjectIds.filter((p) => p !== id) }))
    if (wasActive) {
      // Fall back to another still-open project, else Home.
      const next = get().openProjectIds[0] ?? null
      if (next) {
        void get().setActiveProject(next)
      } else {
        useTabsStore.getState().replaceAllTabs([], null)
        set({ activeProjectId: null })
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
