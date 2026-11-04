/**
 * QA finding on 1.6.0: start a run, open another tab, come back → the Runner
 * tab was blank while the Console kept scrolling.
 *
 * Workbench mounts only the ACTIVE tab, and every piece of a live run lived in
 * RunnerTab's useState: leaving the tab destroyed the progress subscription, the
 * Stop button and the run's end handling, while main kept running.
 *
 * The earlier tab-switch tests (issue #93 B, issue #66) never had a run in
 * flight: one came back to an idle tab, the other flipped `setRunnerBusy` by
 * hand. These hold `execute` open and walk the real Workbench away and back.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react'

vi.hoisted(() => {
  const ns = new Proxy(
    {},
    {
      get: (_t, p) =>
        p === 'then'
          ? undefined
          : typeof p === 'string' && p.startsWith('on')
            ? () => () => {}
            : () => Promise.resolve({ success: true, data: null }),
    },
  )
  const api = new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : ns) })
  const g = globalThis as unknown as { window?: { api?: unknown } }
  if (!g.window) g.window = {}
  g.window.api = api
})

const toastInfo = vi.hoisted(() => vi.fn())
vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { info: toastInfo, error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

import { mockWindowApi } from './screens/_mount'
import Workbench from '../../src/renderer/components/layout/Workbench'
import { openOrReuseRunnerTab } from '../../src/renderer/lib/open-runner-tab'
import { isRunnerBusy } from '../../src/renderer/lib/runner-activity'
import { useRunnerLiveStore } from '../../src/renderer/stores/runner-live.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import type { EndpointRunResult, RunnerReport } from '../../src/shared/runner-types'

const PROJECT = 'proj-1'
const TAB = 'runner-main'
const ITEMS = [
  { id: 'item-1', name: 'First request', method: 'GET', url: '/a', folder_id: null },
  { id: 'item-2', name: 'Second request', method: 'GET', url: '/b', folder_id: null },
]

function row(id: string, name: string): EndpointRunResult {
  return {
    endpointId: id,
    endpointName: name,
    method: 'GET',
    url: `http://x/${id}`,
    status: 200,
    statusText: 'OK',
    duration: 5,
    size: 1,
    assertions: [],
    consoleLogs: [],
    phase: 'main',
    iteration: 1,
  } as unknown as EndpointRunResult
}

function report(results: EndpointRunResult[]): RunnerReport {
  return {
    results,
    totalEndpoints: results.length,
    passedEndpoints: results.length,
    failedEndpoints: 0,
    startedAt: 1,
    completedAt: 2,
  } as unknown as RunnerReport
}

/** A runner bridge whose run stays open until the test ends it. */
function runnerBridge() {
  const progress = new Set<(p: unknown) => void>()
  const phase = new Set<(p: unknown) => void>()
  let finish: (r: unknown) => void = () => {}
  const execute = vi.fn(() => new Promise((resolve) => (finish = resolve)))
  const stop = vi.fn(() => Promise.resolve({ success: true, data: true }))
  mockWindowApi({
    runner: {
      execute,
      stop,
      onProgress: (cb: (p: unknown) => void) => {
        progress.add(cb)
        return () => progress.delete(cb)
      },
      onPhase: (cb: (p: unknown) => void) => {
        phase.add(cb)
        return () => phase.delete(cb)
      },
    },
    testSuite: {
      list: () => Promise.resolve({ success: true, data: [] }),
      listEndpoints: () => Promise.resolve({ success: true, data: { items: ITEMS, folders: [] } }),
      getRunConfig: () => Promise.resolve({ success: true, data: null }),
    },
  })
  return {
    execute,
    stop,
    subscribers: () => progress.size,
    emit: (current: number, r: EndpointRunResult, tag = { runTabId: TAB, projectId: PROJECT }) =>
      act(async () => {
        for (const cb of progress)
          cb({ current, total: 2, endpointId: r.endpointId, result: r, ...tag })
      }),
    finish: (rep: RunnerReport | null, error?: string) =>
      act(async () => {
        finish(error ? { success: false, error } : { success: true, data: rep })
      }),
  }
}

async function startRunFromConfig(): Promise<void> {
  await act(async () => {
    openOrReuseRunnerTab({ sourceType: 'suite', suiteId: 'suite-1', folderName: 'My Suite' })
  })
  fireEvent.click(await screen.findByTestId('runner-start'))
  await screen.findByTestId('runner-stop')
}

async function leaveAndReturn(whileAway?: () => Promise<void>): Promise<void> {
  const runnerTab = useTabsStore.getState().activeTabId!
  await act(async () => {
    useTabsStore.getState().openTab({ id: 'away', name: 'Away', protocol: 'http' })
  })
  expect(screen.queryByTestId('runner-results-list')).toBeNull()
  await whileAway?.()
  await act(async () => {
    useTabsStore.getState().setActiveTab(runnerTab)
  })
}

beforeEach(() => {
  sessionStorage.clear()
  useRunnerLiveStore.setState({ runs: {} })
  toastInfo.mockClear()
  useUIStore.getState().setLocale('en')
  useWorkspaceStore.setState({
    activeWorkspaceId: 'ws-1',
    activeProjectId: PROJECT,
    treeData: [],
    openNodeIds: new Set(),
    searchQuery: '',
  })
  useUIStore.setState({ activeSidebarPage: 'tests' })
  useTabsStore.setState({ tabs: [], activeTabId: null })
})

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

describe('a run in flight survives leaving its tab', () => {
  it('coming back shows the progress line, the rows so far and Stop — not a blank screen', async () => {
    const bridge = runnerBridge()
    render(<Workbench />)
    await startRunFromConfig()
    await bridge.emit(1, row('item-1', 'First request'))
    expect(screen.getByText('First request')).toBeTruthy()

    await leaveAndReturn()

    expect(screen.getByText('First request')).toBeTruthy()
    expect(screen.getByText(/Running 1 of 2/)).toBeTruthy()
    expect(screen.getByTestId('runner-stop')).toBeTruthy()
    expect(bridge.execute).toHaveBeenCalledTimes(1)
  })

  it('progress that arrives while away is on screen on return', async () => {
    const bridge = runnerBridge()
    render(<Workbench />)
    await startRunFromConfig()

    await leaveAndReturn(() => bridge.emit(1, row('item-1', 'First request')))

    expect(screen.getByText('First request')).toBeTruthy()
    await bridge.emit(2, row('item-2', 'Second request'))
    expect(screen.getByText('Second request')).toBeTruthy()
  })

  it('a run that finishes while away shows its final results on return', async () => {
    const bridge = runnerBridge()
    render(<Workbench />)
    await startRunFromConfig()

    const rows = [row('item-1', 'First request'), row('item-2', 'Second request')]
    await leaveAndReturn(async () => {
      await bridge.emit(1, rows[0])
      await bridge.emit(2, rows[1])
      await bridge.finish(report(rows))
    })

    expect(screen.getByText('Second request')).toBeTruthy()
    expect(screen.queryByTestId('runner-stop')).toBeNull()
    expect(isRunnerBusy(TAB)).toBe(false)
    expect(bridge.subscribers()).toBe(0)
  })

  it('Stop still works after coming back, and says it was clicked', async () => {
    const bridge = runnerBridge()
    render(<Workbench />)
    await startRunFromConfig()
    await leaveAndReturn()

    fireEvent.click(screen.getByTestId('runner-stop'))
    expect(bridge.stop).toHaveBeenCalledWith({ mode: 'graceful' })
  })

  it('stays busy while away, so a Run aimed at the tab focuses the run instead of re-arming it', async () => {
    const bridge = runnerBridge()
    render(<Workbench />)
    await startRunFromConfig()

    const sessionBefore = useTabsStore.getState().tabs.find((t) => t.id === TAB)?.sessionKey
    await act(async () => {
      useTabsStore.getState().openTab({ id: 'away', name: 'Away', protocol: 'http' })
    })
    expect(isRunnerBusy(TAB)).toBe(true)

    await act(async () => {
      openOrReuseRunnerTab({
        sourceType: 'suite',
        suiteId: 'suite-1',
        endpointIds: ['item-1'],
        autoRun: true,
      })
    })

    const tabs = useTabsStore.getState()
    expect(tabs.activeTabId).toBe(TAB)
    expect(tabs.tabs.find((t) => t.id === TAB)?.sessionKey).toBe(sessionBefore)
    expect(screen.getByTestId('runner-stop')).toBeTruthy()
    expect(bridge.execute).toHaveBeenCalledTimes(1)
    // Says why the click started nothing.
    expect(toastInfo).toHaveBeenCalledWith('A run is already in progress in this tab. Showing it.')
  })

  it('a Quick Run (autoRun) survives the trip too', async () => {
    const bridge = runnerBridge()
    render(<Workbench />)
    await act(async () => {
      openOrReuseRunnerTab({
        sourceType: 'suite',
        suiteId: 'suite-1',
        endpointIds: ['item-1', 'item-2'],
        autoRun: true,
        folderName: 'My Suite',
      })
    })
    await screen.findByTestId('runner-stop')
    await bridge.emit(1, row('item-1', 'First request'))

    await leaveAndReturn()

    expect(screen.getByText('First request')).toBeTruthy()
    expect(screen.getByTestId('runner-stop')).toBeTruthy()
  })
})

describe('progress goes to the run it belongs to', () => {
  it("ignores another tab's run and a scheduled run (no tab)", async () => {
    const bridge = runnerBridge()
    render(<Workbench />)
    await startRunFromConfig()

    await bridge.emit(1, row('other', 'From another tab'), {
      runTabId: 'runner-folder-b',
      projectId: PROJECT,
    })
    await bridge.emit(1, row('sched', 'From the scheduler'), {
      runTabId: undefined as unknown as string,
      projectId: PROJECT,
    })
    await bridge.emit(1, row('item-1', 'First request'))

    expect(screen.queryByText('From another tab')).toBeNull()
    expect(screen.queryByText('From the scheduler')).toBeNull()
    expect(screen.getByText('First request')).toBeTruthy()
  })

  it("project B's runner tab does not show project A's live run (same tab id)", async () => {
    runnerBridge()
    render(<Workbench />)
    await startRunFromConfig()
    expect(isRunnerBusy(TAB)).toBe(true)

    await act(async () => {
      useWorkspaceStore.setState({ activeProjectId: 'proj-2' })
    })
    expect(isRunnerBusy(TAB)).toBe(false)
  })
})

describe('the results view is never blank', () => {
  it('a run that fails to start says why', async () => {
    const bridge = runnerBridge()
    render(<Workbench />)
    await startRunFromConfig()
    await bridge.finish(null, 'No endpoints to run')

    await waitFor(() => expect(screen.getByTestId('runner-results-nothing')).toBeTruthy())
    expect(screen.getByText(/No endpoints to run/)).toBeTruthy()
  })

  it('a results view with no data (a reload lost the run) offers a new run', async () => {
    runnerBridge()
    sessionStorage.setItem(`runner-view-${PROJECT}-${TAB}`, 'results')
    render(<Workbench />)
    await act(async () => {
      useTabsStore.getState().openTab({ id: TAB, name: 'Runner', protocol: 'runner' })
    })
    expect(screen.getByTestId('runner-results-nothing')).toBeTruthy()
    fireEvent.click(screen.getByTestId('runner-results-new-run'))
    expect(await screen.findByTestId('runner-start')).toBeTruthy()
  })
})

describe('leaving the live run for another view', () => {
  it('Overview during a run offers the way back to it', async () => {
    runnerBridge()
    render(<Workbench />)
    await startRunFromConfig()

    await act(async () => {
      openOrReuseRunnerTab({ viewHome: true })
    })
    fireEvent.click(await screen.findByTestId('runner-live-banner'))
    expect(await screen.findByTestId('runner-stop')).toBeTruthy()
  })
})
