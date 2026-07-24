/**
 * issue #66 — Starting a run on a SECOND folder while a previous run-results
 * tab is open must land on THAT folder's Start-run screen.
 *
 * Both folder runs render through Workbench's single `protocol === 'runner'`
 * branch, so without a React `key` the two tabs share ONE RunnerTab instance:
 * the tab bar shows folder B's name while the content pane still shows folder
 * A's results (same duration / test counts). Closing every run tab first
 * "fixed" it only because that forced a remount.
 *
 * These tests drive the REAL Workbench so the keying itself is under test.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'

// Stores read `window.api.<ns>` at module-eval time; a permissive bridge must
// exist before the import graph below is hoisted (mirrors screens/_mount).
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

// Monaco can't run in jsdom — RunnerResults shows response bodies through it.
vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

import { mockWindowApi } from './screens/_mount'
import Workbench from '../../src/renderer/components/layout/Workbench'
import { openFolderRunner, openOrReuseRunnerTab } from '../../src/renderer/lib/open-runner-tab'
import { setRunnerBusy, resetRunnerActivity } from '../../src/renderer/lib/runner-activity'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import type { TreeNode, Tab } from '../../src/renderer/types'
import type { RunnerReport } from '../../src/renderer/stores/runner.store'

const ALPHA_RESULT = 'Alpha result row'
const BETA_ENDPOINT = 'Beta endpoint'

function tree(): TreeNode[] {
  return [
    {
      id: 'default-module',
      type: 'module',
      label: 'Default module',
      children: [
        {
          id: 'folder-a',
          type: 'folder',
          label: 'Folder A',
          children: [
            { id: 'ep-a1', type: 'endpoint', label: 'Alpha endpoint', method: 'GET', path: '/a' },
          ],
        },
        {
          id: 'folder-b',
          type: 'folder',
          label: 'Folder B',
          children: [
            { id: 'ep-b1', type: 'endpoint', label: BETA_ENDPOINT, method: 'POST', path: '/b' },
          ],
        },
      ],
    },
  ]
}

function runnerTab(id: string, name: string, folderId: string): Tab {
  return { id, name, protocol: 'runner', folderId, isDirty: false, isLoading: false }
}

/** Park folder A's runner tab on a finished-run results screen. */
function seedFinishedRun(tabId: string): void {
  const report: RunnerReport = {
    projectId: 'proj-1',
    startedAt: 1,
    completedAt: 2,
    totalEndpoints: 1,
    passedEndpoints: 1,
    failedEndpoints: 0,
    totalAssertions: 0,
    passedAssertions: 0,
    failedAssertions: 0,
    results: [],
  }
  const results = [
    {
      endpointId: 'ep-a1',
      endpointName: ALPHA_RESULT,
      method: 'GET',
      url: '/a',
      status: 200,
      statusText: 'OK',
      duration: 42,
      passed: 1,
      failed: 0,
      skipped: 0,
      assertions: [],
    },
  ]
  report.results = results
  sessionStorage.setItem(`runner-view-${tabId}`, 'results')
  sessionStorage.setItem(
    `runner-run-data-${tabId}`,
    JSON.stringify({ results, report, startedAt: 1 }),
  )
}

beforeEach(() => {
  mockWindowApi()
  sessionStorage.clear()
  useWorkspaceStore.setState({
    activeWorkspaceId: 'ws-1',
    activeProjectId: 'proj-1',
    treeData: tree(),
    openNodeIds: new Set(['default-module']),
    searchQuery: '',
  })
  useUIStore.setState({ activeSidebarPage: 'tests' })
  useTabsStore.setState({
    tabs: [runnerTab('runner-folder-a', 'Folder A', 'folder-a')],
    activeTabId: 'runner-folder-a',
  })
  seedFinishedRun('runner-folder-a')
})

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

describe('Runner tab reuse (#66)', () => {
  it('running a second folder shows that folder’s Start-run screen, not the previous results', () => {
    render(<Workbench />)
    // Precondition: folder A's tab is parked on its results.
    expect(screen.getByText(ALPHA_RESULT)).toBeTruthy()

    act(() => {
      openFolderRunner('folder-b', 'Folder B')
    })

    expect(screen.queryByText(ALPHA_RESULT)).toBeNull()
    expect(screen.getByText(BETA_ENDPOINT)).toBeTruthy()
  })

  it('re-running the SAME folder returns to its Start-run screen without duplicating the tab', () => {
    render(<Workbench />)
    expect(screen.getByText(ALPHA_RESULT)).toBeTruthy()

    act(() => {
      openFolderRunner('folder-a', 'Folder A')
    })

    const { tabs } = useTabsStore.getState()
    expect(tabs.filter((t) => t.protocol === 'runner')).toHaveLength(1)
    expect(screen.queryByText(ALPHA_RESULT)).toBeNull()
    expect(screen.getByText('Alpha endpoint')).toBeTruthy()
  })

  it('still reconfigures a reused tab for a Test Suite run', async () => {
    // The suite entry points reuse whatever runner tab is open (including a
    // folder-scoped one) and signal it with a fresh session token — guard that
    // path, since re-arming the tab now rebuilds the runner tree.
    mockWindowApi({
      testSuite: {
        list: () => Promise.resolve({ success: true, data: [] }),
        listEndpoints: () =>
          Promise.resolve({
            success: true,
            data: {
              items: [
                { id: 'item-1', name: 'Suite item one', method: 'GET', url: '/s', folder_id: null },
              ],
              folders: [],
            },
          }),
      },
    })
    render(<Workbench />)
    expect(screen.getByText(ALPHA_RESULT)).toBeTruthy()

    await act(async () => {
      openOrReuseRunnerTab({ sourceType: 'suite', suiteId: 'suite-1', folderName: 'My Suite' })
    })

    expect(screen.queryByText(ALPHA_RESULT)).toBeNull()
    expect(screen.getByText('Suite item one')).toBeTruthy()
  })

  it('gives every folder-run open a distinct session token so a reused tab re-arms', () => {
    act(() => {
      openFolderRunner('folder-a', 'Folder A')
    })
    const first = useTabsStore.getState().tabs[0].sessionKey
    act(() => {
      openFolderRunner('folder-a', 'Folder A')
    })
    const second = useTabsStore.getState().tabs[0].sessionKey
    expect(first).toBeTruthy()
    expect(second).not.toBe(first)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// #66 follow-up — re-arming must not steal a RUNNING run's UI.
//
// The sessionKey bump remounts the runner so a second folder always gets its
// own Start-run screen. If the tab being re-armed is mid-run, that remount
// would drop the live progress + Cancel button while main keeps executing.
// ─────────────────────────────────────────────────────────────────────────────
describe('#66: a Run aimed at a busy runner tab focuses it instead of re-arming', () => {
  beforeEach(() => {
    resetRunnerActivity()
    useTabsStore.setState({ tabs: [], activeTabId: null })
  })

  it('bumps sessionKey when the tab is idle', () => {
    openFolderRunner('f1', 'Payments')
    const first = useTabsStore.getState().tabs.find((t) => t.id === 'runner-f1')?.sessionKey
    openFolderRunner('f1', 'Payments')
    const second = useTabsStore.getState().tabs.find((t) => t.id === 'runner-f1')?.sessionKey
    expect(first).toBeTruthy()
    expect(second).not.toBe(first)
  })

  it('leaves sessionKey alone while that tab has a run in flight', () => {
    openFolderRunner('f1', 'Payments')
    const during = useTabsStore.getState().tabs.find((t) => t.id === 'runner-f1')?.sessionKey

    setRunnerBusy('runner-f1', true)
    openFolderRunner('f1', 'Payments')

    const after = useTabsStore.getState().tabs.find((t) => t.id === 'runner-f1')
    expect(after?.sessionKey).toBe(during)
    expect(useTabsStore.getState().activeTabId).toBe('runner-f1')
  })

  it('re-arms again once the run finishes', () => {
    openFolderRunner('f1', 'Payments')
    setRunnerBusy('runner-f1', true)
    openFolderRunner('f1', 'Payments')
    const parked = useTabsStore.getState().tabs.find((t) => t.id === 'runner-f1')?.sessionKey

    setRunnerBusy('runner-f1', false)
    openFolderRunner('f1', 'Payments')

    expect(useTabsStore.getState().tabs.find((t) => t.id === 'runner-f1')?.sessionKey).not.toBe(
      parked,
    )
  })
})
