/**
 * Deletes must not lie about what was deleted.
 *
 * The IPC bridge signals failure by RESOLVING `{success:false, error}` — it does
 * not throw. Every store below awaited the call inside a `try/catch` and then
 * mutated its own state, so a refused delete read exactly like a successful one:
 * the row vanished from the UI while it was still in the database, and came
 * back on the next launch with no explanation.
 *
 * These stores are deliberately UI-agnostic (not one of them imports `toast`),
 * so the honest outcome of a failure is to leave the row listed — which is what
 * the database still says.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const envDelete = vi.fn()
const globalDelete = vi.fn()
const historyDelete = vi.fn()
const historyClear = vi.fn()

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: Record<string, unknown> }
  if (!g.window) g.window = {}
})

import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useHistoryStore } from '../../src/renderer/stores/history.store'
import type { Environment, GlobalVariable, HistoryEntry } from '../../src/renderer/types'

const ENV = { id: 'e1', project_id: 'p1', name: 'Staging', is_active: false } as Environment
const GLOBAL = { id: 'g1', key: 'token', value: 'x' } as GlobalVariable
const ENTRY = { id: 'h1', method: 'GET', url: 'https://x.test' } as HistoryEntry

beforeEach(() => {
  envDelete.mockReset()
  globalDelete.mockReset()
  historyDelete.mockReset()
  historyClear.mockReset()
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    environment: { delete: envDelete },
    globalVariable: { delete: globalDelete },
    history: { delete: historyDelete, clear: historyClear },
  }
  useEnvironmentStore.setState({
    environments: [ENV],
    globalVariables: [GLOBAL],
    activeEnvironmentId: 'e1',
  })
  useHistoryStore.setState({ entries: [ENTRY] })
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('a refused delete leaves the record listed', () => {
  it('keeps the environment when the bridge reports failure', async () => {
    envDelete.mockResolvedValue({ success: false, error: 'FOREIGN KEY constraint failed' })

    await useEnvironmentStore.getState().deleteEnvironment('e1')

    // The bug: the row was filtered out BEFORE the await, so it disappeared
    // regardless — then reappeared on the next launch.
    expect(useEnvironmentStore.getState().environments).toHaveLength(1)
    expect(useEnvironmentStore.getState().activeEnvironmentId).toBe('e1')
  })

  it('keeps the global variable when the bridge reports failure', async () => {
    globalDelete.mockResolvedValue({ success: false, error: 'locked' })

    await useEnvironmentStore.getState().deleteGlobalVariable('g1')

    expect(useEnvironmentStore.getState().globalVariables).toHaveLength(1)
  })

  it('keeps history entries when clear is refused', async () => {
    historyClear.mockResolvedValue({ success: false, error: 'SQLITE_BUSY' })

    await useHistoryStore.getState().clear('w1')

    expect(useHistoryStore.getState().entries).toHaveLength(1)
  })

  it('keeps a history entry when its delete is refused', async () => {
    historyDelete.mockResolvedValue({ success: false, error: 'SQLITE_BUSY' })

    await useHistoryStore.getState().deleteEntry('h1')

    expect(useHistoryStore.getState().entries).toHaveLength(1)
  })

  it('treats a thrown rejection the same way', async () => {
    envDelete.mockRejectedValue(new Error('bridge went away'))

    await useEnvironmentStore.getState().deleteEnvironment('e1')

    expect(useEnvironmentStore.getState().environments).toHaveLength(1)
  })
})

describe('a confirmed delete removes the record', () => {
  it('drops the environment and clears the active selection', async () => {
    envDelete.mockResolvedValue({ success: true, data: true })

    await useEnvironmentStore.getState().deleteEnvironment('e1')

    expect(useEnvironmentStore.getState().environments).toEqual([])
    expect(useEnvironmentStore.getState().activeEnvironmentId).toBeNull()
  })

  it('drops the global variable', async () => {
    globalDelete.mockResolvedValue({ success: true, data: true })

    await useEnvironmentStore.getState().deleteGlobalVariable('g1')

    expect(useEnvironmentStore.getState().globalVariables).toEqual([])
  })

  it('empties the history list', async () => {
    historyClear.mockResolvedValue({ success: true, data: true })

    await useHistoryStore.getState().clear('w1')

    expect(useHistoryStore.getState().entries).toEqual([])
  })

  it('drops a single history entry', async () => {
    historyDelete.mockResolvedValue({ success: true, data: true })

    await useHistoryStore.getState().deleteEntry('h1')

    expect(useHistoryStore.getState().entries).toEqual([])
  })
})
