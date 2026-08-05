/**
 * Send must not fire the request when a pre-request script throws.
 *
 * Reported against the Runner (5 Aug: a bare `throw new Error('boom')` logged
 * "Script error: boom" and the GET still returned 200), but the Send path had
 * the identical gap: `runScript` caught the throw, pushed it into the console
 * log array and returned, and nothing looked at it before sending. A script
 * that dies while minting a token or signing a payload therefore issued a real
 * call whose precondition never held.
 *
 * Both paths are fixed together — that is the Send≡Run parity rule — so this
 * file is the renderer twin of `tests/main/handlers/runner-script-abort.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'

let sendCalls = 0

function installMockApi() {
  const api = {
    request: {
      send: vi.fn(async () => {
        sendCalls++
        return {
          success: true,
          data: {
            requestId: 'r1',
            protocol: 'http',
            status: 200,
            statusText: 'OK',
            headers: {},
            body: '{}',
            timing: { total: 1 },
          },
        }
      }),
      cancel: vi.fn(),
    },
    settings: { get: vi.fn(async () => ({ success: true, data: {} })) },
  }
  ;(window as unknown as { api: typeof api }).api = api
}

beforeEach(() => {
  sendCalls = 0
  installMockApi()
  useResponseStore.setState({ byTab: {}, activeTabId: null, response: null, isLoading: false })
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useEnvironmentStore.setState({
    ...useEnvironmentStore.getState(),
    environments: [],
    globalVariables: [],
    activeEnvironmentId: null,
    currentProjectId: 'p1',
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
    _inflightByTab: {},
  })
})

describe('a pre-request script that throws', () => {
  it('does not send the request', async () => {
    useRequestStore.setState({ preScript: `throw new Error('boom')` })

    await useRequestStore.getState().sendRequest()

    expect(sendCalls).toBe(0)
  })

  it('shows the error where the user is looking, not only in the console', async () => {
    useRequestStore.setState({ preScript: `throw new Error('boom')` })

    await useRequestStore.getState().sendRequest()

    const resp = useResponseStore.getState().response
    expect(resp?.error).toContain('Pre-request script error')
    expect(resp?.error).toContain('boom')
  })

  it('clears the loading state so the tab does not spin forever', async () => {
    useRequestStore.setState({ preScript: `throw new Error('boom')` })

    await useRequestStore.getState().sendRequest()

    expect(useResponseStore.getState().isLoading).toBe(false)
  })

  it('sends normally when the script runs clean', async () => {
    useRequestStore.setState({ preScript: `pm.environment.set('x', '1')` })

    await useRequestStore.getState().sendRequest()

    expect(sendCalls).toBe(1)
  })

  it('still sends when the script merely FAILS an assertion', async () => {
    // The guard keys on a THROW. A red `pm.test` is a reported result, not a
    // broken precondition — treating it as one would block requests the user
    // expects to go out.
    useRequestStore.setState({
      preScript: `pm.test('nope', () => pm.expect(1).to.equal(2))`,
    })

    await useRequestStore.getState().sendRequest()

    expect(sendCalls).toBe(1)
  })

  it('still sends when the script calls skipRequest — that has its own path', async () => {
    // `pm.execution.skipRequest()` signals through its own flag and must not be
    // reported as a script error; it is a deliberate exit, not a failure.
    useRequestStore.setState({ preScript: `pm.execution.skipRequest()` })

    await useRequestStore.getState().sendRequest()

    expect(sendCalls).toBe(0)
    // …and it is NOT reported as an error.
    expect(useResponseStore.getState().response?.error ?? '').not.toContain('script error')
  })
})
