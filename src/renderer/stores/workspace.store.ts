import { create } from 'zustand'
import type { Workspace, Project, TreeNode, Folder, Endpoint, SavedRequest } from '../types'
import { useEnvironmentStore } from './environment.store'

interface WorkspaceStore {
  initialized: boolean
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  projects: Project[]
  activeProjectId: string | null
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
  createProject: (name: string, type: 'http' | 'grpc' | 'websocket', saveMode?: string, localPath?: string, iconEmoji?: string, iconColor?: string) => Promise<string | null>
  renameProject: (id: string, newName: string) => Promise<void>
  updateProject: (id: string, data: { name?: string; save_mode?: string; local_path?: string | null; icon_emoji?: string | null; icon_color?: string | null }) => Promise<void>
  deleteProject: (id: string) => Promise<void>
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
    // Load folders
    const foldersResult = await window.api?.folder?.list(projectId) as { success: boolean; data?: FolderRow[] }
    const folders: FolderRow[] = foldersResult?.success && foldersResult.data ? foldersResult.data : []

    // Load endpoints
    const endpointsResult = await window.api?.endpoint?.listByProject(projectId) as { success: boolean; data?: EndpointRow[] }
    const endpoints: EndpointRow[] = endpointsResult?.success && endpointsResult.data ? endpointsResult.data : []

    // Load saved requests
    const savedResult = await window.api?.savedRequest?.list(projectId) as { success: boolean; data?: SavedRequestRow[] }
    const savedRequests: SavedRequestRow[] = savedResult?.success && savedResult.data ? savedResult.data : []

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

    // Quick Requests section
    const quickRequests: TreeNode = {
      id: 'quick-requests',
      type: 'module',
      label: 'Quick Requests',
      icon: 'quick',
      children: [],
    }

    return [projectNode, quickRequests]
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
    { id: 'quick-requests', type: 'module', label: 'Quick Requests', icon: 'quick', children: [] },
  ]
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  initialized: false,
  workspaces: [],
  activeWorkspaceId: null,
  projects: [],
  activeProjectId: null,
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

  setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),

  setActiveProject: async (id) => {
    set({ activeProjectId: id })
    // Reload environments/globals for the new scope
    await useEnvironmentStore.getState().setCurrentProject(id)
    if (!id) {
      set({ treeData: emptyTree() })
      // Reset accent color to default
      document.documentElement.style.removeProperty('--accent')
      document.documentElement.style.removeProperty('--accent-text')
      return
    }
    // Find project and apply its color
    const project = get().projects.find((p) => p.id === id)
    const projectName = project?.name || 'Project'
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

  createProject: async (name, type, saveMode, localPath, iconEmoji, iconColor) => {
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
      await window.api?.project?.update(id, { name: newName })
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
      if (get().activeProjectId === id) {
        set({ activeProjectId: null })
      }
    } catch {
      // IPC not available
    }
  },

  goHome: () => set({ activeProjectId: null }),

  refreshTree: async () => {
    const projectId = get().activeProjectId
    if (!projectId) return
    const project = get().projects.find((p) => p.id === projectId)
    const projectName = project?.name || 'Project'
    const tree = await buildTreeFromDB(projectId, projectName)
    // Preserve existing openNodeIds
    set({ treeData: tree })
  },
}))
