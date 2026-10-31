/**
 * Issue #254 — Send: a project that never set its own timeout uses the app
 * `defaultTimeout`, even after it has gone through the project dialog.
 *
 * Why: `ProjectDetailModal.DEFAULT_SETTINGS.requestTimeout = 30000` was written
 * on the very first Save of EVERY project (the SSL / redirects defaults had the
 * same flaw until issue #287). That frozen 30000 sat above the app Settings
 * timeout in `resolveHttpTimeout(request, project, app)`, so changing the app
 * timeout silently did nothing for any project that had ever been saved.
 *
 * The chain is driven for real: the project dialog is rendered and saved, the
 * saved object is what `settings:get` returns afterwards (the in-memory
 * `settings` mock mirrors the main handler: shared keys merge, and an explicit
 * `null` — the "Use app setting" delete marker — removes the key; see
 * tests/main/handlers/settings-use-app-setting-254.test.ts), and the Send path
 * (`request.store.sendRequest` -> `request:send` payload) is read.
 *
 *  - first Save, untouched  -> Send timeout is the app value       RED today (30000)
 *  - legacy 30000 project   -> still 30000 (pin: why reset exists) GREEN before/after
 *  - legacy + "Use app setting" + Save -> Send timeout is the app value   RED today
 *  - a timeout the user typed stays the project's                  red only for the missing testid
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import ProjectDetailModal from '../../src/renderer/components/modals/ProjectDetailModal'
import { openEndpointTab } from '../../src/renderer/lib/open-endpoint-tab'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'

const PID = 'p-254t'
const PKEY = `project.${PID}.settings`
const APP_TIMEOUT = 45000
const PROJECT = {
  id: PID,
  workspace_id: 'w1',
  name: 'orders-api',
  display_name: 'Orders API',
  type: 'http' as const,
  save_mode: 'local' as const,
  sort_order: 0,
  created_at: 1,
  updated_at: 1,
}

type Obj = Record<string, unknown>
const ok = (data: unknown) => ({ success: true, data })

let projectStored: Obj
let send: ReturnType<typeof vi.fn>

function installApi(initialProject: Obj) {
  projectStored = { ...initialProject }
  send = vi.fn(async (_p: Obj) =>
    ok({
      requestId: 'r',
      protocol: 'http',
      status: 200,
      statusText: 'OK',
      headers: {},
      body: '{}',
      bodySize: 2,
      timing: { total: 1 },
    }),
  )
  const endpoints = new Map<string, Obj>([
    [
      'ep-1',
      {
        id: 'ep-1',
        project_id: PID,
        name: 'Hop',
        method: 'GET',
        path: '/',
        protocol: 'http',
        request_schema: JSON.stringify({ method: 'GET', url: 'https://hop.test/' }),
      },
    ],
  ])
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    request: { send, cancel: vi.fn() },
    settings: {
      get: vi.fn(async (key: string) => {
        if (key === PKEY) return ok({ ...projectStored })
        if (key === 'defaultTimeout') return ok(APP_TIMEOUT)
        return ok(undefined)
      }),
      getAll: vi.fn(async () => ok({ defaultTimeout: APP_TIMEOUT })),
      // Mirrors settings.handler: shared keys merge into what is stored,
      // `null` on a shared key is the delete marker (never stored).
      set: vi.fn(async (key: string, value: Obj) => {
        if (key !== PKEY) return ok(true)
        const next: Obj = { ...projectStored, ...value }
        for (const k of Object.keys(next)) if (next[k] === null) delete next[k]
        projectStored = next
        return ok(true)
      }),
      setAll: vi.fn(),
    },
    endpoint: {
      get: vi.fn(async (id: string) => ok(endpoints.get(id) ?? null)),
      update: vi.fn(async () => ok(true)),
    },
    certificate: { list: vi.fn(async () => ok([])) },
    folder: { list: vi.fn(async () => ok([])) },
    savedRequest: { get: vi.fn(async () => ok(null)), update: vi.fn(async () => ok(true)) },
    testSuiteItem: { get: vi.fn(async () => ok(null)), update: vi.fn(async () => ok(true)) },
  }
}

function resetStores(): void {
  useResponseStore.setState({ response: null, isLoading: false })
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useEnvironmentStore.setState({
    ...useEnvironmentStore.getState(),
    environments: [],
    globalVariables: [],
    activeEnvironmentId: null,
    currentProjectId: null,
  })
  useWorkspaceStore.setState({
    ...useWorkspaceStore.getState(),
    projects: [PROJECT],
    activeProjectId: PID,
    activeWorkspaceId: 'ws-1',
    refreshTree: vi.fn().mockResolvedValue(undefined),
    updateProject: vi.fn(async () => true),
    renameProject: vi.fn(async () => true),
  } as never)
  useRequestStore.setState({ _tabStates: new Map(), _currentTabId: null })
}

async function sendTimeout(): Promise<unknown> {
  await openEndpointTab('ep-1')
  await useRequestStore.getState().sendRequest()
  expect(send).toHaveBeenCalled()
  return (send.mock.calls[send.mock.calls.length - 1][0] as Obj).timeout
}

async function saveProjectDialog(afterOpen?: () => Promise<void>): Promise<void> {
  useUIStore.setState({ showProjectDetailModal: true })
  render(React.createElement(ProjectDetailModal))
  await afterOpen?.()
  fireEvent.click(await screen.findByRole('button', { name: /Save Changes/i }))
  await waitFor(() => expect(useUIStore.getState().showProjectDetailModal).toBe(false))
}

beforeEach(() => {
  resetStores()
})
afterEach(() => {
  for (const t of useTabsStore.getState().tabs) useRequestStore.getState().removeTabState(t.id)
  cleanup()
})

describe('issue #254 — Send resolves the timeout request -> project -> app', () => {
  it('RED today: a project saved untouched still follows the app defaultTimeout', async () => {
    installApi({})
    await saveProjectDialog()
    expect(projectStored).not.toHaveProperty('requestTimeout')
    expect(await sendTimeout()).toBe(APP_TIMEOUT)
  })

  it('PIN (green today): a legacy requestTimeout:30000 shadows the app value — the reason "Use app setting" exists', async () => {
    installApi({ requestTimeout: 30000 })
    expect(await sendTimeout()).toBe(30000)
  })

  it('RED today: legacy 30000 + "Use app setting" + Save -> Send follows the app value again', async () => {
    installApi({ requestTimeout: 30000, sslVerification: true, followRedirects: true })
    await saveProjectDialog(async () => {
      fireEvent.click(await screen.findByTestId('project-detail-tab-general'))
      fireEvent.click(await screen.findByTestId('project-setting-reset-timeout'))
    })
    expect(projectStored).not.toHaveProperty('requestTimeout')
    // the other legacy values were not touched by resetting the timeout
    expect(projectStored).toMatchObject({ sslVerification: true, followRedirects: true })
    expect(await sendTimeout()).toBe(APP_TIMEOUT)
  })

  it('a timeout the user typed stays the project’s own (red today only: missing project-timeout-input testid)', async () => {
    installApi({})
    await saveProjectDialog(async () => {
      fireEvent.click(await screen.findByTestId('project-detail-tab-general'))
      const input = (await screen.findByTestId('project-timeout-input')) as HTMLInputElement
      fireEvent.change(input, { target: { value: '7000' } })
    })
    expect(projectStored.requestTimeout).toBe(7000)
    expect(await sendTimeout()).toBe(7000)
  })
})
