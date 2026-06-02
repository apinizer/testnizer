/**
 * #35 — Branch delete must pass the branch row id (not its name) to the IPC,
 * and must honor the result instead of always reporting success. Before the
 * fix the store passed the name (so the repo no-op'd by id lookup) yet still
 * returned { success: true }, so the UI said "deleted" while the branch stayed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBranchStore } from '../../src/renderer/stores/branch.store'

interface Mocks {
  del: ReturnType<typeof vi.fn>
  list: ReturnType<typeof vi.fn>
}

function installApi(delResult: { success: boolean; error?: string }): Mocks {
  const del = vi.fn(async () => delResult)
  const list = vi.fn(async () => ({ success: true, data: [] }))
  ;(globalThis as unknown as { window: { api: unknown } }).window = {
    api: {
      branch: { delete: del, list },
      git: { hasConfig: vi.fn(async () => ({ success: true, data: { hasGit: false } })) },
    },
  }
  return { del, list }
}

function seedFeatureBranch(): void {
  useBranchStore.setState({
    ...useBranchStore.getState(),
    hasGit: false,
    currentBranch: 'main',
    activeBranchId: 'main',
    branches: [
      { id: 'main-id', name: 'main', current: true, isRemote: false },
      { id: 'b1', name: 'feature', current: false, isRemote: false },
    ],
  })
}

describe('branch.store.deleteBranch (#35)', () => {
  beforeEach(seedFeatureBranch)

  it('passes the branch row id (not the name) and surfaces a failed delete', async () => {
    const { del } = installApi({ success: false, error: 'Cannot delete default branch' })
    const result = await useBranchStore.getState().deleteBranch('p1', 'feature')
    expect(del).toHaveBeenCalledWith('b1') // id, not "feature"
    expect(result.success).toBe(false)
    expect(result.error).toBe('Cannot delete default branch')
  })

  it('returns success and reloads the list on a real delete', async () => {
    const { del, list } = installApi({ success: true })
    const result = await useBranchStore.getState().deleteBranch('p1', 'feature')
    expect(del).toHaveBeenCalledWith('b1')
    expect(result.success).toBe(true)
    expect(list).toHaveBeenCalled() // fetchBranches ran
  })
})
