/**
 * Issue #289 / issue #281 follow-up — `insomnia.environment` on the Send path.
 *
 * Insomnia's active environment is the base environment when no
 * sub-environment is selected; the importer puts the base environment in the
 * project variables. So with no Testnizer environment selected, a token
 * captured by `insomnia.environment.set` is a project variable: persisted
 * there and resolved by the next Send. With an environment selected (a
 * project imported earlier, base environment as an active environment) it
 * goes to that environment, exactly as before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import type { Environment, GlobalVariable } from '../../src/renderer/types'

let calls: string[] = []
let sentUrls: string[] = []

function installMockApi(): void {
  let n = 0
  const api = {
    request: {
      send: vi.fn(async (opts: { url: string }) => {
        sentUrls.push(opts.url)
        return {
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
        }
      }),
      cancel: vi.fn(),
    },
    settings: { get: vi.fn(async () => ({ success: true, data: {} })) },
    globalVariable: {
      create: vi.fn(async (p: Record<string, unknown>) => {
        calls.push(`globalVariable.create:${String(p.key)}=${String(p.value)}`)
        n++
        return {
          success: true,
          data: {
            id: `g-new-${n}`,
            workspace_id: 'ws1',
            key: p.key,
            value: p.value,
            initial_value: p.initial_value,
            enabled: 1,
            secret: 0,
          },
        }
      }),
      update: vi.fn(async () => ({ success: true })),
      delete: vi.fn(async () => ({ success: true, data: true })),
    },
    envVariable: {
      create: vi.fn(async (p: Record<string, unknown>) => {
        calls.push(`envVariable.create:${String(p.key)}=${String(p.value)}`)
        return { success: true }
      }),
      update: vi.fn(async () => ({ success: true })),
    },
  }
  ;(globalThis as unknown as { window: { api: typeof api } }).window = { api }
}

const baseGlobals: GlobalVariable[] = [
  {
    id: 'g-url',
    workspace_id: 'ws1',
    key: 'AccessURL',
    value: 'http://base',
    initialValue: 'http://base',
    enabled: true,
    secret: false,
  },
]

const oldBaseEnv: Environment = {
  id: 'env-old',
  workspace_id: 'ws1',
  name: 'Base Environment',
  is_active: true,
  variables: [{ id: 'ev-url', key: 'AccessURL', value: 'http://old', enabled: true, secret: false }],
  created_at: 0,
  updated_at: 0,
}

beforeEach(() => {
  calls = []
  sentUrls = []
  installMockApi()
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws1', activeProjectId: 'p1' })
  useResponseStore.setState({ response: null, isLoading: false })
  useTabsStore.setState({ tabs: [], activeTabId: null })
})

async function send(url: string, preScript: string, postScript: string): Promise<void> {
  useRequestStore.setState({
    ...useRequestStore.getState(),
    method: 'GET',
    url,
    params: [],
    headers: [],
    preScript,
    postScript,
  })
  await useRequestStore.getState().sendRequest()
}

const CAPTURE = "insomnia.environment.set('accessToken', 'tok-' + insomnia.environment.get('AccessURL'))"

describe('Send — insomnia.environment and the base environment (issue #289)', () => {
  it('no environment selected: the captured token is a project variable and resolves next Send', async () => {
    useEnvironmentStore.setState({
      ...useEnvironmentStore.getState(),
      currentProjectId: 'p1',
      environments: [],
      globalVariables: structuredClone(baseGlobals),
      activeEnvironmentId: null,
    })
    await send('{{AccessURL}}/login', '', CAPTURE)
    await vi.waitFor(() =>
      expect(calls).toContain('globalVariable.create:accessToken=tok-http://base'),
    )
    expect(calls.some((c) => c.startsWith('envVariable.'))).toBe(false)

    await send('{{AccessURL}}/me?t={{accessToken}}', '', '')
    expect(sentUrls).toEqual(['http://base/login', 'http://base/me?t=tok-http://base'])
  })

  it('an environment selected (earlier import): the token goes to that environment, as before', async () => {
    useEnvironmentStore.setState({
      ...useEnvironmentStore.getState(),
      currentProjectId: 'p1',
      environments: [structuredClone(oldBaseEnv)],
      globalVariables: [],
      activeEnvironmentId: 'env-old',
    })
    await send('{{AccessURL}}/login', '', CAPTURE)
    await vi.waitFor(() =>
      expect(calls).toContain('envVariable.create:accessToken=tok-http://old'),
    )
    expect(calls.some((c) => c.startsWith('globalVariable.'))).toBe(false)

    await send('{{AccessURL}}/me?t={{accessToken}}', '', '')
    expect(sentUrls).toEqual(['http://old/login', 'http://old/me?t=tok-http://old'])
  })
})
