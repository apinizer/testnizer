/**
 * Regression test for the "No tests were run for this request" bug.
 *
 * The Tests tab (TestsTab.tsx) writes the script to `useRequestStore.postScript`,
 * and `sendRequest()` is supposed to execute that script after the response
 * comes back, populate the response with `testResults`, and surface them in the
 * Test Results panel (TestResultsTab.tsx).
 *
 * This test stubs the `window.api.request.send` IPC so we can verify the
 * post-script branch end-to-end at the renderer level: a user writes a
 * `pm.test(...)` script, calls `sendRequest()`, and the resulting response
 * must contain at least one test result so the panel renders 1/1 passed
 * instead of the empty-state copy.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'

interface MockApi {
  request: {
    send: ReturnType<typeof vi.fn>
    cancel: ReturnType<typeof vi.fn>
  }
  settings: {
    get: ReturnType<typeof vi.fn>
  }
}

function installMockApi(): MockApi {
  const api: MockApi = {
    request: {
      send: vi.fn(async () => ({
        success: true,
        data: {
          requestId: 'mock-req-1',
          protocol: 'http',
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          body: '{"hello":"world"}',
          bodySize: 17,
          timing: { total: 12 },
        },
      })),
      cancel: vi.fn(),
    },
    settings: {
      get: vi.fn(async () => ({ success: true, data: {} })),
    },
  }
  ;(globalThis as unknown as { window: { api: MockApi } }).window = { api }
  return api
}

describe('useRequestStore.sendRequest — post-response pm.test pipeline', () => {
  beforeEach(() => {
    installMockApi()
    useResponseStore.setState({ response: null, isLoading: false })
    useTabsStore.setState({ tabs: [], activeTabId: null })
    useEnvironmentStore.setState({
      ...useEnvironmentStore.getState(),
      environments: [],
      globalVariables: [],
      activeEnvironmentId: null,
      currentProjectId: null,
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
      _tabStates: new Map(),
      _currentTabId: null,
      _inflightRequestId: null,
    })
  })

  it('runs a passing pm.test/pm.expect script and surfaces 1/1 passed in the response', async () => {
    useRequestStore.setState({
      postScript: `pm.test("status is 200", () => { pm.expect(pm.response.code).to.equal(200) })`,
    })

    await useRequestStore.getState().sendRequest()

    const resp = useResponseStore.getState().response
    expect(resp).not.toBeNull()
    expect(resp?.testResults).toBeDefined()
    expect(resp?.testResults).toHaveLength(1)
    expect(resp?.testResults?.[0].passed).toBe(true)
    expect(resp?.testResults?.[0].assertion.name).toBe('status is 200')
  })

  it('reports a failing pm.expect assertion as a failed test result', async () => {
    useRequestStore.setState({
      postScript: `pm.test("status is 201", () => { pm.expect(pm.response.code).to.equal(201) })`,
    })

    await useRequestStore.getState().sendRequest()

    const resp = useResponseStore.getState().response
    expect(resp?.testResults).toHaveLength(1)
    expect(resp?.testResults?.[0].passed).toBe(false)
    expect(resp?.testResults?.[0].error).toMatch(/Expected 201/)
  })

  it('produces no test results when postScript is empty (empty-state copy)', async () => {
    await useRequestStore.getState().sendRequest()
    const resp = useResponseStore.getState().response
    expect(resp).not.toBeNull()
    // No testResults => TestResultsTab renders the "No tests were run" message.
    expect(resp?.testResults).toBeUndefined()
  })

  /**
   * Regression guard for the TestsTab / ScriptsTab "placeholder lie" bug:
   * the editors used to render a fully-formed `pm.test(...)` snippet as the
   * Monaco `value` when `postScript` was empty, without ever writing it back
   * to the store. The user saw a script in the editor, hit Send, and got
   * "No tests were run for this request" because `sendRequest()` reads from
   * the store, not from what Monaco renders. The contract from the store's
   * side is unchanged — only the editors learned to keep value and state in
   * sync — but pin the behaviour here so a future "helpful default" PR
   * can't silently bring the bug back.
   */
  it('does not invent test results when only the editor placeholder existed', async () => {
    // Simulate the old buggy editors having shown a placeholder pm.test(...)
    // to the user without persisting it: `postScript` stays empty in the
    // store. sendRequest must NOT fabricate test results.
    useRequestStore.setState({ postScript: '' })

    await useRequestStore.getState().sendRequest()

    const resp = useResponseStore.getState().response
    expect(resp?.testResults).toBeUndefined()
  })
})
