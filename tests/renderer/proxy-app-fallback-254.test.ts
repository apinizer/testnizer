/**
 * Issue #254 (orchestrator decision) — Send: the App settings proxy is a REAL
 * fallback. `networkPayload` used to forward `project.proxy` only, so the app
 * dialog's proxy was saved and read by nothing.
 *
 * Rule (`resolveProxy`, src/shared/request-settings.ts — Run uses the same,
 * tests/main/handlers/runner-app-proxy-254.test.ts): the project's own proxy
 * when it configures one ("No proxy" or custom with a host) → the app proxy →
 * none. A frozen project `{mode:'system'}` (the old dialog default) is not an
 * override. Driven through `request.store.sendRequest` → `request:send`.
 *
 * Fail-before: the "app proxy" cases sent `proxy: undefined` / `{mode:'system'}`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openEndpointTab } from '../../src/renderer/lib/open-endpoint-tab'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'

const PID = 'proj-proxy-254'
type Obj = Record<string, unknown>
const ok = (data: unknown) => ({ success: true, data })

const APP_PROXY = {
  mode: 'custom',
  host: 'app.proxy.test',
  port: 3128,
  auth: { username: 'alice', password: 's3cret' },
}
const PROJECT_PROXY = { mode: 'custom', host: 'project.proxy.test', port: 8888 }

let send: ReturnType<typeof vi.fn>

function setup(cfg: { project?: Obj; appProxy?: Obj }): void {
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
  const endpoint = {
    id: 'ep-1',
    project_id: PID,
    name: 'Hop',
    method: 'GET',
    path: '/',
    protocol: 'http',
    request_schema: JSON.stringify({ method: 'GET', url: 'https://hop.test/' }),
  }
  ;(window as unknown as { api: Obj }).api = {
    request: { send, cancel: vi.fn() },
    settings: {
      get: vi.fn(async (key: string) => {
        if (key === `project.${PID}.settings`) return ok(cfg.project ?? {})
        // settings:get returns the app proxy with its password decrypted.
        if (key === 'proxy') return ok(cfg.appProxy)
        return ok(undefined)
      }),
    },
    endpoint: {
      get: vi.fn(async () => ok(endpoint)),
      update: vi.fn(async () => ok(true)),
    },
    folder: { list: vi.fn(async () => ok([])) },
    savedRequest: { get: vi.fn(async () => ok(null)), update: vi.fn(async () => ok(true)) },
    testSuiteItem: { get: vi.fn(async () => ok(null)), update: vi.fn(async () => ok(true)) },
  }
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
    activeProjectId: PID,
    activeWorkspaceId: 'ws-1',
    refreshTree: vi.fn().mockResolvedValue(undefined),
  })
  useRequestStore.setState({ _tabStates: new Map(), _currentTabId: null })
}

async function sentProxy(): Promise<unknown> {
  await openEndpointTab('ep-1')
  await useRequestStore.getState().sendRequest()
  expect(send).toHaveBeenCalled()
  return (send.mock.calls[send.mock.calls.length - 1][0] as Obj).proxy
}

afterEach(() => {
  for (const t of useTabsStore.getState().tabs) useRequestStore.getState().removeTabState(t.id)
})

describe('issue #254 — Send falls back to the App settings proxy', () => {
  it('a project without a proxy sends through the app proxy (credentials included)', async () => {
    setup({ project: {}, appProxy: APP_PROXY })
    expect(await sentProxy()).toEqual(APP_PROXY)
  })

  it('the frozen legacy project {mode:"system"} is not an override', async () => {
    setup({ project: { proxy: { mode: 'system' } }, appProxy: APP_PROXY })
    expect(await sentProxy()).toEqual(APP_PROXY)
  })

  it('the project’s own custom proxy wins', async () => {
    setup({ project: { proxy: PROJECT_PROXY }, appProxy: APP_PROXY })
    expect(await sentProxy()).toEqual(PROJECT_PROXY)
  })

  it('project "No proxy" wins over an app custom proxy', async () => {
    setup({ project: { proxy: { mode: 'none' } }, appProxy: APP_PROXY })
    expect(await sentProxy()).toEqual({ mode: 'none' })
  })

  it('an app proxy left on "system" with no project proxy sends none', async () => {
    setup({ project: {}, appProxy: { mode: 'system' } })
    expect(await sentProxy()).toBeUndefined()
  })
})
