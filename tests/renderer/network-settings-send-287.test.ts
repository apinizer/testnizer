/**
 * Issue #287 follow-ups on the Send path (orchestrator decisions 1, 2, 3):
 *
 *  1. "Follow redirects" had the identical shadowing bug as SSL verification:
 *     the store default `true` + the Ctrl+S writer stored `followRedirects:true`
 *     on every save, so the project's / app's "off" never applied. Now
 *     tri-state like `sslVerification` (null = inherit), resolved by the shared
 *     `resolveFollowRedirects`; a LEGACY bare stored `true` opens as inherit, a
 *     user-chosen true is written with `followRedirectsExplicit: true`.
 *  2. SOAP and GraphQL Send (query + introspection) went out through
 *     `request:send` WITHOUT `sslVerification` — they always verified, so a
 *     project with verification off still failed on a self-signed SOAP host.
 *     They now carry the same resolved value (and TLS / proxy) Run applies.
 *  3. A tab left open across the upgrade: its localStorage snapshot holds the
 *     old default `true` without the new marker — it must load as inherit, or
 *     the next Ctrl+S would write it as an explicit choice for good.
 */
import { describe, expect, it, vi } from 'vitest'
import { saveActiveRequestInPlace } from '../../src/renderer/lib/save-active-request'
import { openEndpointTab } from '../../src/renderer/lib/open-endpoint-tab'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useSoapStore } from '../../src/renderer/stores/soap.store'
import { useGraphQLStore } from '../../src/renderer/stores/graphql.store'

const PROJECT_ID = 'proj-net-287'

type Row = Record<string, unknown>
type Payload = Record<string, unknown>

interface Cfg {
  project?: Record<string, unknown>
  appSsl?: boolean
  appFollow?: boolean
}

function installApi(cfg: Cfg) {
  const endpoints = new Map<string, Row>()
  const ok = (data: unknown) => ({ success: true, data })
  const send = vi.fn(async (_p: Payload) =>
    ok({
      requestId: 'r',
      protocol: 'http',
      status: 200,
      statusText: 'OK',
      headers: {},
      body: '{"data":{"__schema":{"types":[]}}}',
      bodySize: 2,
      timing: { total: 1 },
    }),
  )
  const api = {
    request: { send, cancel: vi.fn() },
    settings: {
      get: vi.fn(async (key: string) => {
        if (key === `project.${PROJECT_ID}.settings`) return ok(cfg.project ?? {})
        if (key === 'sslVerification') return ok(cfg.appSsl)
        if (key === 'followRedirects') return ok(cfg.appFollow)
        return ok(undefined)
      }),
    },
    endpoint: {
      update: vi.fn(async (id: string, patch: Row) => {
        endpoints.set(id, { ...endpoints.get(id), ...patch })
        return ok(true)
      }),
      get: vi.fn(async (id: string) => ok(endpoints.get(id) ?? null)),
    },
    folder: { list: vi.fn(async () => ok([])) },
    savedRequest: { get: vi.fn(async () => ok(null)), update: vi.fn(async () => ok(true)) },
    testSuiteItem: { get: vi.fn(async () => ok(null)), update: vi.fn(async () => ok(true)) },
  }
  ;(window as unknown as { api: typeof api }).api = api
  return { api, endpoints, send }
}

let env: ReturnType<typeof installApi>

function reset(cfg: Cfg): void {
  env = installApi(cfg)
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
    refreshTree: vi.fn().mockResolvedValue(undefined),
  })
  useRequestStore.setState({ _tabStates: new Map(), _currentTabId: null })
}

function seedEndpoint(id: string, schema: Record<string, unknown>): void {
  env.endpoints.set(id, {
    id,
    project_id: PROJECT_ID,
    name: 'Hop',
    method: 'GET',
    path: '/',
    protocol: 'http',
    request_schema: JSON.stringify({ method: 'GET', url: 'https://hop.test/', ...schema }),
  })
}

function closeAll(): void {
  for (const t of useTabsStore.getState().tabs) useRequestStore.getState().removeTabState(t.id)
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useRequestStore.getState().switchToTab('scratch')
}

function lastPayload(): Payload {
  const calls = env.send.mock.calls
  expect(calls.length).toBeGreaterThan(0)
  return calls[calls.length - 1][0]
}

const schemaOf = (id: string): Record<string, unknown> =>
  JSON.parse(String(env.endpoints.get(id)?.request_schema)) as Record<string, unknown>

describe('issue #287 — Send: Follow redirects inherits like SSL verification', () => {
  it('project followRedirects false + a row with NO key -> request:send carries false', async () => {
    reset({ project: { followRedirects: false } })
    seedEndpoint('ep-1', {})
    await openEndpointTab('ep-1')
    expect(useRequestStore.getState().followRedirects).toBeNull()
    await useRequestStore.getState().sendRequest()
    expect(lastPayload().followRedirects).toBe(false)
  })

  it('LEGACY bare followRedirects:true (old Ctrl+S) under project false -> opens as inherit, sends false', async () => {
    reset({ project: { followRedirects: false } })
    seedEndpoint('ep-1', { followRedirects: true, maxRedirects: 5, sslVerification: true })
    await openEndpointTab('ep-1')
    expect(useRequestStore.getState().followRedirects).toBeNull()
    await useRequestStore.getState().sendRequest()
    expect(lastPayload().followRedirects).toBe(false)
  })

  it('app followRedirects false (no project key) -> false', async () => {
    reset({ project: {}, appFollow: false })
    seedEndpoint('ep-1', {})
    await openEndpointTab('ep-1')
    await useRequestStore.getState().sendRequest()
    expect(lastPayload().followRedirects).toBe(false)
  })

  it('nothing configured -> true (follow)', async () => {
    reset({ project: {} })
    seedEndpoint('ep-1', {})
    await openEndpointTab('ep-1')
    await useRequestStore.getState().sendRequest()
    expect(lastPayload().followRedirects).toBe(true)
  })

  it('untouched save writes no followRedirects key; explicit ON is marked and survives reopen', async () => {
    reset({ project: { followRedirects: false } })
    seedEndpoint('ep-1', {})
    await openEndpointTab('ep-1')
    useRequestStore.getState().setRequestTimeout(1500)
    expect((await saveActiveRequestInPlace()).success).toBe(true)
    expect(schemaOf('ep-1')).not.toHaveProperty('followRedirects')
    expect(schemaOf('ep-1')).not.toHaveProperty('followRedirectsExplicit')

    useRequestStore.getState().setFollowRedirects(true)
    expect((await saveActiveRequestInPlace()).success).toBe(true)
    expect(schemaOf('ep-1')).toMatchObject({ followRedirects: true, followRedirectsExplicit: true })

    closeAll()
    await openEndpointTab('ep-1')
    expect(useRequestStore.getState().followRedirects).toBe(true)
    await useRequestStore.getState().sendRequest()
    expect(lastPayload().followRedirects).toBe(true)
  })

  it('setFollowRedirects(null) goes back to inherit and the next save drops the key', async () => {
    reset({ project: { followRedirects: false } })
    seedEndpoint('ep-1', { followRedirects: true, followRedirectsExplicit: true })
    await openEndpointTab('ep-1')
    useRequestStore.getState().setFollowRedirects(null)
    expect((await saveActiveRequestInPlace()).success).toBe(true)
    expect(schemaOf('ep-1')).not.toHaveProperty('followRedirects')
    await useRequestStore.getState().sendRequest()
    expect(lastPayload().followRedirects).toBe(false)
  })
})

describe('issue #287 — Send: the project TLS + proxy reach request:send (HTTP)', () => {
  it('forwards the TLS preset name and the proxy as the project stores them', async () => {
    const proxy = { mode: 'custom', host: 'proxy.test', port: 3128 }
    reset({
      project: {
        sslVerification: false,
        tls: { minVersion: 'TLSv1.2', cipherPreset: 'legacy' },
        proxy,
      },
    })
    seedEndpoint('ep-1', {})
    await openEndpointTab('ep-1')
    await useRequestStore.getState().sendRequest()
    expect(lastPayload()).toMatchObject({
      sslVerification: false,
      proxy,
      tls: { minVersion: 'TLSv1.2', cipherPreset: 'legacy' },
    })
  })
})

describe('issue #287 — SOAP and GraphQL Send honour the resolved SSL verification', () => {
  function soapReady(): void {
    useSoapStore.setState({
      mode: 'manual',
      endpointUrl: 'https://self-signed.test/svc',
      rawXml: '<Envelope><Body><Ping/></Body></Envelope>',
    })
    useRequestStore.setState({ auth: { type: 'none' }, headers: [], sslVerification: null })
  }

  it('SOAP: project false -> request:send carries sslVerification false (it used to send none)', async () => {
    reset({ project: { sslVerification: false } })
    soapReady()
    await useSoapStore.getState().sendSoap()
    expect(lastPayload()).toMatchObject({ _protocol: 'soap', sslVerification: false })
  })

  it('SOAP: app false, no project key -> false; nothing configured -> true', async () => {
    reset({ project: {}, appSsl: false })
    soapReady()
    await useSoapStore.getState().sendSoap()
    expect(lastPayload().sslVerification).toBe(false)

    reset({ project: {} })
    soapReady()
    await useSoapStore.getState().sendSoap()
    expect(lastPayload().sslVerification).toBe(true)
  })

  it('SOAP: the project TLS + proxy go along too (Run applies them to the row)', async () => {
    const proxy = { mode: 'custom', host: 'proxy.test', port: 3128 }
    reset({ project: { tls: { minVersion: 'TLSv1.3' }, proxy } })
    soapReady()
    await useSoapStore.getState().sendSoap()
    expect(lastPayload()).toMatchObject({ proxy, tls: { minVersion: 'TLSv1.3' } })
  })

  it('GraphQL query: project false -> sslVerification false', async () => {
    reset({ project: { sslVerification: false } })
    useRequestStore.setState({ sslVerification: null })
    useGraphQLStore.setState({
      url: 'https://self-signed.test/graphql',
      query: '{ ping }',
      variables: '',
      headers: [],
    })
    await useGraphQLStore.getState().executeQuery()
    expect(lastPayload()).toMatchObject({ _protocol: 'graphql', sslVerification: false })
  })

  it('GraphQL introspection: project false -> sslVerification false', async () => {
    reset({ project: { sslVerification: false } })
    useRequestStore.setState({ sslVerification: null })
    useGraphQLStore.setState({ url: 'https://self-signed.test/graphql', headers: [] })
    await useGraphQLStore.getState().introspect()
    expect(lastPayload().sslVerification).toBe(false)
  })
})

describe('issue #287 — a tab snapshot from an older build loads as inherit', () => {
  const STORAGE_KEY = 'testnizer-request'

  async function freshStore() {
    vi.resetModules()
    return (await import('../../src/renderer/stores/request.store')).useRequestStore
  }

  function legacyState(extra: Record<string, unknown>): Record<string, unknown> {
    return {
      method: 'GET',
      url: 'https://x.test',
      params: [],
      headers: [],
      body: { type: 'none' },
      auth: { type: 'inherit' },
      maxRedirects: 5,
      ...extra,
    }
  }

  it('unmarked true (the old default) -> null; false stays an explicit off', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        current: legacyState({ sslVerification: true, followRedirects: true }),
        _currentTabId: 't1',
        _tabStates: [['t2', legacyState({ sslVerification: false, followRedirects: true })]],
      }),
    )
    const store = await freshStore()
    expect(store.getState().sslVerification).toBeNull()
    expect(store.getState().followRedirects).toBeNull()
    const t2 = store.getState()._tabStates.get('t2')
    expect(t2?.sslVerification).toBe(false)
    expect(t2?.followRedirects).toBeNull()
  })

  it('a true this build wrote (marked) survives a reload', async () => {
    window.localStorage.removeItem(STORAGE_KEY)
    let store = await freshStore()
    store.getState().setSslVerification(true)
    store.getState().setFollowRedirects(true)
    const saved = JSON.parse(String(window.localStorage.getItem(STORAGE_KEY))) as {
      current: Record<string, unknown>
    }
    expect(saved.current).toMatchObject({
      sslVerification: true,
      sslVerificationExplicit: true,
      followRedirects: true,
      followRedirectsExplicit: true,
    })

    store = await freshStore()
    expect(store.getState().sslVerification).toBe(true)
    expect(store.getState().followRedirects).toBe(true)
    window.localStorage.removeItem(STORAGE_KEY)
  })
})
