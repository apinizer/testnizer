import { create } from 'zustand'
import type { Environment, GlobalVariable, EnvironmentVariable } from '../types'
import { useWorkspaceStore } from './workspace.store'

/**
 * Environment + Globals store — **per-project scope**.
 *
 * Postman maintains a workspace-wide environments list, but Testnizer scopes
 * these per project so projects can have their own baseUrl / tokens without
 * cross-pollution. `currentProjectId` drives which environments are loaded.
 *
 * Each variable tracks **two values**: an `initialValue` (persisted, shared
 * when exported) and a `value` (current session value, can be overwritten
 * by scripts). This matches Postman's "initial vs current" dual-value model.
 */
interface EnvironmentStore {
  environments: Environment[]
  activeEnvironmentId: string | null
  globalVariables: GlobalVariable[]
  currentProjectId: string | null

  /** Scope environment/global variable operations to a project. */
  setCurrentProject: (projectId: string | null) => Promise<void>

  setActiveEnvironment: (id: string | null) => Promise<void>
  fetchEnvironments: () => Promise<void>
  fetchGlobalVariables: () => Promise<void>
  createEnvironment: (name: string) => Promise<void>
  updateEnvironment: (id: string, updates: Partial<Environment>) => Promise<void>
  deleteEnvironment: (id: string) => Promise<void>
  addGlobalVariable: (v: Partial<GlobalVariable>) => Promise<void>
  updateGlobalVariable: (id: string, updates: Partial<GlobalVariable>) => Promise<void>
  deleteGlobalVariable: (id: string) => Promise<void>
  setGlobalVariables: (vars: GlobalVariable[]) => void
  /**
   * Persist `pm.environment.set(...)` / `pm.globals.set(...)` calls made by a
   * post-response script. Upserts each entry into the active environment (or
   * globals) so subsequent requests in the same workspace pick up the values.
   * Performs a single round-trip per variable through the existing IPC layer
   * — adequate for the 1–N writes a script typically does.
   */
  applyScriptUpdates: (
    envUpdates: Record<string, string>,
    globalUpdates: Record<string, string>,
  ) => Promise<void>
  /**
   * Resolve active variables (globals first, then active env — env wins).
   * Uses `value` (current), falling back to `initialValue` when current is
   * empty.
   */
  getActiveVariables: () => Record<string, string>
}

function v(ev: { value?: string; initialValue?: string }): string {
  return ev.value && ev.value.length > 0 ? ev.value : ev.initialValue || ''
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/**
 * Map a raw `environment_variables`/`global_variables` DB row (snake_case,
 * numeric bools) into the UI model (`initialValue`, boolean `enabled`,
 * boolean `secret`).
 *
 * This used to be missing, which is why Globals loaded with empty Initial
 * Value columns and checkbox toggles acted funny.
 */
interface RawVarRow {
  id: string
  workspace_id?: string
  environment_id?: string
  key: string
  value: string
  description?: string | null
  enabled: number | boolean
  secret: number | boolean
  initial_value?: string | null
}

function rowToEnvVar(row: RawVarRow): EnvironmentVariable {
  return {
    id: row.id,
    key: row.key,
    value: row.value,
    initialValue: row.initial_value ?? '',
    description: row.description ?? undefined,
    enabled: !!row.enabled,
    secret: !!row.secret,
  }
}

function rowToGlobalVar(row: RawVarRow): GlobalVariable {
  return {
    id: row.id,
    workspace_id: row.workspace_id ?? 'default',
    key: row.key,
    value: row.value,
    initialValue: row.initial_value ?? '',
    description: row.description ?? undefined,
    enabled: !!row.enabled,
    secret: !!row.secret,
  }
}

interface RawEnvRow {
  id: string
  workspace_id: string
  project_id?: string | null
  name: string
  is_active: number | boolean
  created_at: number
  updated_at: number
}

function rowToEnv(row: RawEnvRow, variables: EnvironmentVariable[]): Environment {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    name: row.name,
    is_active: !!row.is_active,
    variables,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export const useEnvironmentStore = create<EnvironmentStore>((set, get) => ({
  environments: [],
  activeEnvironmentId: null,
  globalVariables: [],
  currentProjectId: null,

  setCurrentProject: async (projectId) => {
    set({
      currentProjectId: projectId,
      environments: [],
      globalVariables: [],
      activeEnvironmentId: null,
    })
    if (projectId) {
      // Independent fetches — run in parallel to halve setCurrentProject latency.
      await Promise.all([get().fetchEnvironments(), get().fetchGlobalVariables()])
    }
  },

  setActiveEnvironment: async (id) => {
    const projectId = get().currentProjectId
    set((state) => ({
      activeEnvironmentId: id,
      environments: state.environments.map((e) => ({ ...e, is_active: e.id === id })),
    }))
    if (projectId && id) {
      try {
        await window.api?.environment?.setActiveForProject(projectId, id)
      } catch {
        /* ignore */
      }
    }
  },

  fetchEnvironments: async () => {
    const projectId = get().currentProjectId
    if (!projectId) return
    try {
      const result = (await window.api?.environment?.listByProject(projectId)) as {
        success: boolean
        data?: RawEnvRow[]
      }
      if (result?.success && result.data) {
        const rows = result.data
        // Hydrate nested variables by calling envVariable:list for each env.
        // Raw rows are in snake_case / numeric bools — map them to UI models.
        const hydrated: Environment[] = await Promise.all(
          rows.map(async (row) => {
            try {
              const vr = (await window.api?.envVariable?.list(row.id)) as {
                success: boolean
                data?: RawVarRow[]
              }
              const vars = vr?.success && vr.data ? vr.data.map(rowToEnvVar) : []
              return rowToEnv(row, vars)
            } catch {
              return rowToEnv(row, [])
            }
          }),
        )
        const active = hydrated.find((e) => e.is_active)?.id || hydrated[0]?.id || null
        set({ environments: hydrated, activeEnvironmentId: active })
      }
    } catch {
      // IPC not available — keep empty
    }
  },

  fetchGlobalVariables: async () => {
    const projectId = get().currentProjectId
    if (!projectId) return
    try {
      const result = (await window.api?.globalVariable?.listByProject(projectId)) as {
        success: boolean
        data?: RawVarRow[]
      }
      if (result?.success && result.data) {
        set({ globalVariables: result.data.map(rowToGlobalVar) })
      }
    } catch {
      // IPC not available
    }
  },

  createEnvironment: async (name) => {
    const projectId = get().currentProjectId
    if (!projectId) {
      console.warn('[environment.store] createEnvironment: no active project')
      return
    }
    // workspace_id is required by the DB schema (FK to workspaces.id). Derive
    // it from the active workspace — using a placeholder like 'default' fails
    // the FK check and the create silently no-ops. Fall back to the first
    // existing env's workspace_id as a secondary source.
    const wsId =
      useWorkspaceStore.getState().activeWorkspaceId || get().environments[0]?.workspace_id || null
    if (!wsId) {
      console.warn('[environment.store] createEnvironment: no active workspace')
      return
    }
    try {
      const result = (await window.api?.environment?.create({
        workspace_id: wsId,
        project_id: projectId,
        name,
        is_active: get().environments.length === 0,
      })) as { success: boolean; data?: RawEnvRow; error?: string }
      if (result?.success && result.data) {
        const created = rowToEnv(result.data, [])
        set((state) => ({
          environments: [...state.environments, created],
          activeEnvironmentId:
            state.environments.length === 0 ? created.id : state.activeEnvironmentId,
        }))
      } else if (result?.error) {
        console.error('[environment.store] createEnvironment failed:', result.error)
      }
    } catch (e) {
      console.error('[environment.store] createEnvironment error:', e)
    }
  },

  updateEnvironment: async (id, updates) => {
    // Snapshot existing vars before optimistic update so we can diff against
    // the incoming variables array.
    const prevEnv = get().environments.find((e) => e.id === id)
    const prevVars = prevEnv?.variables || []

    // Optimistic local update
    set((state) => ({
      environments: state.environments.map((e) =>
        e.id === id ? { ...e, ...updates, updated_at: Date.now() } : e,
      ),
    }))
    try {
      const { variables: nextVars, ...rest } = updates as Partial<Environment> & {
        variables?: EnvironmentVariable[]
      }
      // Persist basic env fields (name / is_active)
      if (Object.keys(rest).length > 0) {
        await window.api?.environment?.update(id, rest as { name?: string; is_active?: boolean })
      }
      // Per-variable sync: create new rows, update existing, delete missing.
      if (nextVars) {
        const prevIds = new Set(prevVars.map((v) => v.id))
        const nextIds = new Set(nextVars.map((v) => v.id))

        // Deleted
        for (const pv of prevVars) {
          if (!nextIds.has(pv.id)) {
            try {
              await window.api?.envVariable?.delete(pv.id)
            } catch {
              /* ignore */
            }
          }
        }
        // Created / updated
        for (const nv of nextVars) {
          if (!prevIds.has(nv.id)) {
            // New — create in DB, swap local id for DB id
            try {
              const res = (await window.api?.envVariable?.create({
                environment_id: id,
                key: nv.key,
                value: nv.value,
                initial_value: nv.initialValue,
                enabled: nv.enabled,
                secret: nv.secret,
                description: nv.description,
              })) as { success: boolean; data?: RawVarRow }
              if (res?.success && res.data) {
                const created = rowToEnvVar(res.data)
                set((state) => ({
                  environments: state.environments.map((e) =>
                    e.id === id
                      ? {
                          ...e,
                          variables: e.variables.map((v2) => (v2.id === nv.id ? created : v2)),
                        }
                      : e,
                  ),
                }))
              }
            } catch {
              /* keep local */
            }
          } else {
            const pv = prevVars.find((p) => p.id === nv.id)!
            const changed =
              pv.key !== nv.key ||
              pv.value !== nv.value ||
              pv.initialValue !== nv.initialValue ||
              pv.enabled !== nv.enabled ||
              pv.secret !== nv.secret ||
              pv.description !== nv.description
            if (changed) {
              try {
                // Handler expects snake_case `initial_value`; coerce through unknown.
                const payload = {
                  key: nv.key,
                  value: nv.value,
                  initial_value: nv.initialValue,
                  enabled: nv.enabled,
                  secret: nv.secret,
                  description: nv.description,
                } as unknown as Partial<EnvironmentVariable>
                await window.api?.envVariable?.update(nv.id, payload)
              } catch {
                /* keep local */
              }
            }
          }
        }
      }
    } catch {
      // already updated locally
    }
  },

  deleteEnvironment: async (id) => {
    set((state) => ({
      environments: state.environments.filter((e) => e.id !== id),
      activeEnvironmentId: state.activeEnvironmentId === id ? null : state.activeEnvironmentId,
    }))
    try {
      await window.api?.environment?.delete(id)
    } catch {
      /* ignore */
    }
  },

  addGlobalVariable: async (variable) => {
    const projectId = get().currentProjectId
    // Use the real active workspace id — 'default' fails FK
    const wsId =
      useWorkspaceStore.getState().activeWorkspaceId || get().globalVariables[0]?.workspace_id || ''
    const tempId = newId()
    const newVar: GlobalVariable = {
      id: tempId,
      workspace_id: wsId,
      key: variable.key || '',
      value: variable.value || '',
      initialValue: variable.initialValue || variable.value || '',
      enabled: variable.enabled !== false,
      secret: !!variable.secret,
      description: variable.description,
    }
    // Optimistic local insert
    set((state) => ({ globalVariables: [...state.globalVariables, newVar] }))
    if (projectId) {
      try {
        const res = (await window.api?.globalVariable?.create({
          workspace_id: wsId,
          project_id: projectId,
          key: newVar.key,
          value: newVar.value,
          initial_value: newVar.initialValue,
          enabled: newVar.enabled,
          secret: newVar.secret,
          description: newVar.description,
        })) as { success: boolean; data?: RawVarRow }
        if (res?.success && res.data) {
          // Swap temp row for DB row (so subsequent edits use real id)
          const created = rowToGlobalVar(res.data)
          set((state) => ({
            globalVariables: state.globalVariables.map((g) => (g.id === tempId ? created : g)),
          }))
        }
      } catch {
        /* keep local */
      }
    }
  },

  updateGlobalVariable: async (id, updates) => {
    set((state) => ({
      globalVariables: state.globalVariables.map((v) => (v.id === id ? { ...v, ...updates } : v)),
    }))
    try {
      await window.api?.globalVariable?.update(id, {
        key: updates.key,
        value: updates.value,
        initial_value: updates.initialValue,
        enabled: updates.enabled,
        secret: updates.secret,
        description: updates.description,
      })
    } catch (_err) {
      /* keep local */
    }
  },

  deleteGlobalVariable: async (id) => {
    set((state) => ({ globalVariables: state.globalVariables.filter((g) => g.id !== id) }))
    try {
      await window.api?.globalVariable?.delete(id)
    } catch {
      /* ignore */
    }
  },

  setGlobalVariables: (vars) => set({ globalVariables: vars }),

  applyScriptUpdates: async (envUpdates, globalUpdates) => {
    const envEntries = Object.entries(envUpdates)
    const globalEntries = Object.entries(globalUpdates)
    if (envEntries.length === 0 && globalEntries.length === 0) return

    // ── Active environment writes ──────────────────────────
    if (envEntries.length > 0) {
      const state = get()
      const activeEnv = state.environments.find((e) => e.id === state.activeEnvironmentId)
      if (activeEnv) {
        const nextVars: EnvironmentVariable[] = activeEnv.variables.map((ev) => ({ ...ev }))
        for (const [key, value] of envEntries) {
          const existing = nextVars.find((ev) => ev.key === key)
          if (existing) {
            existing.value = value
          } else {
            nextVars.push({
              id: newId(),
              key,
              value,
              enabled: true,
              secret: false,
            })
          }
        }
        // Optimistic local update
        set((s) => ({
          environments: s.environments.map((e) =>
            e.id === activeEnv.id ? { ...e, variables: nextVars, updated_at: Date.now() } : e,
          ),
        }))
        // Persist: per-row create / update so we don't churn the whole list
        for (const [key, value] of envEntries) {
          const existing = activeEnv.variables.find((ev) => ev.key === key)
          try {
            if (existing) {
              await window.api?.envVariable?.update(existing.id, { value })
            } else {
              await window.api?.envVariable?.create({
                environment_id: activeEnv.id,
                key,
                value,
                enabled: true,
                secret: false,
              })
            }
          } catch (e) {
            console.error('[environment.store] applyScriptUpdates env write failed:', e)
          }
        }
      }
    }

    // ── Globals writes ────────────────────────────────────
    for (const [key, value] of globalEntries) {
      const existing = get().globalVariables.find((gv) => gv.key === key)
      try {
        if (existing) {
          await get().updateGlobalVariable(existing.id, { value })
        } else {
          await get().addGlobalVariable({ key, value, enabled: true, secret: false })
        }
      } catch (e) {
        console.error('[environment.store] applyScriptUpdates global write failed:', e)
      }
    }
  },

  getActiveVariables: () => {
    const state = get()
    const vars: Record<string, string> = {}
    state.globalVariables.forEach((gv) => {
      if (gv.enabled) vars[gv.key] = v(gv)
    })
    const env = state.environments.find((e) => e.id === state.activeEnvironmentId)
    if (env) {
      env.variables.forEach((ev) => {
        if (ev.enabled) vars[ev.key] = v(ev)
      })
    }
    return vars
  },
}))
