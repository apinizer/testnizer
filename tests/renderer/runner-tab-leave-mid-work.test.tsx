/**
 * RunnerTab unmounts whenever another tab is on screen, so what the user asked
 * for has to survive the trip:
 *
 *   - a Quick Run that has not started yet (its endpoints are still loading)
 *     starts on return, once;
 *   - a past report inspected while a run is going stays on screen on return,
 *     and the run stays one click away.
 *
 * Both hold the work open across the switch. Returning to an idle tab proves
 * nothing.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

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

vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

import { mockWindowApi } from './screens/_mount'
import Workbench from '../../src/renderer/components/layout/Workbench'
import { openOrReuseRunnerTab } from '../../src/renderer/lib/open-runner-tab'
import { useRunnerLiveStore } from '../../src/renderer/stores/runner-live.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import type { EndpointRunResult } from '../../src/shared/runner-types'

const PROJECT = 'proj-1'
const TAB = 'runner-main'
const ITEMS = [
  { id: 'item-1', name: 'First request', method: 'GET', url: '/a', folder_id: null },
  { id: 'item-2', name: 'Second request', method: 'GET', url: '/b', folder_id: null },
]
const QUICK_RUN = {
  sourceType: 'suite',
  suiteId: 'suite-1',
  endpointIds: ['item-1', 'item-2'],
  autoRun: true,
  folderName: 'My Suite',
}

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

/** A run bridge whose run stays open and whose suite load can be held. */
function bridge(opts: { holdEndpoints?: boolean; emptyFirst?: boolean } = {}) {
  const progress = new Set<(p: unknown) => void>()
  let release: () => void = () => {}
  let hold = opts.holdEndpoints ?? false
  let items = opts.emptyFirst ? [] : ITEMS
  const opened = new Promise<void>((r) => (release = r))
  const execute = vi.fn(() => new Promise(() => {}))
  const listEndpoints = vi.fn(async () => {
    if (hold) await opened
    return { success: true, data: { items, folders: [] } }
  })
  mockWindowApi({
    runner: {
      execute,
      stop: () => Promise.resolve({ success: true, data: true }),
      onProgress: (cb: (p: unknown) => void) => {
        progress.add(cb)
        return () => progress.delete(cb)
      },
      onPhase: () => () => {},
      history: () =>
        Promise.resolve({
          success: true,
          data: {
            rows: [
              {
                id: 'old-run',
                project_id: PROJECT,
                environment_name: null,
                source: 'runner',
                source_label: 'Suite: Older suite',
                iterations: 1,
                duration_ms: 10,
                total_endpoints: 1,
                passed_endpoints: 1,
                failed_endpoints: 0,
                total_tests: 0,
                passed_tests: 0,
                failed_tests: 0,
                skipped_tests: 0,
                avg_resp_time: 5,
                results_json: JSON.stringify([row('old-1', 'Row of the older report')]),
                started_at: 1000,
              },
            ],
            total: 1,
          },
        }),
    },
    testSuite: {
      list: () => Promise.resolve({ success: true, data: [] }),
      listEndpoints,
      getRunConfig: () => Promise.resolve({ success: true, data: null }),
    },
  })
  return {
    execute,
    listEndpoints,
    fillSuite: () => {
      items = ITEMS
    },
    releaseEndpoints: () =>
      act(async () => {
        hold = false
        release()
      }),
    emit: (current: number, r: EndpointRunResult) =>
      act(async () => {
        for (const cb of progress)
          cb({
            current,
            total: 2,
            endpointId: r.endpointId,
            result: r,
            runTabId: TAB,
            projectId: PROJECT,
          })
      }),
  }
}

async function leave(): Promise<void> {
  await act(async () => {
    useTabsStore.getState().openTab({ id: 'away', name: 'Away', protocol: 'http' })
  })
}

async function comeBack(): Promise<void> {
  await act(async () => {
    useTabsStore.getState().setActiveTab(TAB)
  })
}

beforeEach(() => {
  sessionStorage.clear()
  useRunnerLiveStore.setState({ runs: {} })
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

describe('a Quick Run that has not started yet', () => {
  it('leaving while its endpoints load: it starts on return, once', async () => {
    const b = bridge({ holdEndpoints: true })
    render(<Workbench />)
    await act(async () => {
      openOrReuseRunnerTab(QUICK_RUN)
    })
    await waitFor(() => expect(b.listEndpoints).toHaveBeenCalled())
    expect(b.execute).not.toHaveBeenCalled()

    await leave()
    await b.releaseEndpoints()
    expect(b.execute).not.toHaveBeenCalled()

    await comeBack()
    await screen.findByTestId('runner-stop')
    expect(b.execute).toHaveBeenCalledTimes(1)

    // A second trip does not start it again.
    await leave()
    await comeBack()
    await new Promise((r) => setTimeout(r, 150))
    expect(b.execute).toHaveBeenCalledTimes(1)
  })

  it('a suite that loaded empty is over: items added later do not start a run on return', async () => {
    const b = bridge({ emptyFirst: true })
    render(<Workbench />)
    await act(async () => {
      openOrReuseRunnerTab(QUICK_RUN)
    })
    await waitFor(() => expect(b.listEndpoints).toHaveBeenCalled())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    await leave()
    b.fillSuite()
    await comeBack()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200))
    })

    expect(b.listEndpoints.mock.calls.length).toBeGreaterThan(1)
    expect(b.execute).not.toHaveBeenCalled()
  })

  it('leaving in the moment after its endpoints loaded: it still starts, once', async () => {
    const b = bridge()
    render(<Workbench />)
    await act(async () => {
      openOrReuseRunnerTab(QUICK_RUN)
    })
    await leave()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200))
    })
    await comeBack()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200))
    })
    expect(b.execute).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('runner-stop')).toBeTruthy()
  })
})

describe('a past report inspected while a run is going', () => {
  async function inspectOlderReport(): Promise<ReturnType<typeof bridge>> {
    const b = bridge()
    render(<Workbench />)
    await act(async () => {
      openOrReuseRunnerTab({ sourceType: 'suite', suiteId: 'suite-1', folderName: 'My Suite' })
    })
    fireEvent.click(await screen.findByTestId('runner-start'))
    await screen.findByTestId('runner-stop')
    await b.emit(1, row('item-1', 'Live row'))
    expect(screen.getByText('Live row')).toBeTruthy()

    await act(async () => {
      openOrReuseRunnerTab({ viewAllRuns: true })
    })
    fireEvent.click(await screen.findByTestId('runner-history-row'))
    await screen.findByText('Row of the older report')
    return b
  }

  it('is still on screen after leaving and returning, not the live run', async () => {
    await inspectOlderReport()

    await leave()
    await comeBack()

    expect(screen.getByText('Row of the older report')).toBeTruthy()
    expect(screen.queryByText('Live row')).toBeNull()
    expect(screen.getByText('Suite: Older suite')).toBeTruthy()
  })

  it('progress while away stays out of it, and the banner leads back to the run', async () => {
    const b = await inspectOlderReport()

    await leave()
    await b.emit(2, row('item-2', 'Second live row'))
    await comeBack()

    expect(screen.getByText('Row of the older report')).toBeTruthy()
    expect(screen.queryByText('Second live row')).toBeNull()

    fireEvent.click(screen.getByTestId('runner-live-banner'))
    expect(await screen.findByText('Second live row')).toBeTruthy()
    expect(screen.queryByText('Row of the older report')).toBeNull()

    // Back on the run: another trip keeps the run on screen.
    await leave()
    await comeBack()
    expect(screen.getByText('Second live row')).toBeTruthy()
  })
})
