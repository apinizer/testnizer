/**
 * Stop addresses the run it was pressed on: the bridge call carries what the run
 * was STARTED with, so the store that drew the Stop button and main agree on which
 * run that is (issue #317 made several runs at once reachable). Main's side is in
 * `tests/main/handlers/runner-stop-target.test.ts`.
 */
import { allowScriptTrustBridge } from '../helpers/script-trust-bridge'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  liveRunKey,
  startLiveRun,
  stopLiveRun,
  useRunnerLiveStore,
} from '../../src/renderer/stores/runner-live.store'

const stop = vi.fn(async () => ({ success: true, data: true }))
const finishers: Array<() => void> = []

function begin(tabId: string, projectId: string): void {
  void startLiveRun({
    tabId,
    totalCount: 1,
    sourceLabel: tabId,
    origin: 'folder' as never,
    payload: { projectId, endpointIds: ['e'], runTabId: tabId } as never,
  })
}

beforeEach(() => {
  stop.mockClear()
  finishers.length = 0
  useRunnerLiveStore.setState({ runs: {} })
  ;(window as unknown as { api: unknown }).api = {
    projectTrust: allowScriptTrustBridge,
    runner: {
      stop,
      execute: () =>
        new Promise((resolve) => {
          finishers.push(() => resolve({ success: true, data: null }))
        }),
      onProgress: () => () => {},
      onPhase: () => () => {},
    },
  }
})
afterEach(() => {
  finishers.forEach((finish) => finish())
})

describe('stopLiveRun', () => {
  it('names the run, and marks only that tab as stopping', async () => {
    begin('tab-a', 'p1')
    begin('tab-b', 'p1')
    // A run takes its slot after the script trust answer, one round trip away.
    await vi.waitFor(() =>
      expect(useRunnerLiveStore.getState().runs[liveRunKey('tab-b')]).toBeDefined(),
    )

    stopLiveRun('tab-b', 'direct')

    expect(stop).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledWith({ mode: 'direct', runTabId: 'tab-b', projectId: 'p1' })
    const { runs } = useRunnerLiveStore.getState()
    expect(runs[liveRunKey('tab-b')].stopRequested).toBe('direct')
    expect(runs[liveRunKey('tab-a')].stopRequested).toBeNull()
  })

  it('says nothing to main when this tab has no run', () => {
    stopLiveRun('tab-idle', 'graceful')
    expect(stop).not.toHaveBeenCalled()
  })
})
