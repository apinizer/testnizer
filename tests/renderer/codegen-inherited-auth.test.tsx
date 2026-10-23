/**
 * Issue #276 — Generate Code shows what Send sends.
 *
 * A Postman import stores `{type:'inherit'}` on every request and puts the
 * collection auth on the import folder or the project. The snippet used the
 * request's own auth only, so an imported request generated code with NO
 * Authorization header. `useGeneratedCode` now resolves inheritance through
 * the same `resolveInheritance` Send uses (request → folder → project, `none`
 * stops), and substitutes `:name` path variables like Send.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useGeneratedCode } from '../../src/renderer/components/shared/use-generated-code'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { generateCode } from '../../src/renderer/lib/code-generator'
import type { AuthConfig, Tab } from '../../src/renderer/types'

const ok = (data: unknown) => ({ success: true, data })

function installApi(opts: {
  folderId: string | null
  folders: Array<{ id: string; parent_id: string | null; auth?: string | null }>
  projectAuth?: Record<string, unknown>
}): void {
  ;(window as unknown as { api: unknown }).api = {
    endpoint: { get: vi.fn(async () => ok({ folder_id: opts.folderId })) },
    folder: { list: vi.fn(async () => ok(opts.folders)) },
    settings: {
      get: vi.fn(async () => ok(opts.projectAuth ? { auth: opts.projectAuth } : {})),
    },
  }
}

function openRequest(auth: AuthConfig, url = 'https://api.test/items'): void {
  useWorkspaceStore.setState({ activeProjectId: 'p1' })
  useTabsStore.setState({
    tabs: [
      {
        id: 't1',
        name: 'imported',
        protocol: 'http',
        method: 'GET',
        url,
        isDirty: false,
        endpointId: 'ep1',
      } as Tab,
    ],
    activeTabId: 't1',
  })
  useRequestStore.getState().switchToTab('t1')
  useRequestStore.getState().loadFromEndpoint({ method: 'GET', url, auth })
}

beforeEach(() => {
  useRequestStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useEnvironmentStore.setState({
    ...useEnvironmentStore.getState(),
    environments: [],
    globalVariables: [],
    activeEnvironmentId: null,
  })
})

const FOLDER_BEARER = JSON.stringify({ type: 'bearer', bearer: { token: 'FOLDER-TOKEN' } })

describe('issue #276 — Generate Code resolves inherited auth like Send', () => {
  it('inherit + folder auth → the folder header is in the snippet', async () => {
    installApi({ folderId: 'f1', folders: [{ id: 'f1', parent_id: null, auth: FOLDER_BEARER }] })
    openRequest({ type: 'inherit' })
    const { result } = renderHook(() => useGeneratedCode('curl', true))
    await waitFor(() => expect(result.current.code).toContain('Authorization: Bearer FOLDER-TOKEN'))
  })

  it('inherit + project auth (no folder auth) → the project header', async () => {
    installApi({
      folderId: 'f1',
      folders: [{ id: 'f1', parent_id: null, auth: null }],
      projectAuth: { type: 'api-key', apiKeyKey: 'X-Api-Key', apiKeyValue: 'PROJ' },
    })
    openRequest({ type: 'inherit' })
    const { result } = renderHook(() => useGeneratedCode('curl', true))
    await waitFor(() => expect(result.current.code).toContain('X-Api-Key: PROJ'))
  })

  it("own 'none' under an authed folder → no auth header", async () => {
    installApi({ folderId: 'f1', folders: [{ id: 'f1', parent_id: null, auth: FOLDER_BEARER }] })
    openRequest({ type: 'none' })
    const { result } = renderHook(() => useGeneratedCode('curl', true))
    // Give any (wrong) async resolution a chance to land.
    await new Promise((r) => setTimeout(r, 20))
    expect(result.current.code).not.toContain('Authorization')
    expect(result.current.code).toContain('https://api.test/items')
  })

  it("a nearer folder's 'none' stops the project auth", async () => {
    installApi({
      folderId: 'f2',
      folders: [
        { id: 'f1', parent_id: null, auth: FOLDER_BEARER },
        { id: 'f2', parent_id: 'f1', auth: JSON.stringify({ type: 'none' }) },
      ],
      projectAuth: { type: 'bearer', bearerToken: 'PROJ' },
    })
    openRequest({ type: 'inherit' })
    const { result } = renderHook(() => useGeneratedCode('curl', true))
    await new Promise((r) => setTimeout(r, 20))
    expect(result.current.code).not.toContain('Authorization')
  })

  it('substitutes :name path variables in the snippet', async () => {
    installApi({ folderId: null, folders: [] })
    useWorkspaceStore.setState({ activeProjectId: 'p1' })
    openRequest({ type: 'none' }, 'https://api.test/users/:id')
    const s = useRequestStore.getState
    s().updatePathVariable(s().pathVariables[0].id, { value: '42' })
    const { result } = renderHook(() => useGeneratedCode('curl', true))
    expect(result.current.code).toContain('https://api.test/users/42')
  })
})

describe('generateCode — path variables', () => {
  it('applies rows before {{var}} resolution, every language', () => {
    const req = {
      method: 'GET' as const,
      url: '{{base}}/u/:id',
      params: [],
      headers: [],
      pathVariables: [{ key: 'id', value: '{{uid}}' }],
    }
    const opts = { envVars: { base: 'https://h.test', uid: '7' } }
    expect(generateCode('curl', req, opts)).toContain('https://h.test/u/7')
    expect(generateCode('python-requests', req, opts)).toContain('https://h.test/u/7')
    // No rows → literal, as before.
    expect(generateCode('curl', { ...req, pathVariables: [] }, opts)).toContain('https://h.test/u/:id')
  })
})
