/**
 * Issue #315 — mark a request Critical from the run sequence.
 *
 *  - The toggle: Flow rows of runnable protocols, a real pressed button.
 *  - An editor tab open on the row follows the change without going dirty, so
 *    its next Ctrl+S cannot write the old value back.
 *  - The APIs runner rebuilds its rows when the tree changes; the toggle's tree
 *    refresh must not drop the selection and Setup/Teardown roles.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const overrides = vi.hoisted(() => {
  const map: Record<string, (...a: unknown[]) => unknown> = {}
  const nsFor = (name: string): unknown =>
    new Proxy(
      {},
      {
        get: (_t, p) =>
          p === 'then'
            ? undefined
            : (...a: unknown[]) => {
                const fn = map[`${name}.${String(p)}`]
                return fn ? fn(...a) : Promise.resolve({ success: true, data: null })
              },
      },
    )
  const api = new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : nsFor(String(p))) })
  const g = globalThis as unknown as { window?: { api?: unknown } }
  if (!g.window) g.window = {}
  g.window.api = api
  return map
})
const toastError = vi.hoisted(() => vi.fn())

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))
vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { error: toastError, success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import RunnerSequence from '../../src/renderer/components/runner/RunnerSequence'
import RunnerTab, { type RunnerEndpointItem } from '../../src/renderer/components/runner/RunnerTab'
import { setRequestCritical } from '../../src/renderer/lib/request-critical'
import { saveActiveRequestInPlace } from '../../src/renderer/lib/save-active-request'
import { readRequestSettingsJson } from '../../src/shared/request-settings'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { runnerKey } from '../../src/renderer/lib/runner-storage'
import type { Tab, TreeNode } from '../../src/renderer/types'

const noop = (): void => undefined
const row = (o: Partial<RunnerEndpointItem> & { id: string }): RunnerEndpointItem => ({
  name: o.id,
  method: 'GET',
  url: '/x',
  selected: true,
  protocol: 'http',
  ...o,
})

function sequence(endpoints: RunnerEndpointItem[], onSetCritical?: () => void): void {
  render(
    <RunnerSequence
      endpoints={endpoints}
      folderGroups={[]}
      onToggle={noop}
      onSelectAll={noop}
      onDeselectAll={noop}
      onReset={noop}
      onSetCritical={onSetCritical}
    />,
  )
}

beforeEach(() => {
  for (const k of Object.keys(overrides)) delete overrides[k]
  toastError.mockClear()
  sessionStorage.clear()
  useUIStore.getState().setLocale('en')
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useRequestStore.setState({ _tabStates: new Map(), _currentTabId: null, critical: false })
})
afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

describe('issue #315 — the toggle on a sequence row', () => {
  it('is a pressed button carrying the row name and the Settings help text', () => {
    const onSet = vi.fn()
    sequence([row({ id: 'Login', critical: true }), row({ id: 'Orders' })], onSet)
    const on = screen.getByRole('button', { name: 'Mark Login as critical' })
    const off = screen.getByRole('button', { name: 'Mark Orders as critical' })
    expect(on.getAttribute('aria-pressed')).toBe('true')
    expect(off.getAttribute('aria-pressed')).toBe('false')
    expect(off.getAttribute('title')).toMatch(/Stop run if an error occurs/)
    expect(screen.getAllByTestId('critical-badge')).toHaveLength(1)

    fireEvent.click(off)
    expect(onSet).toHaveBeenLastCalledWith('Orders', true)
    fireEvent.click(on)
    expect(onSet).toHaveBeenLastCalledWith('Login', false)
  })

  it('Setup and Teardown rows do not offer it', () => {
    sequence(
      [
        row({ id: 'S', phase: 'setup', critical: true }),
        row({ id: 'T', phase: 'teardown' }),
        row({ id: 'F', phase: 'main' }),
      ],
      noop,
    )
    expect(screen.getAllByTestId('critical-toggle')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Mark F as critical' })).toBeTruthy()
    expect(screen.queryByTestId('critical-badge')).toBeNull()
  })

  it('protocols the Runner cannot run do not offer it', () => {
    sequence(
      [
        row({ id: 'ws', protocol: 'websocket' }),
        row({ id: 'mcp', protocol: 'mcp' }),
        row({ id: 'old', protocol: undefined }),
      ],
      noop,
    )
    expect(screen.queryByRole('button', { name: 'Mark ws as critical' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Mark mcp as critical' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Mark old as critical' })).toBeTruthy()
  })

  it('without a handler only the badge shows', () => {
    sequence([row({ id: 'L', critical: true })])
    expect(screen.queryByTestId('critical-toggle')).toBeNull()
    expect(screen.getByTestId('critical-badge')).toBeTruthy()
  })
})

describe('issue #315 — an editor tab open on the row', () => {
  function openTabs(): void {
    useTabsStore.setState({
      tabs: [
        { id: 'tab-ep', name: 'E', protocol: 'http', endpointId: 'ep', isDirty: false } as Tab,
        { id: 'tab-sr', name: 'S', protocol: 'http', savedRequestId: 'sr', isDirty: false } as Tab,
      ],
      activeTabId: 'tab-sr',
    })
    useRequestStore.getState().switchToTab('tab-ep')
    useRequestStore.getState().switchToTab('tab-sr')
  }
  const answer = (): void => {
    overrides['runner.setRequestCritical'] = async () => ({ success: true })
  }

  it('the active tab follows, without going dirty', async () => {
    openTabs()
    answer()
    expect(await setRequestCritical('sr', true)).toBe(true)
    expect(useRequestStore.getState().critical).toBe(true)
    expect(useTabsStore.getState().tabs.every((t) => !t.isDirty)).toBe(true)
  })

  it('a background tab follows too, and shows it when reopened', async () => {
    openTabs()
    answer()
    await setRequestCritical('ep', true)
    expect(useRequestStore.getState().critical).toBe(false)
    useRequestStore.getState().switchToTab('tab-ep')
    expect(useRequestStore.getState().critical).toBe(true)
  })

  it('Ctrl+S on it afterwards keeps the flag', async () => {
    openTabs()
    answer()
    let metadata: string | undefined
    overrides['savedRequest.update'] = async (_id: unknown, patch: unknown) => {
      metadata = (patch as { metadata?: string }).metadata
      return { success: true, data: { id: 'sr' } }
    }
    overrides['savedRequest.get'] = async () => ({ success: true, data: { id: 'sr' } })
    await setRequestCritical('sr', true)
    await saveActiveRequestInPlace()
    expect(readRequestSettingsJson(metadata).critical).toBe(true)
  })

  it('a failed write changes nothing and says why', async () => {
    openTabs()
    overrides['runner.setRequestCritical'] = async () => ({ success: false, error: 'gone' })
    expect(await setRequestCritical('sr', true)).toBe(false)
    expect(useRequestStore.getState().critical).toBe(false)
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('gone'))
  })
})

describe('issue #315 — RunnerTab', () => {
  const TAB = 'runner-critical'
  const leaf = (id: string, critical = false): TreeNode =>
    ({
      id,
      type: 'request',
      label: id,
      method: 'GET',
      path: `/${id}`,
      protocol: 'http',
      ...(critical ? { critical: true } : {}),
    }) as TreeNode
  const tree = (critical: boolean): TreeNode[] => [
    {
      id: 'project-p',
      type: 'module',
      label: 'P',
      children: [leaf('Alpha', critical), leaf('Beta')],
    } as TreeNode,
  ]
  const toggle = (name: string): HTMLElement =>
    screen.getByRole('button', { name: `Mark ${name} as critical` })
  const box = (name: string): HTMLInputElement =>
    screen.getByRole('checkbox', { name: `Select ${name}` }) as HTMLInputElement
  const phase = (name: string): HTMLSelectElement =>
    screen.getByRole('combobox', { name: `Phase: ${name}` }) as HTMLSelectElement

  function mountApisRunner(): ReturnType<typeof vi.fn> {
    const refreshTree = vi.fn(async () => {
      useWorkspaceStore.setState({ treeData: tree(true) })
    })
    overrides['runner.setRequestCritical'] = async () => ({ success: true })
    useWorkspaceStore.setState({ activeProjectId: 'p', treeData: tree(false), refreshTree })
    sessionStorage.setItem(runnerKey('view', TAB)!, 'config')
    render(<RunnerTab tabId={TAB} folderId="project-p" />)
    return refreshTree
  }

  it('toggling keeps the selection and the phases of an APIs run', async () => {
    const refreshTree = mountApisRunner()
    await waitFor(() => expect(toggle('Alpha')).toBeTruthy())
    fireEvent.click(box('Beta'))
    fireEvent.change(phase('Beta'), { target: { value: 'teardown' } })

    fireEvent.click(toggle('Alpha'))
    await waitFor(() => expect(refreshTree).toHaveBeenCalled())
    await waitFor(() => expect(toggle('Alpha').getAttribute('aria-pressed')).toBe('true'))
    expect(box('Beta').checked).toBe(false)
    expect(phase('Beta').value).toBe('teardown')
    expect(box('Alpha').checked).toBe(true)
  })

  it('a suite run refreshes through the suite event, not the APIs tree', async () => {
    let schema = '{}'
    overrides['runner.setRequestCritical'] = async () => {
      schema = '{"critical":true}'
      return { success: true }
    }
    overrides['testSuite.listEndpoints'] = async () => ({
      success: true,
      data: {
        items: [
          {
            id: 'i1',
            name: 'Item',
            method: 'GET',
            url: '/i',
            folder_id: null,
            protocol: 'http',
            request_schema: schema,
          },
        ],
        folders: [],
      },
    })
    const refreshTree = vi.fn()
    useWorkspaceStore.setState({ activeProjectId: 'p', treeData: [], refreshTree })
    sessionStorage.setItem(runnerKey('view', TAB)!, 'config')
    sessionStorage.setItem(
      runnerKey('report', TAB)!,
      JSON.stringify({ sourceType: 'suite', suiteId: 'suite-1' }),
    )
    sessionStorage.setItem(runnerKey('report-spent', TAB)!, '')
    const seen = vi.fn()
    window.addEventListener('tests:suite-item-changed', seen)
    render(<RunnerTab tabId={TAB} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Mark Item as critical' }))
    await waitFor(() => expect(seen).toHaveBeenCalled())
    window.removeEventListener('tests:suite-item-changed', seen)
    expect(refreshTree).not.toHaveBeenCalled()
    const rowEl = screen.getByRole('checkbox', { name: 'Select Item' }).parentElement as HTMLElement
    await waitFor(() => expect(within(rowEl).getByTestId('critical-badge')).toBeTruthy())
  })
})
