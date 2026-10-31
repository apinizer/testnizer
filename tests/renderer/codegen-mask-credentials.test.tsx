/**
 * Issue #256 — what the Generate Code panes show. The hook behind both panes
 * (`useGeneratedCode(variant, includeSecrets)`) masks literal credentials when
 * the toggle is OFF — including an INHERITED auth (folder / project), which is
 * resolved before the snippet is built — and shows them when it is ON. The
 * toggle's hint tells the user the truth (it used to mention only secret
 * variables). Contract: `tests/main/shared/codegen/mask-credentials.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useGeneratedCode } from '../../src/renderer/components/shared/use-generated-code'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { valuesInAllLocales } from '../../src/renderer/lib/i18n'
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

const FOLDER_TOKEN = 'FOLDER-TOKEN-LITERAL-77'
const FOLDER_BEARER = JSON.stringify({ type: 'bearer', bearer: { token: FOLDER_TOKEN } })

describe('Generate Code hook — toggle OFF masks literals, ON shows them', () => {
  it("a request's own bearer token", async () => {
    installApi({ folderId: null, folders: [] })
    openRequest({ type: 'bearer', bearer: { token: 'OWN-TOKEN-LITERAL-11' } })
    const off = renderHook(() => useGeneratedCode('curl', false))
    expect(off.result.current.code).not.toContain('OWN-TOKEN-LITERAL-11')
    expect(off.result.current.code).toContain("-H 'Authorization: Bearer ***'")
    const on = renderHook(() => useGeneratedCode('curl', true))
    expect(on.result.current.code).toContain("-H 'Authorization: Bearer OWN-TOKEN-LITERAL-11'")
  })

  it('an INHERITED folder bearer (resolved before codegen)', async () => {
    installApi({ folderId: 'f1', folders: [{ id: 'f1', parent_id: null, auth: FOLDER_BEARER }] })
    openRequest({ type: 'inherit' })
    const off = renderHook(() => useGeneratedCode('curl', false))
    await waitFor(() => expect(off.result.current.code).toContain('Authorization: Bearer ***'))
    expect(off.result.current.code).not.toContain(FOLDER_TOKEN)
    const on = renderHook(() => useGeneratedCode('curl', true))
    await waitFor(() =>
      expect(on.result.current.code).toContain(`Authorization: Bearer ${FOLDER_TOKEN}`),
    )
  })

  it('an INHERITED project API key', async () => {
    installApi({
      folderId: 'f1',
      folders: [{ id: 'f1', parent_id: null, auth: null }],
      projectAuth: { type: 'api-key', apiKeyKey: 'X-Api-Key', apiKeyValue: 'PROJ-KEY-LITERAL-9' },
    })
    openRequest({ type: 'inherit' })
    const off = renderHook(() => useGeneratedCode('curl', false))
    await waitFor(() => expect(off.result.current.code).toContain('X-Api-Key: ***'))
    expect(off.result.current.code).not.toContain('PROJ-KEY-LITERAL-9')
  })

  it('a credential header typed in the Headers tab and a credential query param', async () => {
    installApi({ folderId: null, folders: [] })
    openRequest({ type: 'none' }, 'https://api.test/items?api_key=URLQUERY-LITERAL-3&page=2')
    useRequestStore.setState({
      headers: [
        { id: 'h1', key: 'X-Api-Key', value: 'HDR-LITERAL-5', enabled: true },
        { id: 'h2', key: 'X-Trace', value: 'trace-1', enabled: true },
      ],
    })
    const off = renderHook(() => useGeneratedCode('python-requests', false))
    const code = off.result.current.code
    expect(code).not.toContain('HDR-LITERAL-5')
    expect(code).not.toContain('URLQUERY-LITERAL-3')
    expect(code).toContain('trace-1')
    expect(code).toContain('page=2')
  })

  it('the secret-variable notice (hiddenSecrets) keeps working next to it', async () => {
    installApi({ folderId: null, folders: [] })
    openRequest({ type: 'bearer', bearer: { token: '{{token}}' } })
    useEnvironmentStore.setState({
      environments: [
        {
          id: 'env-1',
          name: 'Dev',
          workspace_id: 'w',
          variables: [
            { id: 'v', key: 'token', value: 'SECRET-VAR', initialValue: 'SECRET-VAR', enabled: true, secret: true },
          ],
        } as never,
      ],
      globalVariables: [],
      activeEnvironmentId: 'env-1',
    })
    const off = renderHook(() => useGeneratedCode('curl', false))
    await waitFor(() => expect(off.result.current.code).toContain('Bearer {{token}}'))
    expect(off.result.current.hiddenSecrets).toEqual(['token'])
    expect(off.result.current.code).not.toContain('SECRET-VAR')
  })
})

describe('toggle hint', () => {
  it('says that typed credentials are masked too (EN), and TR changed with it', () => {
    const [en, tr] = valuesInAllLocales('codeGen.includeSecretsHint')
    expect(en).toMatch(/literal/i)
    expect(en).toMatch(/\{\{name\}\}/)
    // The old Turkish text only talked about secret variables.
    expect(tr).not.toBe(
      'Gizli değişkenler {{name}} yer tutucusu olarak kalır. Doğrudan çalışan bir komut için dahil edin — kopyalanan metin o zaman gerçek değerleri içerir.',
    )
    expect(tr).toMatch(/\{\{name\}\}/)
  })
})
