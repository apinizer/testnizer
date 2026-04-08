import { create } from 'zustand'
import type { Environment, GlobalVariable } from '../types'

interface EnvironmentStore {
  environments: Environment[]
  activeEnvironmentId: string | null
  globalVariables: GlobalVariable[]

  setActiveEnvironment: (id: string | null) => void
  fetchEnvironments: () => Promise<void>
  createEnvironment: (name: string) => Promise<void>
  updateEnvironment: (id: string, updates: Partial<Environment>) => Promise<void>
  deleteEnvironment: (id: string) => Promise<void>
  setGlobalVariables: (vars: GlobalVariable[]) => void
  getActiveVariables: () => Record<string, string>
}

export const useEnvironmentStore = create<EnvironmentStore>((set, get) => ({
  environments: [
    {
      id: 'env-1',
      workspace_id: 'w1',
      name: 'Production',
      is_active: true,
      variables: [
        {
          id: 'v1',
          key: 'baseUrl',
          value: 'https://api.example.com',
          enabled: true,
          secret: false,
        },
        {
          id: 'v2',
          key: 'token',
          value: 'eyJhbGciOiJSUzI1NiJ9...',
          enabled: true,
          secret: true,
        },
      ],
      created_at: Date.now(),
      updated_at: Date.now(),
    },
    {
      id: 'env-2',
      workspace_id: 'w1',
      name: 'Staging',
      is_active: false,
      variables: [
        {
          id: 'v3',
          key: 'baseUrl',
          value: 'https://staging.example.com',
          enabled: true,
          secret: false,
        },
      ],
      created_at: Date.now(),
      updated_at: Date.now(),
    },
  ],
  activeEnvironmentId: 'env-1',
  globalVariables: [],

  setActiveEnvironment: (id) => set({ activeEnvironmentId: id }),

  fetchEnvironments: async () => {
    try {
      const wsId = get().environments[0]?.workspace_id || 'w1'
      const result = await window.api?.environment?.list(wsId)
      if (result?.success && result.data) {
        set({ environments: result.data as Environment[] })
      }
    } catch {
      // IPC not available yet — use defaults
    }
  },

  createEnvironment: async (name) => {
    try {
      const wsId = get().environments[0]?.workspace_id || 'w1'
      const result = await window.api?.environment?.create({ workspace_id: wsId, name })
      if (result?.success) {
        await get().fetchEnvironments()
      }
    } catch {
      // IPC not available yet
    }
  },

  updateEnvironment: async (id, updates) => {
    try {
      const result = await window.api?.environment?.update(id, updates)
      if (result?.success) {
        await get().fetchEnvironments()
      }
    } catch {
      // Update locally
      set((state) => ({
        environments: state.environments.map((e) =>
          e.id === id ? { ...e, ...updates, updated_at: Date.now() } : e
        ),
      }))
    }
  },

  deleteEnvironment: async (id) => {
    try {
      const result = await window.api?.environment?.delete(id)
      if (result?.success) {
        await get().fetchEnvironments()
      }
    } catch {
      set((state) => ({
        environments: state.environments.filter((e) => e.id !== id),
        activeEnvironmentId:
          state.activeEnvironmentId === id ? null : state.activeEnvironmentId,
      }))
    }
  },

  setGlobalVariables: (vars) => set({ globalVariables: vars }),

  getActiveVariables: () => {
    const state = get()
    const vars: Record<string, string> = {}
    state.globalVariables.forEach((v) => {
      if (v.enabled) vars[v.key] = v.value
    })
    const env = state.environments.find((e) => e.id === state.activeEnvironmentId)
    if (env) {
      env.variables.forEach((v) => {
        if (v.enabled) vars[v.key] = v.value
      })
    }
    return vars
  },
}))
