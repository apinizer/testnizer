/**
 * Smoke-render the collection Runner UI and the app FRAME (Header / Footer /
 * LeftPanel / sidebar TreeView / ProjectHome) against seeded workspace / tabs /
 * ui stores + a mocked window.api. Testnizer is a live app with 600+ users; a
 * screen that throws on mount (or white-screens the shell) must become a RED
 * test here — see `mountsWithoutCrash` — instead of shipping.
 *
 * These are UI-only components; every network/DB call goes through the MOCKED
 * `window.api` bridge, which resolves each namespace method to `{success,data}`.
 */
import * as React from 'react'
import { describe, it, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// Some stores read `window.api.<ns>` at MODULE-EVAL time (e.g. mock.store.ts does
// `const api = window.api.mock`), and LeftPanel pulls those in through its import
// graph. That evaluation happens when the imports below are hoisted — before any
// `beforeEach` runs — so a permissive `window.api` must already exist. `vi.hoisted`
// runs before the import graph is evaluated; `beforeEach` later swaps in the
// richer per-test mock via `mockWindowApi`.
vi.hoisted(() => {
  const ns = new Proxy(
    {},
    { get: (_t, p) => (p === 'then' ? undefined : (..._a: unknown[]) => Promise.resolve({ success: true, data: null })) },
  )
  const api = new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : ns) })
  const g = globalThis as unknown as { window?: { api?: unknown } }
  if (!g.window) g.window = {}
  g.window.api = api
})

// Monaco can't run in jsdom — stub it (mirrors the existing renderer tests).
// RunnerResults imports MonacoWrapper to show response bodies.
vi.mock('../../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

import { mountsWithoutCrash, mockWindowApi } from './_mount'
import { useWorkspaceStore } from '../../../src/renderer/stores/workspace.store'
import { useTabsStore } from '../../../src/renderer/stores/tabs.store'
import { useUIStore } from '../../../src/renderer/stores/ui.store'
import { useEnvironmentStore } from '../../../src/renderer/stores/environment.store'
import type { TreeNode, Project, Tab } from '../../../src/renderer/types'
import type { RunnerEndpointItem, RunnerFolderGroup } from '../../../src/renderer/components/runner/RunnerTab'

// Runner UI
import RunnerTab from '../../../src/renderer/components/runner/RunnerTab'
import RunnerConfig from '../../../src/renderer/components/runner/RunnerConfig'
import RunnerResults from '../../../src/renderer/components/runner/RunnerResults'
import RunnerSequence from '../../../src/renderer/components/runner/RunnerSequence'

// App frame
import Header from '../../../src/renderer/components/layout/Header'
import Footer from '../../../src/renderer/components/layout/Footer'
import LeftPanel from '../../../src/renderer/components/layout/LeftPanel'
import ProjectHome from '../../../src/renderer/components/layout/ProjectHome'
import TreeView from '../../../src/renderer/components/sidebar/TreeView'

/* ── Seed helpers ──────────────────────────────────────────────────────────── */

function sampleTree(): TreeNode[] {
  return [
    {
      id: 'default-module',
      type: 'module',
      label: 'Default module',
      children: [
        {
          id: 'folder-1',
          type: 'folder',
          label: 'Sample APIs',
          children: [
            { id: 'ep-1', type: 'endpoint', label: 'List users', method: 'GET', path: '/users' },
            { id: 'ep-2', type: 'endpoint', label: 'Create user', method: 'POST', path: '/users' },
          ],
        },
      ],
    },
  ]
}

function sampleProject(): Project {
  return {
    id: 'proj-1',
    workspace_id: 'ws-1',
    name: 'Sample Project',
    type: 'http',
    save_mode: 'local',
    sort_order: 0,
    created_at: 1,
    updated_at: 1,
  }
}

function sampleTab(): Tab {
  return {
    id: 'tab-1',
    name: 'List users',
    protocol: 'http',
    method: 'GET',
    url: '/users',
    endpointId: 'ep-1',
    isDirty: false,
    isLoading: false,
  }
}

function seedFrameStores(): void {
  useWorkspaceStore.setState({
    workspaces: [{ id: 'ws-1', name: 'My Workspace' } as never],
    activeWorkspaceId: 'ws-1',
    projects: [sampleProject()],
    activeProjectId: 'proj-1',
    treeData: sampleTree(),
    openNodeIds: new Set(['default-module', 'folder-1']),
    searchQuery: '',
  })
  useTabsStore.setState({ tabs: [sampleTab()], activeTabId: 'tab-1' })
  useUIStore.setState({ activeSidebarPage: 'apis' })
  useEnvironmentStore.setState({
    environments: [{ id: 'env-1', name: 'Dev', variables: [] } as never],
    activeEnvironmentId: 'env-1',
  })
}

beforeEach(() => {
  mockWindowApi()
  seedFrameStores()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

/* ── Runner UI ─────────────────────────────────────────────────────────────── */

const RUNNER_ENDPOINTS: RunnerEndpointItem[] = [
  { id: 'ep-1', name: 'List users', method: 'GET', url: '/users', selected: true },
  { id: 'ep-2', name: 'Create user', method: 'POST', url: '/users', selected: false },
]

const RUNNER_GROUPS: RunnerFolderGroup[] = [
  { folderId: 'folder-1', folderName: 'Sample APIs', endpoints: RUNNER_ENDPOINTS },
]

const noop = (): void => {}

describe('Runner screens — smoke mount', () => {
  it('RunnerTab (default "home" / Tests overview view)', () => {
    mountsWithoutCrash(<RunnerTab tabId="runner-1" />)
  })

  it('RunnerTab (folder-scoped)', () => {
    mountsWithoutCrash(<RunnerTab tabId="runner-folder-1" folderId="folder-1" />)
  })

  it('RunnerTab (restores "config" view from sessionStorage)', () => {
    sessionStorage.setItem('runner-view-runner-cfg', 'config')
    mountsWithoutCrash(<RunnerTab tabId="runner-cfg" folderId="folder-1" />)
  })

  it('RunnerConfig (manual, schedulable)', () => {
    mountsWithoutCrash(
      <RunnerConfig
        delay={0}
        setDelay={noop}
        iterations={1}
        setIterations={noop}
        environmentId="env-1"
        setEnvironmentId={noop}
        stopOnError={true}
        setStopOnError={noop}
        persistResponses={true}
        setPersistResponses={noop}
        keepVariableValues={true}
        setKeepVariableValues={noop}
        iterationData={[]}
        setIterationData={noop}
        onRun={noop}
        onSchedule={noop}
        isRunning={false}
        selectedCount={2}
        canSchedule={true}
      />,
    )
  })

  it('RunnerConfig (schedule mode default, cron path)', () => {
    mountsWithoutCrash(
      <RunnerConfig
        delay={100}
        setDelay={noop}
        iterations={3}
        setIterations={noop}
        environmentId=""
        setEnvironmentId={noop}
        stopOnError={false}
        setStopOnError={noop}
        persistResponses={false}
        setPersistResponses={noop}
        keepVariableValues={false}
        setKeepVariableValues={noop}
        onRun={noop}
        onSchedule={noop}
        isRunning={false}
        selectedCount={1}
        canSchedule={true}
        initialRunMode="schedule"
        initialRunModeKey={1}
      />,
    )
  })

  it('RunnerConfig (APIs run — schedule hidden)', () => {
    mountsWithoutCrash(
      <RunnerConfig
        delay={0}
        setDelay={noop}
        iterations={1}
        setIterations={noop}
        environmentId=""
        setEnvironmentId={noop}
        stopOnError={true}
        setStopOnError={noop}
        persistResponses={true}
        setPersistResponses={noop}
        keepVariableValues={true}
        setKeepVariableValues={noop}
        onRun={noop}
        onSchedule={noop}
        isRunning={false}
        selectedCount={0}
        canSchedule={false}
      />,
    )
  })

  it('RunnerSequence (grouped)', () => {
    mountsWithoutCrash(
      <RunnerSequence
        endpoints={RUNNER_ENDPOINTS}
        folderGroups={RUNNER_GROUPS}
        onToggle={noop}
        onSelectAll={noop}
        onDeselectAll={noop}
        onReset={noop}
      />,
    )
  })

  it('RunnerSequence (flat, empty groups)', () => {
    mountsWithoutCrash(
      <RunnerSequence
        endpoints={RUNNER_ENDPOINTS}
        folderGroups={[]}
        onToggle={noop}
        onSelectAll={noop}
        onDeselectAll={noop}
        onReset={noop}
      />,
    )
  })

  it('RunnerResults (empty / pre-run)', () => {
    mountsWithoutCrash(
      <RunnerResults
        results={[]}
        report={null}
        isRunning={false}
        currentIndex={0}
        totalCount={0}
        runStartedAt={null}
        sourceLabel="Runner"
        onStop={noop}
        onNewRun={noop}
        onRunAgain={noop}
        onViewAllRuns={noop}
        selectedResultId={null}
        onSelectResult={noop}
      />,
    )
  })

  it('RunnerResults (running / in-flight)', () => {
    mountsWithoutCrash(
      <RunnerResults
        results={[]}
        report={null}
        isRunning={true}
        currentIndex={1}
        totalCount={2}
        runStartedAt={Date.now()}
        sourceLabel="APIs: Sample APIs"
        onStop={noop}
        onNewRun={noop}
        onRunAgain={noop}
        onViewAllRuns={noop}
        selectedResultId={null}
        onSelectResult={noop}
      />,
    )
  })
})

/* ── App frame ─────────────────────────────────────────────────────────────── */

describe('App frame — smoke mount', () => {
  it('Header', () => {
    mountsWithoutCrash(<Header />)
  })

  it('Footer', () => {
    mountsWithoutCrash(<Footer />)
  })

  it('LeftPanel (APIs page)', () => {
    mountsWithoutCrash(<LeftPanel />)
  })

  it('LeftPanel (Tests page)', () => {
    useUIStore.setState({ activeSidebarPage: 'tests' })
    mountsWithoutCrash(<LeftPanel />)
  })

  it('TreeView (populated tree)', () => {
    mountsWithoutCrash(<TreeView />)
  })

  it('ProjectHome', () => {
    mountsWithoutCrash(<ProjectHome />)
  })
})
