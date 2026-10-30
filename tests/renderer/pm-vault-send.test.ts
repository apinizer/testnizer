/**
 * Issue #281 — `pm.vault` on the Send path: its writes are SECRET project
 * variables (Globals).
 *
 *  - `applyScriptUpdates` applies vault writes after the plain globals and
 *    wins for their keys: a value creates / updates the variable as secret,
 *    null deletes it (only a secret one).
 *  - A pre-request `pm.vault.set` is stored as a secret BEFORE the request is
 *    sent: History and the Console mask from the DB's secrets, so a token
 *    stored afterwards would reach History in clear text.
 *  - `pm.collectionVariables.set` persists like `pm.globals.set` (project
 *    variable), never into the active environment.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import type { Environment, GlobalVariable } from '../../src/renderer/types'

/** Ordered log of the IPC calls the Send flow made. */
let calls: string[] = []

function installMockApi(): Record<string, Record<string, ReturnType<typeof vi.fn>>> {
  let n = 0
  const api = {
    request: {
      send: vi.fn(async () => {
        calls.push('request.send')
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
        // A slow keychain write: the send must still wait for it.
        await new Promise((r) => setTimeout(r, 20))
        calls.push(`globalVariable.create:${String(p.key)}:${p.secret ? 'secret' : 'plain'}`)
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
            secret: p.secret ? 1 : 0,
          },
        }
      }),
      update: vi.fn(async (id: string, p: Record<string, unknown>) => {
        calls.push(`globalVariable.update:${id}:${p.secret === true ? 'secret' : 'keep'}`)
        return { success: true }
      }),
      delete: vi.fn(async (id: string) => {
        calls.push(`globalVariable.delete:${id}`)
        return { success: true, data: true }
      }),
    },
    envVariable: {
      create: vi.fn(async () => {
        calls.push('envVariable.create')
        return { success: true }
      }),
      update: vi.fn(async () => {
        calls.push('envVariable.update')
        return { success: true }
      }),
    },
  }
  ;(globalThis as unknown as { window: { api: typeof api } }).window = { api }
  return api as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
}

const env: Environment = {
  id: 'env1',
  workspace_id: 'ws1',
  name: 'E',
  is_active: true,
  variables: [],
  created_at: 0,
  updated_at: 0,
}

const globals: GlobalVariable[] = [
  { id: 'g-plain', workspace_id: 'ws1', key: 'plain', value: 'P', initialValue: 'P', enabled: true, secret: false },
  { id: 'g-old', workspace_id: 'ws1', key: 'old', value: 'O', initialValue: 'O', enabled: true, secret: true },
]

beforeEach(() => {
  calls = []
  installMockApi()
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws1', activeProjectId: 'p1' })
  useResponseStore.setState({ response: null, isLoading: false })
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useEnvironmentStore.setState({
    ...useEnvironmentStore.getState(),
    currentProjectId: 'p1',
    environments: [structuredClone(env)],
    globalVariables: structuredClone(globals),
    activeEnvironmentId: 'env1',
  })
})

describe('applyScriptUpdates — vault writes (issue #281)', () => {
  it('creates / flips to secret / deletes, after the plain globals, and wins for its keys', async () => {
    await useEnvironmentStore
      .getState()
      .applyScriptUpdates({}, { nv: 'NS', plain: 'P2', old: '' }, { nv: 'NS', plain: 'P2', old: null })
    expect(calls).toEqual([
      'globalVariable.create:nv:secret',
      'globalVariable.update:g-plain:secret',
      'globalVariable.delete:g-old',
    ])
  })

  it('unset of a non-secret variable through the vault deletes nothing', async () => {
    await useEnvironmentStore.getState().applyScriptUpdates({}, {}, { plain: null })
    expect(calls).toEqual([])
  })
})

describe('Send — pm.vault / pm.collectionVariables in scripts (issue #281)', () => {
  it('a pre-request pm.vault.set is a secret project variable BEFORE the request is sent', async () => {
    useRequestStore.setState({
      ...useRequestStore.getState(),
      method: 'GET',
      url: 'https://example.test/{{tok}}',
      params: [],
      headers: [],
      preScript: `await pm.vault.set('tok', 'vault-T0K')`,
      postScript: '',
    })
    await useRequestStore.getState().sendRequest()
    expect(calls.indexOf('globalVariable.create:tok:secret')).toBeGreaterThanOrEqual(0)
    expect(calls.indexOf('globalVariable.create:tok:secret')).toBeLessThan(
      calls.indexOf('request.send'),
    )
    const api = (globalThis as unknown as { window: { api: { request: { send: ReturnType<typeof vi.fn> } } } })
      .window.api
    expect((api.request.send.mock.calls[0][0] as { url: string }).url).toBe(
      'https://example.test/vault-T0K',
    )
  })

  it('pm.collectionVariables.set persists to the project variables, not the environment', async () => {
    useRequestStore.setState({
      ...useRequestStore.getState(),
      method: 'GET',
      url: 'https://example.test/x',
      params: [],
      headers: [],
      preScript: `pm.collectionVariables.set('cv', 'C1')`,
      postScript: '',
    })
    await useRequestStore.getState().sendRequest()
    await vi.waitFor(() => expect(calls).toContain('globalVariable.create:cv:plain'))
    expect(calls).not.toContain('envVariable.create')
  })
})

/**
 * Security (issue #281 follow-up): a pre-request `pm.environment.set` /
 * `pm.globals.set` of a variable whose row is SECRET must reach the DB before
 * the request goes out — main masks History and the Console from the DB's
 * secrets, so a value still in flight would be written to History in clear
 * text. The `pm.vault` rule, generalised to any secret variable.
 */
describe('Send — a script write to a secret variable is stored before the request (security)', () => {
  function slowUpdates(): void {
    const api = (
      globalThis as unknown as {
        window: { api: Record<string, Record<string, ReturnType<typeof vi.fn>>> }
      }
    ).window.api
    api.envVariable.update.mockImplementation(async (id: string) => {
      // A slow keychain write: the send must still wait for it.
      await new Promise((r) => setTimeout(r, 20))
      calls.push(`envVariable.update:${id}`)
      return { success: true }
    })
    api.globalVariable.update.mockImplementation(async (id: string) => {
      await new Promise((r) => setTimeout(r, 20))
      calls.push(`globalVariable.update:${id}`)
      return { success: true }
    })
  }

  function sendWith(preScript: string): Promise<void> {
    useRequestStore.setState({
      ...useRequestStore.getState(),
      method: 'GET',
      url: 'https://example.test/x',
      params: [],
      headers: [],
      preScript,
      postScript: '',
    })
    return useRequestStore.getState().sendRequest()
  }

  it('pm.environment.set of a secret environment variable', async () => {
    slowUpdates()
    useEnvironmentStore.setState({
      environments: [
        {
          ...structuredClone(env),
          variables: [
            { id: 'ev-tok', key: 'tok', value: 'OLD', enabled: true, secret: true },
          ],
        },
      ],
    })
    await sendWith(`pm.environment.set('tok', 'NEW-SECRET')`)
    expect(calls.indexOf('envVariable.update:ev-tok')).toBeGreaterThanOrEqual(0)
    expect(calls.indexOf('envVariable.update:ev-tok')).toBeLessThan(calls.indexOf('request.send'))
  })

  it('pm.globals.set / pm.collectionVariables.set of a secret project variable', async () => {
    slowUpdates()
    await sendWith(`pm.collectionVariables.set('old', 'NEW-SECRET')`)
    expect(calls.indexOf('globalVariable.update:g-old')).toBeGreaterThanOrEqual(0)
    expect(calls.indexOf('globalVariable.update:g-old')).toBeLessThan(
      calls.indexOf('request.send'),
    )
  })

  it('a plain variable write does not hold the request back', async () => {
    slowUpdates()
    await sendWith(`pm.globals.set('plain', 'P2')`)
    // Persisted in the background, after the request went out.
    await vi.waitFor(() => expect(calls).toContain('globalVariable.update:g-plain'))
    expect(calls.indexOf('request.send')).toBeLessThan(calls.indexOf('globalVariable.update:g-plain'))
  })
})
