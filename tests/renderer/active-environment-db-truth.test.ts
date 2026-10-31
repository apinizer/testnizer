/**
 * The active environment the UI shows is the one the DATABASE has active
 * (follow-up to issue #307).
 *
 * Send resolves `{{var}}` from the renderer store's `activeEnvironmentId`; Run,
 * Mock and Scheduler resolve from the project's `is_active = 1` row in main
 * (`runner.handler.ts` / `env-vars.ts`). The store used to fall back to the
 * FIRST environment when no row was active, so the header, the footer, the
 * environment modal ("Active" badge, Set Active hidden) and Send all said
 * "Staging" while every run used no environment at all — the screen tour's
 * suite run reported "No environment" with Staging visibly active.
 *
 * The reverse was the same bug: choosing "No environment" in the header only
 * cleared the store, so Send used none while Run kept the stale DB-active one.
 *
 * Contract: the store mirrors `is_active` exactly (no first-environment
 * fallback), and every change of the active environment — including "none" —
 * is persisted through `environment:setActiveForProject`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'

const PROJECT = 'p1'

interface Row {
  id: string
  workspace_id: string
  project_id: string
  name: string
  is_active: number
  created_at: number
  updated_at: number
}

function row(id: string, name: string, active: boolean): Row {
  return {
    id,
    workspace_id: 'w1',
    project_id: PROJECT,
    name,
    is_active: active ? 1 : 0,
    created_at: 1,
    updated_at: 1,
  }
}

let rows: Row[] = []
const setActiveForProject = vi.fn(async () => ({ success: true, data: true }))

beforeEach(() => {
  rows = []
  setActiveForProject.mockClear()
  ;(window as unknown as { api: unknown }).api = {
    environment: {
      listByProject: vi.fn(async () => ({ success: true, data: rows })),
      setActiveForProject,
    },
    envVariable: { list: vi.fn(async () => ({ success: true, data: [] })) },
    globalVariable: { listByProject: vi.fn(async () => ({ success: true, data: [] })) },
  }
  useEnvironmentStore.setState({
    environments: [],
    activeEnvironmentId: null,
    globalVariables: [],
    currentProjectId: null,
  })
})

describe('active environment = the DB is_active row', () => {
  it('no row active in the DB: the store shows no active environment (no first-env fallback)', async () => {
    rows = [row('e1', 'Staging', false), row('e2', 'Prod', false)]
    await useEnvironmentStore.getState().setCurrentProject(PROJECT)
    const s = useEnvironmentStore.getState()
    expect(s.environments.map((e) => e.name)).toEqual(['Staging', 'Prod'])
    expect(s.activeEnvironmentId).toBeNull()
    expect(s.environments.every((e) => !e.is_active)).toBe(true)
  })

  it('the DB-active row is the active environment', async () => {
    rows = [row('e1', 'Staging', false), row('e2', 'Prod', true)]
    await useEnvironmentStore.getState().setCurrentProject(PROJECT)
    expect(useEnvironmentStore.getState().activeEnvironmentId).toBe('e2')
  })

  it('choosing an environment persists it for the project', async () => {
    rows = [row('e1', 'Staging', false)]
    await useEnvironmentStore.getState().setCurrentProject(PROJECT)
    await useEnvironmentStore.getState().setActiveEnvironment('e1')
    expect(setActiveForProject).toHaveBeenCalledWith(PROJECT, 'e1')
    expect(useEnvironmentStore.getState().activeEnvironmentId).toBe('e1')
  })

  it('choosing "No environment" persists the clear, so Run stops using the old one', async () => {
    rows = [row('e1', 'Staging', true)]
    await useEnvironmentStore.getState().setCurrentProject(PROJECT)
    expect(useEnvironmentStore.getState().activeEnvironmentId).toBe('e1')
    await useEnvironmentStore.getState().setActiveEnvironment(null)
    expect(setActiveForProject).toHaveBeenCalledWith(PROJECT, null)
    expect(useEnvironmentStore.getState().activeEnvironmentId).toBeNull()
  })
})
