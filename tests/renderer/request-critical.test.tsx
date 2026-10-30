/**
 * Issue #304 — the per-request "Critical" option (Settings tab).
 *
 *  - Stored through the one settings source (`src/shared/request-settings.ts`):
 *    top-level `critical` of the endpoint / suite item `request_schema`, of the
 *    saved_request `metadata`. Written only when on.
 *  - Every protocol the Runner runs can save it (HTTP, SOAP, GraphQL, MCP —
 *    `isRunnableProtocol`); Ctrl+S → close → reopen restores it.
 *  - The Settings switch toggles it and marks the tab dirty.
 *  - Run sequence + run results show a Critical badge, and the results say
 *    which critical request stopped the run — also for a run reopened from
 *    history, whose report carries no stopReason.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

import { readRequestSettings, readRequestSettingsJson } from '../../src/shared/request-settings'
import {
  requestSettingsFor,
  saveActiveRequestInPlace,
} from '../../src/renderer/lib/save-active-request'
import { openEndpointTab, openSuiteItemTab } from '../../src/renderer/lib/open-endpoint-tab'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import SettingsTab from '../../src/renderer/components/request/SettingsTab'
import RunnerSequence from '../../src/renderer/components/runner/RunnerSequence'
import RunnerResults from '../../src/renderer/components/runner/RunnerResults'
import type { EndpointRunResult } from '../../src/shared/runner-types'
import type { Tab } from '../../src/renderer/types'
;(globalThis as unknown as { React: typeof React }).React = React

type Row = Record<string, unknown>

function installRowApi() {
  const endpoints = new Map<string, Row>()
  const saved = new Map<string, Row>()
  const items = new Map<string, Row>()
  const ok = (data: unknown) => ({ success: true, data })
  const api = {
    endpoint: {
      update: vi.fn(async (id: string, patch: Row) => {
        endpoints.set(id, { ...endpoints.get(id), ...patch })
        return ok(true)
      }),
      get: vi.fn(async (id: string) => ok(endpoints.get(id) ?? null)),
    },
    savedRequest: {
      update: vi.fn(async (id: string, patch: Row) => {
        const next: Row = { ...(saved.get(id) ?? {}) }
        for (const [k, v] of Object.entries(patch)) if (v !== undefined) next[k] = v
        saved.set(id, next)
        return ok(true)
      }),
      get: vi.fn(async (id: string) => ok(saved.get(id) ?? null)),
    },
    testSuiteItem: {
      update: vi.fn(async (id: string, patch: Row) => {
        items.set(id, { ...items.get(id), ...patch })
        return ok(true)
      }),
      get: vi.fn(async (id: string) => ok(items.get(id) ?? null)),
    },
  }
  ;(window as unknown as { api: typeof api }).api = api
  return { endpoints, saved, items }
}

let rows: ReturnType<typeof installRowApi>

function openEditorTab(tab: Partial<Tab> & { id: string }): void {
  useTabsStore.setState({
    tabs: [{ name: 'Req', method: 'GET', url: 'https://api.test', isDirty: false, ...tab } as Tab],
    activeTabId: tab.id,
  })
  useRequestStore.getState().switchToTab(tab.id)
  useMcpStore.getState().switchToTab(tab.id)
}

function closeAll(): void {
  for (const t of useTabsStore.getState().tabs) {
    useRequestStore.getState().removeTabState(t.id)
    useMcpStore.getState().removeTabState(t.id)
  }
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useRequestStore.getState().switchToTab('scratch')
  useMcpStore.getState().switchToTab('scratch')
}

const activeDirty = (): boolean => {
  const s = useTabsStore.getState()
  return s.tabs.find((t) => t.id === s.activeTabId)?.isDirty ?? false
}

beforeEach(() => {
  rows = installRowApi()
  useWorkspaceStore.setState({ refreshTree: vi.fn().mockResolvedValue(undefined) })
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useRequestStore.setState({ _tabStates: new Map(), _currentTabId: null, critical: false })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
})
afterEach(cleanup)

describe('issue #304 — the shared settings reader', () => {
  it('reads `critical: true`; anything else is "not critical"', () => {
    expect(readRequestSettings({ critical: true }).critical).toBe(true)
    expect(readRequestSettings({ critical: false }).critical).toBeUndefined()
    expect(readRequestSettings({ critical: 'yes' }).critical).toBeUndefined()
    expect(readRequestSettingsJson(JSON.stringify({ timeout: 5, critical: true }))).toEqual({
      timeout: 5,
      critical: true,
    })
  })
})

describe('issue #304 — Critical survives Ctrl+S → close → reopen', () => {
  it('endpoint: top-level `critical` in request_schema, restored on reopen', async () => {
    rows.endpoints.set('ep-1', {
      id: 'ep-1',
      name: 'Login',
      method: 'POST',
      path: '/login',
      protocol: 'http',
    })
    openEditorTab({ id: 'tab-ep-1', protocol: 'http', endpointId: 'ep-1' })
    useRequestStore.getState().setCritical(true)

    expect((await saveActiveRequestInPlace()).success).toBe(true)
    expect(JSON.parse(String(rows.endpoints.get('ep-1')?.request_schema)).critical).toBe(true)

    closeAll()
    expect(useRequestStore.getState().critical).toBe(false)
    await openEndpointTab('ep-1')
    expect(useRequestStore.getState().critical).toBe(true)
    expect(activeDirty()).toBe(false)
  })

  it('saved request: rides in metadata, restored on reopen', async () => {
    rows.saved.set('sr-1', {
      id: 'sr-1',
      name: 'Login',
      method: 'POST',
      url: '/login',
      protocol: 'http',
    })
    openEditorTab({ id: 'tab-sr-1', protocol: 'http', savedRequestId: 'sr-1' })
    useRequestStore.getState().setCritical(true)

    expect((await saveActiveRequestInPlace()).success).toBe(true)
    expect(JSON.parse(String(rows.saved.get('sr-1')?.metadata)).critical).toBe(true)

    closeAll()
    await openEndpointTab('sr-1')
    expect(useRequestStore.getState().critical).toBe(true)
  })

  it('suite item: its OWN flag in request_schema, restored on reopen', async () => {
    rows.items.set('it-1', {
      id: 'it-1',
      suite_id: 's',
      folder_id: null,
      protocol: 'http',
      name: 'Login',
      method: 'POST',
      url: '/login',
      request_schema: '{}',
      assertions: '[]',
    })
    openEditorTab({ id: 'tab-it-1', protocol: 'http', testSuiteItemId: 'it-1' })
    useRequestStore.getState().setCritical(true)

    expect((await saveActiveRequestInPlace()).success).toBe(true)
    expect(JSON.parse(String(rows.items.get('it-1')?.request_schema)).critical).toBe(true)

    closeAll()
    await openSuiteItemTab('it-1')
    expect(useRequestStore.getState().critical).toBe(true)
  })

  it('unmarking drops the key — an unmarked row stays byte-identical', async () => {
    rows.endpoints.set('ep-2', {
      id: 'ep-2',
      name: 'R',
      method: 'GET',
      path: '/r',
      protocol: 'http',
    })
    openEditorTab({ id: 'tab-ep-2', protocol: 'http', endpointId: 'ep-2' })
    useRequestStore.getState().setCritical(true)
    await saveActiveRequestInPlace()
    useRequestStore.getState().setCritical(false)
    await saveActiveRequestInPlace()
    expect(JSON.parse(String(rows.endpoints.get('ep-2')?.request_schema))).not.toHaveProperty(
      'critical',
    )
  })

  it('reopening a non-critical row does not inherit the previous tab’s flag', async () => {
    rows.endpoints.set('ep-3', {
      id: 'ep-3',
      name: 'Plain',
      method: 'GET',
      path: '/p',
      protocol: 'http',
      request_schema: JSON.stringify({ url: '/p' }),
    })
    openEditorTab({ id: 'tab-x', protocol: 'http', endpointId: 'other' })
    useRequestStore.getState().setCritical(true)
    await openEndpointTab('ep-3')
    expect(useRequestStore.getState().critical).toBe(false)
  })

  it.each(['http', 'soap', 'graphql', 'mcp'])(
    'every protocol the Runner runs writes it (%s)',
    (protocol) => {
      openEditorTab({ id: `tab-${protocol}`, protocol: protocol as Tab['protocol'] })
      useRequestStore.getState().setCritical(true)
      expect(requestSettingsFor(useTabsStore.getState().tabs[0]).critical).toBe(true)
    },
  )

  it.each(['websocket', 'socketio', 'grpc', 'sse', 'mqtt'])(
    'a protocol the Runner does not run writes no flag (%s)',
    (protocol) => {
      openEditorTab({ id: `tab-${protocol}`, protocol: protocol as Tab['protocol'] })
      useRequestStore.getState().setCritical(true)
      expect(requestSettingsFor(useTabsStore.getState().tabs[0]).critical).toBeUndefined()
    },
  )
})

describe('issue #304 — Settings tab switch', () => {
  it('toggles the flag and marks the tab dirty', () => {
    openEditorTab({ id: 'tab-ui', protocol: 'http', endpointId: 'ep-ui' })
    render(<SettingsTab />)
    const box = screen.getByTestId('settings-critical') as HTMLInputElement
    expect(box.checked).toBe(false)
    expect(activeDirty()).toBe(false)

    fireEvent.click(box)
    expect(useRequestStore.getState().critical).toBe(true)
    expect((screen.getByTestId('settings-critical') as HTMLInputElement).checked).toBe(true)
    expect(activeDirty()).toBe(true)
  })
})

const noop = () => {}

function result(over: Partial<EndpointRunResult> & { endpointId: string }): EndpointRunResult {
  return {
    endpointName: over.endpointId,
    method: 'GET',
    url: 'https://example.test/' + over.endpointId,
    status: 200,
    statusText: 'OK',
    duration: 12,
    passed: 0,
    failed: 0,
    skipped: 0,
    assertions: [],
    phase: 'main',
    ...over,
  }
}

describe('issue #304 — Critical badge and stop reason in the Runner', () => {
  it('the run sequence badges critical rows only', () => {
    render(
      <RunnerSequence
        endpoints={[
          { id: 'a', name: 'Login', method: 'POST', url: '/login', selected: true, critical: true },
          { id: 'b', name: 'Orders', method: 'GET', url: '/orders', selected: true },
        ]}
        folderGroups={[]}
        onToggle={noop}
        onSelectAll={noop}
        onDeselectAll={noop}
        onReset={noop}
      />,
    )
    expect(screen.getAllByTestId('critical-badge')).toHaveLength(1)
  })

  it('results badge critical rows and name the request that stopped the run — history view too', () => {
    const results = [
      result({
        endpointId: 'login',
        endpointName: 'Login',
        status: 500,
        critical: true,
        stoppedRun: true,
      }),
      result({
        endpointId: 'orders',
        endpointName: 'Orders',
        status: null,
        statusText: 'NOT_RUN',
        skipped: 1,
      }),
    ]
    render(
      <RunnerResults
        results={results}
        // As RunnerHistory rebuilds it: no stopReason.
        report={{
          projectId: 'p',
          startedAt: 1,
          completedAt: 2,
          totalEndpoints: 2,
          passedEndpoints: 0,
          failedEndpoints: 1,
          totalAssertions: 0,
          passedAssertions: 0,
          failedAssertions: 0,
          results,
        }}
        isRunning={false}
        currentIndex={0}
        totalCount={2}
        runStartedAt={1}
        sourceLabel="Runner"
        onStop={noop}
        onNewRun={noop}
        onRunAgain={noop}
        onViewAllRuns={noop}
        selectedResultId={null}
        onSelectResult={noop}
      />,
    )
    expect(screen.getByTestId('runner-stop-critical').textContent).toBe(
      'Stopped: critical request "Login" failed.',
    )
    expect(screen.getAllByTestId('critical-badge')).toHaveLength(1)
  })
})
