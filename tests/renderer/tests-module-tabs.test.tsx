/**
 * issue #93 — the Tests module's tabs.
 *
 * Two findings from the same report, and they share a shape: something that
 * worked on first arrival stopped working the moment a second tab entered the
 * picture.
 *
 *   A) "+" always opened an HTTP request. Standing in Tests, that handed the
 *      user the APIs protocol picker while the sidebar still said Tests.
 *
 *   B) Opening any other tab and coming back to a suite's runner tab landed on
 *      the Tests overview instead of the run. Switching tabs unmounts the
 *      runner, and its opening payload was deleted on first read — so the
 *      remount found no suiteId, concluded the tab had no scope, and fell back.
 *
 * Both are driven through the real Workbench, because both are about what
 * happens between components rather than inside one.
 */
import * as React from 'react'
import { runnerKey } from '../../src/renderer/lib/runner-storage'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'

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

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

import { mockWindowApi } from './screens/_mount'
import Workbench from '../../src/renderer/components/layout/Workbench'
import { openOrReuseRunnerTab } from '../../src/renderer/lib/open-runner-tab'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import type { Tab } from '../../src/renderer/types'

const SUITE_ITEM = 'Suite item one'

function suiteApi() {
  mockWindowApi({
    testSuite: {
      list: () => Promise.resolve({ success: true, data: [] }),
      listEndpoints: () =>
        Promise.resolve({
          success: true,
          data: {
            items: [{ id: 'item-1', name: SUITE_ITEM, method: 'GET', url: '/s', folder_id: null }],
            folders: [],
          },
        }),
    },
  })
}

function httpTab(id: string): Tab {
  return { id, name: 'Scratch', protocol: 'http', isDirty: false, isLoading: false }
}

beforeEach(() => {
  suiteApi()
  sessionStorage.clear()
  useWorkspaceStore.setState({
    activeWorkspaceId: 'ws-1',
    activeProjectId: 'proj-1',
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

describe('the "+" button follows the module you are in (#93 A)', () => {
  it('opens the Tests screen while the Tests page is showing', () => {
    useTabsStore.setState({ tabs: [httpTab('t-1')], activeTabId: 't-1' })
    render(<Workbench />)

    act(() => {
      fireEvent.click(screen.getByTitle(/new tab/i))
    })

    const { tabs, activeTabId } = useTabsStore.getState()
    const opened = tabs.find((t) => t.id === activeTabId)
    expect(opened?.protocol).toBe('runner')
    // The precise symptom: an APIs request tab, opened from inside Tests.
    expect(opened?.name).not.toBe('New Request')
  })

  it('still opens a request on every other page', () => {
    useUIStore.setState({ activeSidebarPage: 'apis' })
    useTabsStore.setState({ tabs: [httpTab('t-1')], activeTabId: 't-1' })
    render(<Workbench />)

    act(() => {
      fireEvent.click(screen.getByTitle(/new tab/i))
    })

    const { tabs, activeTabId } = useTabsStore.getState()
    expect(tabs.find((t) => t.id === activeTabId)?.protocol).toBe('http')
  })
})

describe('a suite runner tab survives a trip to another tab (#93 B)', () => {
  it('comes back to the run, not to the Tests overview', async () => {
    render(<Workbench />)

    await act(async () => {
      openOrReuseRunnerTab({ sourceType: 'suite', suiteId: 'suite-1', folderName: 'My Suite' })
    })
    expect(screen.getByText(SUITE_ITEM)).toBeTruthy()
    const runnerTabId = useTabsStore.getState().activeTabId!

    // Leave, which unmounts RunnerTab, then come back.
    await act(async () => {
      useTabsStore.getState().openTab({ id: 'away', name: 'Away', protocol: 'http' })
    })
    expect(screen.queryByText(SUITE_ITEM)).toBeNull()

    await act(async () => {
      useTabsStore.getState().setActiveTab(runnerTabId)
    })

    // The suite's endpoints are on screen again — which can only happen if the
    // remount still knew the tab's suiteId.
    expect(screen.getByText(SUITE_ITEM)).toBeTruthy()
  })

  it('keeps the tab payload instead of consuming it on first read', async () => {
    render(<Workbench />)
    await act(async () => {
      openOrReuseRunnerTab({ sourceType: 'suite', suiteId: 'suite-1', folderName: 'My Suite' })
    })

    const tabId = useTabsStore.getState().activeTabId!
    const stored = sessionStorage.getItem(runnerKey('report', tabId) as string)
    expect(stored).toBeTruthy()
    expect(JSON.parse(stored!).suiteId).toBe('suite-1')
  })

  it('does not re-run the suite every time the user returns to the tab', async () => {
    const execute = vi.fn(() => Promise.resolve({ success: true, data: null }))
    mockWindowApi({
      runner: { execute, onProgress: () => () => {}, onPhase: () => () => {} },
      testSuite: {
        list: () => Promise.resolve({ success: true, data: [] }),
        listEndpoints: () =>
          Promise.resolve({
            success: true,
            data: {
              items: [
                { id: 'item-1', name: SUITE_ITEM, method: 'GET', url: '/s', folder_id: null },
              ],
              folders: [],
            },
          }),
      },
    })
    render(<Workbench />)

    await act(async () => {
      // No autoRun: this is the browse-only open. The point is that returning
      // to the tab must not turn a browse into a run — the payload is still
      // there now, so its one-shot half has to stay one-shot.
      openOrReuseRunnerTab({ sourceType: 'suite', suiteId: 'suite-1', folderName: 'My Suite' })
    })
    const runnerTabId = useTabsStore.getState().activeTabId!

    await act(async () => {
      useTabsStore.getState().openTab({ id: 'away', name: 'Away', protocol: 'http' })
    })
    await act(async () => {
      useTabsStore.getState().setActiveTab(runnerTabId)
    })

    expect(execute).not.toHaveBeenCalled()
  })
})
