/**
 * Run results → folder icon on a TEST SUITE run (follow-up of issue #115).
 *
 * The icon used to be withheld on suite runs: their result ids are
 * `test_suite_items` ids, which have no row in the APIs tree. It now reveals
 * the item in the Tests sidebar instead:
 *
 *   - the sidebar switches to Tests (mounting the panel when it was on APIs),
 *   - the item's OWN suite is expanded and its folder chain opened (even a
 *     folder the user had collapsed),
 *   - the item row is selected and scrolled into view,
 *   - a deleted item says so in a toast instead of navigating to nothing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import React from 'react'

interface ItemRow {
  id: string
  suite_id: string
  folder_id: string | null
  name: string
  protocol: string
  method: string | null
  url: string
  sort_order: number
}

const h = vi.hoisted(() => {
  const state = {
    suites: [
      {
        id: 'suite-a',
        project_id: 'p-1',
        name: 'Orders',
        description: null,
        sort_order: 0,
        created_at: 1,
        updated_at: 1,
      },
      {
        id: 'suite-b',
        project_id: 'p-1',
        name: 'Payments',
        description: null,
        sort_order: 1,
        created_at: 2,
        updated_at: 2,
      },
    ],
    folders: [
      { id: 'f-outer', suite_id: 'suite-b', parent_id: null, name: 'Flow', sort_order: 0 },
      { id: 'f-inner', suite_id: 'suite-b', parent_id: 'f-outer', name: 'Refunds', sort_order: 0 },
    ],
    items: [
      {
        id: 'item-root',
        suite_id: 'suite-a',
        folder_id: null,
        name: 'List orders',
        protocol: 'http',
        method: 'GET',
        url: '',
        sort_order: 0,
      },
      {
        id: 'item-deep',
        suite_id: 'suite-b',
        folder_id: 'f-inner',
        name: 'Refund payment',
        protocol: 'http',
        method: 'POST',
        url: '',
        sort_order: 0,
      },
    ] as ItemRow[],
  }
  const ok = <T,>(data: T) => Promise.resolve({ success: true, data })
  const stub = {
    testSuite: {
      list: () => ok(state.suites.slice()),
      listEndpoints: (suiteId: string) =>
        ok({
          items: state.items.filter((i) => i.suite_id === suiteId),
          folders: state.folders.filter((f) => f.suite_id === suiteId),
        }),
    },
    testSuiteItem: {
      get: (id: string) => ok(state.items.find((i) => i.id === id) ?? null),
    },
  }
  const g = globalThis as unknown as { window?: { api?: unknown } }
  if (!g.window) g.window = { api: stub }
  else g.window.api = stub
  return { state, stub }
})

import TestsPanel from '../../src/renderer/components/sidebar/TestsPanel'
import RunnerResults from '../../src/renderer/components/runner/RunnerResults'
import { useWorkspaceStore, suiteFolderChain } from '../../src/renderer/stores/workspace.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { revealRunResult, revealTargetFor } from '../../src/renderer/lib/reveal-run-result'
import { toast } from '../../src/renderer/lib/toast'
import type { EndpointRunResult } from '../../src/shared/runner-types'

/** The left panel's page switch, reduced to the Tests page (LeftPanel.tsx). */
function Sidebar(): React.ReactElement | null {
  const page = useUIStore((s) => s.activeSidebarPage)
  return page === 'tests' ? React.createElement(TestsPanel) : null
}

const itemRow = (id: string): HTMLElement | null =>
  document.querySelector(`[data-testid="suite-item-row"][data-item-id="${id}"]`)

let scrolled: Element[] = []

beforeEach(() => {
  scrolled = []
  ;(HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = function (
    this: Element,
  ) {
    scrolled.push(this)
  }
  useWorkspaceStore.setState({
    activeProjectId: 'p-1',
    activeSuiteItemId: null,
    suiteRevealCommand: { itemId: '', suiteId: '', folderIds: [], seq: 0, stage: 'done' },
  })
  useUIStore.setState({ activeSidebarPage: 'apis' })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('suiteFolderChain', () => {
  it('lists the folders above an item, outermost first', () => {
    expect(suiteFolderChain(h.state.folders, 'f-inner')).toEqual(['f-outer', 'f-inner'])
  })

  it('is empty for a root item and stops on a parent loop', () => {
    expect(suiteFolderChain(h.state.folders, null)).toEqual([])
    const loop = [
      { id: 'x', parent_id: 'y' },
      { id: 'y', parent_id: 'x' },
    ]
    expect(suiteFolderChain(loop, 'x')).toEqual(['y', 'x'])
  })
})

describe('Run results on a suite run', () => {
  const result = {
    endpointId: 'item-deep',
    endpointName: 'Refund payment',
    method: 'POST',
    url: 'http://x/refund',
    status: 200,
    statusText: 'OK',
    duration: 5,
    passed: 1,
    failed: 0,
    skipped: 0,
    assertions: [],
  } as unknown as EndpointRunResult

  it('offers the folder icon, labelled for the Tests sidebar', () => {
    expect(revealTargetFor('suite')).toBe('tests')
    expect(revealTargetFor('apis')).toBe('apis')
    render(
      React.createElement(RunnerResults, {
        results: [result],
        report: null,
        isRunning: false,
        currentIndex: 1,
        totalCount: 1,
        runStartedAt: null,
        sourceLabel: 'Payments',
        onStop: () => {},
        onStopDirect: () => {},
        onNewRun: () => {},
        onViewAllRuns: () => {},
        onRunAgain: () => {},
        selectedResultId: null,
        onSelectResult: () => {},
        onReveal: (id: string) => void revealRunResult('suite', id),
        revealIn: revealTargetFor('suite'),
      } as unknown as React.ComponentProps<typeof RunnerResults>),
    )
    const icon = screen.getByTestId('runner-reveal-item-deep')
    expect(icon.getAttribute('title')).toBe('Reveal in Tests')
  })
})

describe('revealRunResult — suite item', () => {
  it('switches to Tests, opens the suite and folder chain, selects and scrolls to the item', async () => {
    render(React.createElement(Sidebar))
    expect(screen.queryByText('Payments')).toBeNull() // APIs page: panel not mounted

    let found = false
    await act(async () => {
      found = await revealRunResult('suite', 'item-deep')
    })
    expect(found).toBe(true)
    expect(useUIStore.getState().activeSidebarPage).toBe('tests')

    await waitFor(() => expect(itemRow('item-deep')).not.toBeNull())
    const row = itemRow('item-deep')!
    expect(row.getAttribute('data-active')).toBe('true')
    for (const id of ['f-outer', 'f-inner']) {
      const folder = document.querySelector(`[data-folder-id="${id}"]`)
      expect(folder?.getAttribute('aria-expanded')).toBe('true')
    }
    await waitFor(() => expect(scrolled).toContain(row))
    expect(useWorkspaceStore.getState().suiteRevealCommand.stage).toBe('done')
  })

  it('re-opens a folder the user had collapsed when the panel is already showing', async () => {
    useUIStore.setState({ activeSidebarPage: 'tests' })
    render(React.createElement(Sidebar))
    // Expand the suite by hand, then collapse its outer folder.
    fireEvent.click(await screen.findByText('Payments'))
    const outer = await waitFor(() => {
      const el = document.querySelector('[data-folder-id="f-outer"]')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    fireEvent.click(outer)
    expect(outer.getAttribute('aria-expanded')).toBe('false')
    expect(itemRow('item-deep')).toBeNull()

    await act(async () => {
      await revealRunResult('suite', 'item-deep')
    })

    await waitFor(() => expect(itemRow('item-deep')).not.toBeNull())
    expect(
      document.querySelector('[data-folder-id="f-outer"]')?.getAttribute('aria-expanded'),
    ).toBe('true')
    expect(itemRow('item-deep')!.getAttribute('data-active')).toBe('true')
    await waitFor(() => expect(scrolled).toContain(itemRow('item-deep')))
  })

  it('reveals a root item of another suite and moves the selection', async () => {
    useWorkspaceStore.setState({ activeSuiteItemId: 'item-deep' })
    render(React.createElement(Sidebar))
    await act(async () => {
      await revealRunResult('suite', 'item-root')
    })
    await waitFor(() => expect(itemRow('item-root')).not.toBeNull())
    expect(itemRow('item-root')!.getAttribute('data-active')).toBe('true')
    expect(useWorkspaceStore.getState().activeSuiteItemId).toBe('item-root')
  })

  it('a deleted item says so in a toast and reveals nothing', async () => {
    const info = vi.spyOn(toast, 'info').mockImplementation(() => {})
    render(React.createElement(Sidebar))
    let found = true
    await act(async () => {
      found = await revealRunResult('suite', 'item-gone')
    })
    expect(found).toBe(false)
    expect(info).toHaveBeenCalledWith('This request is no longer in the test suite.')
    expect(useWorkspaceStore.getState().suiteRevealCommand.seq).toBe(0)
    expect(useWorkspaceStore.getState().activeSuiteItemId).toBeNull()
  })

  it('does not replay an old reveal when the panel mounts again later', async () => {
    render(React.createElement(Sidebar))
    await act(async () => {
      await revealRunResult('suite', 'item-deep')
    })
    await waitFor(() => expect(useWorkspaceStore.getState().suiteRevealCommand.stage).toBe('done'))
    act(() => useUIStore.getState().setActiveSidebarPage('apis'))
    scrolled = []
    act(() => useUIStore.getState().setActiveSidebarPage('tests'))
    await screen.findByText('Payments')
    expect(itemRow('item-deep')).toBeNull() // suite starts collapsed again — no replay
    expect(scrolled).toEqual([])
  })
})
