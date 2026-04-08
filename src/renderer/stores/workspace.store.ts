import { create } from 'zustand'
import type { Workspace, Project, TreeNode } from '../types'

interface WorkspaceStore {
  /** Whether initial data has been loaded from DB */
  initialized: boolean
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  projects: Project[]
  activeProjectId: string | null
  treeData: TreeNode[]
  openNodeIds: Set<string>
  activeNodeId: string | null
  searchQuery: string

  /** Initialize — load workspaces & projects from DB */
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
  createProject: (name: string, type: 'http' | 'grpc' | 'websocket') => Promise<string | null>
  deleteProject: (id: string) => Promise<void>
  /** Go back to the Home/project list screen */
  goHome: () => void
}

function defaultTree(): TreeNode[] {
  return [
    {
      id: 'default-module',
      type: 'module',
      label: 'Default module',
      icon: 'module',
      children: [
        {
          id: 'endpoints',
          type: 'folder',
          label: 'Endpoints',
          icon: 'endpoints',
          children: [],
        },
        {
          id: 'schemas',
          type: 'folder',
          label: 'Schemas',
          icon: 'schemas',
          children: [],
        },
        {
          id: 'components',
          type: 'folder',
          label: 'Components',
          icon: 'components',
          children: [],
        },
      ],
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
  treeData: defaultTree(),
  openNodeIds: new Set(['default-module', 'endpoints']),
  activeNodeId: null,
  searchQuery: '',

  initialize: async () => {
    if (get().initialized) return

    try {
      // Load workspaces
      const wsResult = await window.api?.workspace?.list()
      if (wsResult?.success && wsResult.data) {
        const workspaces = wsResult.data as Workspace[]
        set({ workspaces })

        if (workspaces.length > 0) {
          const wsId = workspaces[0].id
          set({ activeWorkspaceId: wsId })

          // Load projects for this workspace
          const projResult = await window.api?.project?.list(wsId)
          if (projResult?.success && projResult.data) {
            set({ projects: projResult.data as Project[] })
          }
        }
      }
    } catch {
      // IPC not available yet — will show empty state
    }

    set({ initialized: true })
  },

  setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),

  setActiveProject: (id) => set({ activeProjectId: id, treeData: defaultTree() }),

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
      // IPC not available yet
    }
  },

  createWorkspace: async (name, description) => {
    try {
      const result = await window.api?.workspace?.create({ name, description })
      if (result?.success) {
        await get().fetchWorkspaces()
      }
    } catch {
      // IPC not available yet
    }
  },

  fetchProjects: async (workspaceId) => {
    try {
      const result = await window.api?.project?.list(workspaceId)
      if (result?.success && result.data) {
        set({ projects: result.data as Project[] })
      }
    } catch {
      // IPC not available yet
    }
  },

  createProject: async (name, type) => {
    try {
      const wsId = get().activeWorkspaceId
      if (!wsId) return null
      const result = await window.api?.project?.create({ workspace_id: wsId, name, type })
      if (result?.success && result.data) {
        await get().fetchProjects(wsId)
        const created = result.data as Project
        return created.id
      }
    } catch {
      // IPC not available yet
    }
    return null
  },

  deleteProject: async (id) => {
    try {
      await window.api?.project?.delete(id)
      const wsId = get().activeWorkspaceId
      if (wsId) {
        await get().fetchProjects(wsId)
      }
      // If the deleted project was active, go home
      if (get().activeProjectId === id) {
        set({ activeProjectId: null })
      }
    } catch {
      // IPC not available
    }
  },

  goHome: () => set({ activeProjectId: null }),
}))
