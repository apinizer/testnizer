/**
 * Peer review of issue #298 — a Send belongs to the project it STARTED in.
 *
 * `soap.store.sendSoap` read the URL / envelope / auth, awaited the
 * inheritance IPC, and only then read `_workspaceId` / `_projectId` from the
 * workspace store. Switching project during that await sent project A's
 * request with project B's ids — main then picks B's cookie jar, B's client
 * certificate and writes the History row into B.
 *
 * The project switch is simulated inside the inheritance IPC
 * (`settings.get('project.<id>.settings')`), the await Send blocks on.
 * HTTP Send is pinned the same way (it snapshots the workspace store before
 * its first await).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSoapStore } from '../../src/renderer/stores/soap.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'

type Payload = { _workspaceId?: string; _projectId?: string }

let sendSpy: ReturnType<typeof vi.fn>

function installApi(): void {
  sendSpy = vi.fn(async () => ({
    success: true,
    data: { requestId: 'r', protocol: 'soap', status: 200, timing: { total: 1 } },
  }))
  const switchProject = async (): Promise<{ success: boolean; data: object }> => {
    // The user switches to project B while the inheritance lookup is in flight.
    useWorkspaceStore.setState({ activeWorkspaceId: 'ws-B', activeProjectId: 'proj-B' })
    return { success: true, data: {} }
  }
  ;(globalThis as unknown as { window: { api: unknown } }).window = {
    api: {
      request: { send: sendSpy, cancel: vi.fn() },
      endpoint: { get: vi.fn(async () => ({ success: true, data: { folder_id: null } })) },
      settings: { get: vi.fn(switchProject) },
    },
  }
}

beforeEach(() => {
  installApi()
  useEnvironmentStore.setState({
    ...useEnvironmentStore.getState(),
    environments: [],
    globalVariables: [],
    activeEnvironmentId: null,
  })
  useResponseStore.setState({ response: null, isLoading: false })
  useTabsStore.setState({
    tabs: [{ id: 'tab-A', name: 'A', protocol: 'soap', endpointId: 'ep-A' } as never],
    activeTabId: 'tab-A',
  })
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws-A', activeProjectId: 'proj-A' })
})

describe('Send keeps the originating workspace / project across its awaits', () => {
  it('SOAP: a project switch during the inheritance lookup does not re-home the request', async () => {
    useRequestStore.setState({ headers: [], auth: { type: 'none' }, withheldCredentials: [] })
    useSoapStore.setState({
      ...useSoapStore.getState(),
      parsedWsdl: null,
      selectedService: null,
      selectedPort: null,
      selectedOperation: null,
      rawXml: '<soapenv:Envelope/>',
      endpointUrl: 'http://soap.test/svc',
      manualSoapAction: 'urn:a',
      manualSoapVersion: 'soap11',
      withheldCredentials: [],
    })
    await useSoapStore.getState().sendSoap()
    expect(useWorkspaceStore.getState().activeProjectId).toBe('proj-B') // the switch happened
    expect(sendSpy).toHaveBeenCalledTimes(1)
    const payload = sendSpy.mock.calls[0][0] as Payload
    expect(payload._projectId).toBe('proj-A')
    expect(payload._workspaceId).toBe('ws-A')
  })

  it('HTTP: the same switch leaves the request in project A (pinned)', async () => {
    useRequestStore.setState({
      ...useRequestStore.getState(),
      method: 'GET',
      url: 'http://http.test/x',
      params: [],
      headers: [],
      body: { type: 'none', content: '' },
      auth: { type: 'none' },
      preScript: '',
      postScript: '',
      withheldCredentials: [],
      unloaded: false,
    } as never)
    await useRequestStore.getState().sendRequest()
    expect(useWorkspaceStore.getState().activeProjectId).toBe('proj-B')
    expect(sendSpy).toHaveBeenCalledTimes(1)
    const payload = sendSpy.mock.calls[0][0] as Payload
    expect(payload._projectId).toBe('proj-A')
    expect(payload._workspaceId).toBe('ws-A')
  })
})

// ─── MCP: tools/call, resources/read, prompts/get ──────────────

const { useMcpStore } = await import('../../src/renderer/stores/mcp.store')

function installMcpApi() {
  const done = { success: true, data: { content: [] }, timing: { durationMs: 1, sizeBytes: 2 } }
  const mcp = {
    connect: vi.fn(async () => ({
      success: true,
      data: { connectionId: 'conn-o', transport: 'http', url: 'http://x/mcp' },
    })),
    cancelConnect: vi.fn(async () => ({ success: true, data: { canceled: true } })),
    disconnect: vi.fn(async () => ({ success: true, data: true })),
    listTools: vi.fn(async () => ({
      success: true,
      data: [{ name: 'echo', inputSchema: { type: 'object', properties: {} } }],
    })),
    listResources: vi.fn(async () => ({
      success: true,
      data: { resources: [{ uri: 'test://a', name: 'a' }], templates: [] },
    })),
    listPrompts: vi.fn(async () => ({ success: true, data: [{ name: 'greet' }] })),
    callTool: vi.fn(async () => done),
    readResource: vi.fn(async () => ({ ...done, data: { contents: [] } })),
    getPrompt: vi.fn(async () => ({ ...done, data: { messages: [] } })),
    cancelCall: vi.fn(async () => ({ success: true, data: { cancelled: false } })),
  }
  let armed = false
  const settings = {
    get: vi.fn(async () => {
      // The pre-request script cascade looks up project settings — the user
      // switches project while that is in flight (armed after Connect).
      if (armed)
        useWorkspaceStore.setState({ activeWorkspaceId: 'ws-B', activeProjectId: 'proj-B' })
      return { success: true, data: {} }
    }),
  }
  ;(globalThis as unknown as { window: { api: unknown } }).window = { api: { mcp, settings } }
  return { mcp, arm: () => (armed = true) }
}

function lastCtx(fn: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  const call = fn.mock.calls[fn.mock.calls.length - 1]
  return call[call.length - 1] as Record<string, unknown>
}

describe('MCP calls keep the originating workspace / project across the script cascade', () => {
  async function connected() {
    const api = installMcpApi()
    useTabsStore.setState({
      tabs: [{ id: 'mcp-A', name: 'mcp-A', protocol: 'mcp', isDirty: false } as never],
      activeTabId: 'mcp-A',
    })
    useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
    useMcpStore.getState().switchToTab('mcp-A')
    useMcpStore.setState({ url: 'http://x/mcp', transport: 'http' })
    await useMcpStore.getState().connect()
    api.arm()
    return api.mcp
  }

  const reset = (): void =>
    useWorkspaceStore.setState({ activeWorkspaceId: 'ws-A', activeProjectId: 'proj-A' })

  it('tools/call', async () => {
    const mcp = await connected()
    useMcpStore.setState({ selectedTool: 'echo', toolArgs: '{}' })
    await useMcpStore.getState().callTool({ force: true })
    expect(useWorkspaceStore.getState().activeProjectId).toBe('proj-B')
    expect(lastCtx(mcp.callTool)).toMatchObject({ workspaceId: 'ws-A', projectId: 'proj-A' })
  })

  it('resources/read', async () => {
    const mcp = await connected()
    reset()
    useMcpStore.setState({ resourceUriDraft: 'test://a', selectedResourceUri: 'test://a' })
    await useMcpStore.getState().readResource()
    expect(useWorkspaceStore.getState().activeProjectId).toBe('proj-B')
    expect(lastCtx(mcp.readResource)).toMatchObject({ workspaceId: 'ws-A', projectId: 'proj-A' })
  })

  it('prompts/get', async () => {
    const mcp = await connected()
    reset()
    useMcpStore.setState({ selectedPrompt: 'greet', promptArgs: {} })
    await useMcpStore.getState().getPrompt()
    expect(useWorkspaceStore.getState().activeProjectId).toBe('proj-B')
    expect(lastCtx(mcp.getPrompt)).toMatchObject({ workspaceId: 'ws-A', projectId: 'proj-A' })
  })
})
