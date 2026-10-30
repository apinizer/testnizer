/**
 * Issue #281 (research D2/D4) — on the real Send path, `pm.environment`,
 * `pm.globals` and `pm.variables` are separate scopes, and `pm.request.body`
 * / `pm.info.requestId` / `pm.execution.location` are filled in.
 *
 * request.store used to seed `pm.environment` with `getActiveVariables()` —
 * globals AND environment merged — plus every earlier cascade write (local
 * ones included), so `pm.environment.get('aGlobal')` answered on Send. The
 * parity fixture cannot see this (its Send half builds the maps itself), so it
 * is pinned here, through `sendRequest()`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import type { Environment } from '../../src/renderer/types'

function installMockApi(): void {
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
    { id: 'v1', key: 'onlyEnv', value: 'E1', initialValue: 'E1', enabled: true, secret: false },
    { id: 'v2', key: 'shared', value: 'E', initialValue: 'E', enabled: true, secret: false },
  ],
  created_at: 0,
  updated_at: 0,
}

describe('Send — pm scopes stay separate (issue #281)', () => {
  beforeEach(() => {
    installMockApi()
    useResponseStore.setState({ response: null, isLoading: false })
    useTabsStore.setState({ tabs: [], activeTabId: null })
    useEnvironmentStore.setState({
      ...useEnvironmentStore.getState(),
      environments: [structuredClone(activeEnv)],
      globalVariables: [
        {
          id: 'g1',
          key: 'onlyGlobal',
          value: 'G1',
          initialValue: 'G1',
          enabled: true,
          secret: false,
        },
        { id: 'g2', key: 'shared', value: 'G', initialValue: 'G', enabled: true, secret: false },
      ],
      activeEnvironmentId: 'env1',
    })
  })

  it('pm.environment does not see globals; pm.variables merges them', async () => {
    useRequestStore.setState({
      ...useRequestStore.getState(),
      method: 'POST',
      url: 'https://example.test/x',
      params: [],
      headers: [],
      body: { type: 'json', content: '{"a":1}' },
      preScript: `
        pm.environment.set('pre', [
          String(pm.environment.get('onlyGlobal')),
          pm.environment.get('onlyEnv'),
          pm.globals.get('onlyGlobal'),
          String(pm.globals.get('onlyEnv')),
          pm.variables.get('shared'),
          pm.variables.get('onlyGlobal'),
          pm.request.body.raw,
        ].join(','));
        pm.variables.set('loc', 'L');
      `,
      postScript: `
        pm.environment.set('post', [
          String(pm.environment.get('loc')),
          pm.variables.get('loc'),
          pm.environment.get('pre') ? 'seen' : 'missing',
          pm.request.body.mode,
        ].join(','));
      `,
    })

    await useRequestStore.getState().sendRequest()

    const env = useEnvironmentStore.getState().environments.find((e) => e.id === 'env1')
    const get = (k: string): string | undefined => env?.variables.find((v) => v.key === k)?.value
    expect(get('pre')).toBe('undefined,E1,G1,undefined,E,G1,{"a":1}')
    // A pre-request local is visible to the post-response script through
    // pm.variables, never through pm.environment.
    expect(get('post')).toBe('undefined,L,seen,raw')
  })
})
