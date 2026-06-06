/**
 * Regression test for the "request timeout vs general timeout conflict" bug.
 *
 * The per-request Settings tab timeout used to default to `0`, which axios
 * (and our engine) treat as "no timeout". Because `0` is a valid number, the
 * Send path's `reqCfg.requestTimeout ?? netSettings.requestTimeout` fallback
 * never fired — so the project-level *and* app-wide "general" timeouts were
 * silently dead. A user configuring a general timeout saw it ignored.
 *
 * The fix gives the per-request value three meanings: `null` = inherit, `0` =
 * explicit no-timeout, `>0` = explicit timeout. The Send path resolves them in
 * order: per-request → project general → app-wide general → engine default.
 *
 * These tests stub `window.api` and assert the exact `timeout` forwarded to
 * the `request.send` IPC for each tier of the hierarchy.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'

const PROJECT_ID = 'proj-timeout-1'

interface SettingsResponder {
  (key: string): { success: boolean; data?: unknown }
}

function installMockApi(responder: SettingsResponder): { send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(async () => ({
    success: true,
    data: {
      requestId: 'mock-req-1',
      protocol: 'http',
      status: 200,
      statusText: 'OK',
      headers: {},
      body: '{}',
      bodySize: 2,
      timing: { total: 1 },
    },
  }))
  const api = {
    request: { send, cancel: vi.fn() },
    settings: { get: vi.fn(async (key: string) => responder(key)) },
  }
  ;(globalThis as unknown as { window: { api: typeof api } }).window = { api }
  return { send }
}

/** Build a responder for project + app-wide timeout values (omit = absent). */
function settingsWith(opts: { projectTimeout?: number; appDefault?: number }): SettingsResponder {
  return (key: string) => {
    if (key === `project.${PROJECT_ID}.settings`) {
      return {
        success: true,
        data: opts.projectTimeout == null ? {} : { requestTimeout: opts.projectTimeout },
      }
    }
    if (key === 'defaultTimeout') {
      return { success: true, data: opts.appDefault }
    }
    return { success: true, data: undefined }
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
    activeProjectId: PROJECT_ID,
    activeWorkspaceId: 'ws-1',
  })
  useRequestStore.setState({
    ...useRequestStore.getState(),
    method: 'GET',
    url: 'https://example.test/echo',
    params: [],
    headers: [],
    body: { type: 'none' },
    auth: { type: 'none' },
    preScript: '',
    postScript: '',
    assertions: [],
    followRedirects: true,
    maxRedirects: 5,
    sslVerification: true,
    requestTimeout: null,
    _tabStates: new Map(),
    _currentTabId: null,
    _inflightRequestId: null,
  })
}

function sentTimeout(send: ReturnType<typeof vi.fn>): unknown {
  return (send.mock.calls[0]?.[0] as { timeout?: unknown } | undefined)?.timeout
}

describe('useRequestStore.sendRequest — timeout resolution hierarchy', () => {
  beforeEach(() => {
    resetStores()
  })

  it('inherits the project-level general timeout when per-request is untouched (null)', async () => {
    const { send } = installMockApi(settingsWith({ projectTimeout: 5000, appDefault: 30000 }))
    useRequestStore.setState({ requestTimeout: null })

    await useRequestStore.getState().sendRequest()

    expect(send).toHaveBeenCalledTimes(1)
    expect(sentTimeout(send)).toBe(5000)
  })

  it('falls back to the app-wide general timeout when no project timeout is set', async () => {
    const { send } = installMockApi(settingsWith({ appDefault: 8000 }))
    useRequestStore.setState({ requestTimeout: null })

    await useRequestStore.getState().sendRequest()

    expect(sentTimeout(send)).toBe(8000)
  })

  it('an explicit per-request value overrides both general timeouts', async () => {
    const { send } = installMockApi(settingsWith({ projectTimeout: 5000, appDefault: 30000 }))
    useRequestStore.setState({ requestTimeout: 1234 })

    await useRequestStore.getState().sendRequest()

    expect(sentTimeout(send)).toBe(1234)
  })

  it('an explicit per-request 0 (no timeout) wins over a configured general timeout', async () => {
    const { send } = installMockApi(settingsWith({ projectTimeout: 5000, appDefault: 30000 }))
    useRequestStore.setState({ requestTimeout: 0 })

    await useRequestStore.getState().sendRequest()

    // 0 must reach the engine intact — the engine reads it as "no timeout".
    expect(sentTimeout(send)).toBe(0)
  })

  it('leaves timeout undefined (engine 30s default) when nothing is configured', async () => {
    const { send } = installMockApi(settingsWith({}))
    useRequestStore.setState({ requestTimeout: null })

    await useRequestStore.getState().sendRequest()

    expect(sentTimeout(send)).toBeUndefined()
  })
})
