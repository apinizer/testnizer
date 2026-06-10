/**
 * Regression: after a folder/APIs run, RunnerTab must refresh the renderer env
 * store so a token captured by a post-response `pm.environment.set` shows up in
 * the env editor and resolves on the next Send. The main process persists the
 * value ("Keep variable values"); the RunnerTab execute path used to skip the
 * store refresh, so `{{accessToken}}` stayed empty until manually retyped.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const fetchEnvironments = vi.fn(async () => {})
const fetchGlobalVariables = vi.fn(async () => {})

vi.mock('../../src/renderer/stores/environment.store', () => ({
  useEnvironmentStore: {
    getState: () => ({ fetchEnvironments, fetchGlobalVariables }),
  },
}))

// RunnerTab pulls in many stores/components; we only exercise the exported
// helper, but the module must import cleanly under jsdom.
import { refreshEnvAfterRun } from '../../src/renderer/components/runner/RunnerTab'
import type { RunnerReport } from '../../src/renderer/stores/runner.store'

const baseReport = (over: Partial<RunnerReport>): RunnerReport =>
  ({
    projectId: 'p',
    startedAt: 0,
    completedAt: 0,
    totalEndpoints: 1,
    passedEndpoints: 1,
    failedEndpoints: 0,
    totalAssertions: 0,
    passedAssertions: 0,
    failedAssertions: 0,
    results: [],
    ...over,
  }) as unknown as RunnerReport

beforeEach(() => {
  fetchEnvironments.mockClear()
  fetchGlobalVariables.mockClear()
})

describe('refreshEnvAfterRun', () => {
  it('refreshes the env store when a script wrote an env var', async () => {
    await refreshEnvAfterRun(baseReport({ envUpdates: { accessToken: 'tok' } }), true)
    expect(fetchEnvironments).toHaveBeenCalledTimes(1)
    expect(fetchGlobalVariables).toHaveBeenCalledTimes(1)
  })

  it('refreshes when a global var was written', async () => {
    await refreshEnvAfterRun(baseReport({ globalUpdates: { g: '1' } }), true)
    expect(fetchEnvironments).toHaveBeenCalledTimes(1)
  })

  it('does nothing when no variables were written', async () => {
    await refreshEnvAfterRun(baseReport({ envUpdates: {}, globalUpdates: {} }), true)
    expect(fetchEnvironments).not.toHaveBeenCalled()
    expect(fetchGlobalVariables).not.toHaveBeenCalled()
  })

  it('respects keepVariableValues=false (side-effect-free run)', async () => {
    await refreshEnvAfterRun(baseReport({ envUpdates: { accessToken: 'tok' } }), false)
    expect(fetchEnvironments).not.toHaveBeenCalled()
  })

  it('tolerates an undefined report', async () => {
    await refreshEnvAfterRun(undefined, true)
    expect(fetchEnvironments).not.toHaveBeenCalled()
  })
})
