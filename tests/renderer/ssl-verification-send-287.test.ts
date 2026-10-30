/**
 * Issue #287 — Send honours "SSL certificate verification" off (Send ≡ Run).
 *
 * Root cause (Send): `request.store.ts` sendRequest used
 * `reqCfg.sslVerification ?? netSettings.sslVerification`, but the request's
 * `sslVerification` is a plain boolean whose default is `true` and the Ctrl+S
 * writer (`requestSettingsFor`) stores it unconditionally — so every saved
 * request carried an explicit `true` that shadowed the project's `false`.
 * The app-wide Settings value was never read by Send at all.
 *
 * Contract (shared with tests/main/shared/ssl-verification-resolver.test.ts):
 *  - the request-store field is TRI-STATE, exactly like `requestTimeout`:
 *    `boolean | null`, `null` = inherit, default `null`; `setSslVerification`
 *    accepts `boolean | null`;
 *  - Send calls `resolveSslVerification(request, project, app)`; the project
 *    value is `project.<id>.settings.sslVerification` and the app value is
 *    `settings.get('sslVerification')`;
 *  - `requestSettingsFor` omits the ssl keys for an untouched request, writes
 *    `sslVerification:false` for an explicit off and
 *    `sslVerification:true + sslVerificationExplicit:true` for an explicit on;
 *  - a LEGACY bare `sslVerification:true` row opens as inherit (migration rule).
 *
 * Rows are loaded the real way (open path -> `readRequestSettings` ->
 * `requestStoreSettings` -> `loadFromEndpoint`) and saved the real way
 * (`saveActiveRequestInPlace`); nothing here sets `sslVerification` through
 * `setState`, which would bake the bug into the setup.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saveActiveRequestInPlace } from '../../src/renderer/lib/save-active-request'
import { openEndpointTab } from '../../src/renderer/lib/open-endpoint-tab'
import { applyCurlPaste } from '../../src/renderer/lib/curl-paste'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import type { Tab } from '../../src/renderer/types'

const PROJECT_ID = 'proj-ssl-287'

type Row = Record<string, unknown>

interface Cfg {
  /** `project.<id>.settings` payload as `settings:get` returns it. */
  project?: Record<string, unknown>
  /** App Settings `sslVerification`. */
  app?: boolean
}

function installApi(cfg: Cfg) {
  const endpoints = new Map<string, Row>()
  const ok = (data: unknown) => ({ success: true, data })
  const send = vi.fn(async () =>
    ok({
      requestId: 'r',
      protocol: 'http',
      status: 200,
      statusText: 'OK',
      headers: {},
      body: '{}',
      bodySize: 2,
      timing: { total: 1 },
    }),
  )
  const api = {
    request: { send, cancel: vi.fn() },
    settings: {
      get: vi.fn(async (key: string) => {
        if (key === `project.${PROJECT_ID}.settings`) return ok(cfg.project ?? {})
        if (key === 'sslVerification') return ok(cfg.app)
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
    savedRequest: { get: vi.fn(async () => ok(null)), update: vi.fn(async () => ok(true)) },
    testSuiteItem: { get: vi.fn(async () => ok(null)), update: vi.fn(async () => ok(true)) },
  }
  ;(window as unknown as { api: typeof api }).api = api
  return { api, endpoints, send }
}

let env: ReturnType<typeof installApi>

function seedEndpoint(id: string, schema: Record<string, unknown>): void {
  env.endpoints.set(id, {
    id,
    project_id: PROJECT_ID,
    name: 'Self-signed',
    method: 'GET',
    path: '/',
    protocol: 'http',
    request_schema: JSON.stringify({ method: 'GET', url: 'https://self-signed.test/', ...schema }),
  })
}

/** Close every tab and drop its cached state — the next open starts from the row. */
function closeAll(): void {
  for (const t of useTabsStore.getState().tabs) useRequestStore.getState().removeTabState(t.id)
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useRequestStore.getState().switchToTab('scratch')
}

async function sentSsl(): Promise<unknown> {
  await useRequestStore.getState().sendRequest()
  expect(env.send).toHaveBeenCalled()
  const calls = env.send.mock.calls as unknown as Array<[{ sslVerification?: unknown }]>
  return calls[calls.length - 1][0].sslVerification
}

function beforeEachReset(cfg: Cfg): void {
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

describe('issue #287 — Send: project / app "SSL certificate verification"', () => {
  beforeEach(() => beforeEachReset({ project: { sslVerification: false } }))

  it('project false + a saved request with NO ssl key -> request:send carries sslVerification false', async () => {
    seedEndpoint('ep-1', {})
    await openEndpointTab('ep-1')
    expect(await sentSsl()).toBe(false)
  })

  it('the request-store field is tri-state: a freshly opened row without the key is null (inherit), not true', async () => {
    seedEndpoint('ep-1', {})
    await openEndpointTab('ep-1')
    expect(useRequestStore.getState().sslVerification).toBeNull()
  })

  it('project false + a request saved with the legacy bare sslVerification:true -> still false (migration rule)', async () => {
    seedEndpoint('ep-1', { followRedirects: true, maxRedirects: 5, sslVerification: true })
    await openEndpointTab('ep-1')
    expect(useRequestStore.getState().sslVerification).toBeNull()
    expect(await sentSsl()).toBe(false)
  })

  it('project false + explicit request true (marked) -> true', async () => {
    seedEndpoint('ep-1', { sslVerification: true, sslVerificationExplicit: true })
    await openEndpointTab('ep-1')
    expect(await sentSsl()).toBe(true)
  })
})

describe('issue #287 — Send: other tiers', () => {
  it('project true + request false -> false', async () => {
    beforeEachReset({ project: { sslVerification: true } })
    seedEndpoint('ep-1', { sslVerification: false })
    await openEndpointTab('ep-1')
    expect(await sentSsl()).toBe(false)
  })

  it('project true + no ssl key -> true', async () => {
    beforeEachReset({ project: { sslVerification: true } })
    seedEndpoint('ep-1', {})
    await openEndpointTab('ep-1')
    expect(await sentSsl()).toBe(true)
  })

  it('no project key + app Settings false -> false (the app tier is read)', async () => {
    beforeEachReset({ project: {}, app: false })
    seedEndpoint('ep-1', {})
    await openEndpointTab('ep-1')
    expect(await sentSsl()).toBe(false)
  })

  it('project true beats app false -> true', async () => {
    beforeEachReset({ project: { sslVerification: true }, app: false })
    seedEndpoint('ep-1', {})
    await openEndpointTab('ep-1')
    expect(await sentSsl()).toBe(true)
  })

  it('nothing configured -> true (verify)', async () => {
    beforeEachReset({ project: {} })
    seedEndpoint('ep-1', {})
    await openEndpointTab('ep-1')
    expect(await sentSsl()).toBe(true)
  })
})

describe('issue #287 — Ctrl+S writer and save -> close -> reopen -> Send', () => {
  beforeEach(() => beforeEachReset({ project: { sslVerification: false } }))

  const schemaOf = (id: string): Record<string, unknown> =>
    JSON.parse(String(env.endpoints.get(id)?.request_schema)) as Record<string, unknown>

  it('an UNTOUCHED request saves no ssl key (it used to write the default true), so Send still follows the project after reopen', async () => {
    seedEndpoint('ep-1', {})
    await openEndpointTab('ep-1')
    useRequestStore.getState().setRequestTimeout(1234) // dirty edit unrelated to SSL
    expect((await saveActiveRequestInPlace()).success).toBe(true)
    const schema = schemaOf('ep-1')
    expect(schema).not.toHaveProperty('sslVerification')
    expect(schema).not.toHaveProperty('sslVerificationExplicit')

    closeAll()
    await openEndpointTab('ep-1')
    expect(await sentSsl()).toBe(false)
  })

  it('user toggles request ON over project OFF -> save -> close -> reopen -> Send payload is true', async () => {
    seedEndpoint('ep-1', {})
    await openEndpointTab('ep-1')
    useRequestStore.getState().setSslVerification(true)
    expect((await saveActiveRequestInPlace()).success).toBe(true)
    expect(schemaOf('ep-1')).toMatchObject({ sslVerification: true, sslVerificationExplicit: true })

    closeAll()
    await openEndpointTab('ep-1')
    expect(useRequestStore.getState().sslVerification).toBe(true)
    expect(await sentSsl()).toBe(true)
  })

  it('user toggles request OFF over project ON -> save -> reopen -> Send payload is false', async () => {
    beforeEachReset({ project: { sslVerification: true } })
    seedEndpoint('ep-1', {})
    await openEndpointTab('ep-1')
    useRequestStore.getState().setSslVerification(false)
    expect((await saveActiveRequestInPlace()).success).toBe(true)
    expect(schemaOf('ep-1')).toMatchObject({ sslVerification: false })

    closeAll()
    await openEndpointTab('ep-1')
    expect(await sentSsl()).toBe(false)
  })

  it('re-saving a reopened LEGACY-true row without touching ssl does not re-introduce an explicit true', async () => {
    seedEndpoint('ep-1', { followRedirects: true, maxRedirects: 5, sslVerification: true })
    await openEndpointTab('ep-1')
    useRequestStore.getState().setRequestTimeout(2000)
    expect((await saveActiveRequestInPlace()).success).toBe(true)
    expect(schemaOf('ep-1')).not.toHaveProperty('sslVerification')

    closeAll()
    await openEndpointTab('ep-1')
    expect(await sentSsl()).toBe(false)
  })
})

describe('issue #287 — cURL paste does not invent an explicit "verify on"', () => {
  beforeEach(() => beforeEachReset({ project: { sslVerification: false } }))

  function openHttpTab(): void {
    useTabsStore.setState({
      tabs: [
        { id: 'tab-c', name: 'C', method: 'GET', url: '', isDirty: false, protocol: 'http' } as Tab,
      ],
      activeTabId: 'tab-c',
    })
    useRequestStore.getState().switchToTab('tab-c')
  }

  it("a pasted curl WITHOUT -k leaves the request inheriting (null), so the project's false applies", async () => {
    openHttpTab()
    expect(applyCurlPaste(`curl 'https://self-signed.test/ping'`).status).toBe('applied')
    expect(useRequestStore.getState().sslVerification).toBeNull()
    expect(await sentSsl()).toBe(false)
  })

  it('a pasted curl WITH -k is an explicit OFF', async () => {
    openHttpTab()
    expect(applyCurlPaste(`curl -k 'https://self-signed.test/ping'`).status).toBe('applied')
    expect(useRequestStore.getState().sslVerification).toBe(false)
  })
})
