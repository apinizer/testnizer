/**
 * Issue #29 — a variable written by a request's PRE-request script must persist
 * to the active environment so a later, separately-sent request sees it. Send
 * previously folded pre-request pm.environment.set writes only into a transient
 * per-send overrides map (post-response writes already persisted), so a derived
 * value set in one request's pre-script was invisible to the next send.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import type { Environment } from '../../src/renderer/types'

function installMockApi() {
  const api = {
    request: {
      send: vi.fn(async () => ({
        success: true,
        data: {
          requestId: 'r1',
          protocol: 'http',
          status: 200,
          statusText: 'OK',
          headers: {},
          body: '{}',
          bodySize: 2,
          timing: { total: 1 },
        },
      })),
      cancel: vi.fn(),
    },
    settings: { get: vi.fn(async () => ({ success: true, data: {} })) },
  }
  ;(globalThis as unknown as { window: { api: typeof api } }).window = { api }
}

const activeEnv: Environment = {
  id: 'env1',
  workspace_id: 'ws1',
  name: 'E',
  is_active: true,
  variables: [
    { id: 'v1', key: 'runId', value: 'OLD', initialValue: 'OLD', enabled: true, secret: false },
    {
      id: 'v2',
      key: 'proxyName',
      value: 'col-OLD',
      initialValue: 'col-OLD',
      enabled: true,
      secret: false,
    },
  ],
  created_at: 0,
  updated_at: 0,
}

describe('sendRequest — pre-request env writes persist (issue #29)', () => {
  beforeEach(() => {
    installMockApi()
    useResponseStore.setState({ response: null, isLoading: false })
    useTabsStore.setState({ tabs: [], activeTabId: null })
    useEnvironmentStore.setState({
      ...useEnvironmentStore.getState(),
      environments: [structuredClone(activeEnv)],
      globalVariables: [],
      activeEnvironmentId: 'env1',
    })
  })

  it('writes a pre-request pm.environment.set back to the active environment', async () => {
    useRequestStore.setState({
      ...useRequestStore.getState(),
      method: 'GET',
      url: 'https://example.test/x',
      params: [],
      headers: [],
      preScript: `pm.environment.set('runId', 'NEW');
        pm.environment.set('proxyName', 'col-' + pm.environment.get('runId'))`,
      postScript: '',
    })

    await useRequestStore.getState().sendRequest()

    const env = useEnvironmentStore.getState().environments.find((e) => e.id === 'env1')
    expect(env?.variables.find((v) => v.key === 'runId')?.value).toBe('NEW')
    // The derived value rebuilt from the just-set runId must persist too.
    expect(env?.variables.find((v) => v.key === 'proxyName')?.value).toBe('col-NEW')
  })
})
