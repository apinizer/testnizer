/**
 * Mock MCP store (issue #140): runtime events are routed by the `serverId`
 * they carry — never to "the selected server" — and the IPC actions call the
 * right bridge method and surface the backend's error text.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  useMockMcpStore,
  ensureMockMcpEventSubscriptions,
  handleMockMcpLog,
  handleMockMcpStatus,
  MOCK_MCP_LOG_LIMIT,
} from '../../src/renderer/stores/mock-mcp.store'
import { serverToDraft } from '../../src/renderer/components/mock-mcp/mock-mcp-draft'
import {
  installBridge,
  logEntry,
  runningState,
  sampleServer,
  stopped,
  type BridgeStub,
} from './mock-mcp-bridge-stub'

let stub: BridgeStub

beforeEach(() => {
  stub = installBridge([sampleServer({ id: 'a' }), sampleServer({ id: 'b', port: 3101 })])
  ensureMockMcpEventSubscriptions()
  useMockMcpStore.setState({
    servers: [],
    projectId: null,
    stateByServer: {},
    logsByServer: {},
    drafts: {},
  })
})

describe('event routing by serverId', () => {
  it('appends a log entry only to the server it belongs to', () => {
    handleMockMcpLog(logEntry('a', 'l1'))
    handleMockMcpLog(logEntry('b', 'l2'))
    handleMockMcpLog(logEntry('a', 'l3'))
    const logs = useMockMcpStore.getState().logsByServer
    expect(logs.a.map((e) => e.id)).toEqual(['l1', 'l3'])
    expect(logs.b.map((e) => e.id)).toEqual(['l2'])
  })

  it('caps each server log at the main-process ring size', () => {
    for (let i = 0; i < MOCK_MCP_LOG_LIMIT + 5; i++) handleMockMcpLog(logEntry('a', `l${i}`))
    const logs = useMockMcpStore.getState().logsByServer.a
    expect(logs).toHaveLength(MOCK_MCP_LOG_LIMIT)
    expect(logs[0].id).toBe('l5')
  })

  it('a status event updates only its own server', () => {
    handleMockMcpStatus(runningState('a', 4000))
    handleMockMcpStatus({ ...stopped('b'), status: 'error', errorMessage: 'EADDRINUSE' })
    const st = useMockMcpStore.getState().stateByServer
    expect(st.a).toMatchObject({ status: 'running', port: 4000 })
    expect(st.b).toMatchObject({ status: 'error', errorMessage: 'EADDRINUSE' })
  })

  it('subscribes to the bridge once and routes pushed events', () => {
    ensureMockMcpEventSubscriptions()
    ensureMockMcpEventSubscriptions()
    expect(stub.bridge.onLog).toHaveBeenCalledTimes(1)
    expect(stub.bridge.onStatus).toHaveBeenCalledTimes(1)
    stub.emitLog(logEntry('b', 'pushed'))
    stub.emitStatus(runningState('b', 4100))
    const s = useMockMcpStore.getState()
    expect(s.logsByServer.b.map((e) => e.id)).toEqual(['pushed'])
    expect(s.logsByServer.a).toBeUndefined()
    expect(s.stateByServer.b.port).toBe(4100)
    expect(s.stateByServer.a).toBeUndefined()
  })

  it('loadLogs keeps entries pushed after the snapshot was taken', async () => {
    const early = logEntry('a', 'early', { ts: 1000 })
    const late = logEntry('a', 'late', { ts: 2000 })
    vi.mocked(stub.bridge.logs.get).mockImplementation(() => {
      handleMockMcpLog(late) // arrives while the IPC is in flight
      return Promise.resolve({ success: true, data: [early] })
    })
    await useMockMcpStore.getState().loadLogs('a')
    expect(useMockMcpStore.getState().logsByServer.a.map((e) => e.id)).toEqual(['early', 'late'])
  })
})

describe('IPC actions', () => {
  it('loadServers lists the project and hydrates each live state', async () => {
    vi.mocked(stub.bridge.server.status).mockImplementation((id: string) =>
      Promise.resolve({ success: true, data: id === 'a' ? runningState('a') : stopped(id) }),
    )
    await useMockMcpStore.getState().loadServers('p-1')
    const s = useMockMcpStore.getState()
    expect(stub.bridge.server.list).toHaveBeenCalledWith('p-1')
    expect(s.servers.map((x) => x.id)).toEqual(['a', 'b'])
    expect(s.projectId).toBe('p-1')
    expect(stub.bridge.server.status).toHaveBeenCalledWith('a')
    expect(stub.bridge.server.status).toHaveBeenCalledWith('b')
    expect(s.stateByServer.a.status).toBe('running')
  })

  it('startServer / stopServer call the bridge for that id and store the returned state', async () => {
    expect(await useMockMcpStore.getState().startServer('b')).toBeNull()
    expect(stub.bridge.server.start).toHaveBeenCalledWith('b')
    expect(useMockMcpStore.getState().stateByServer.b.status).toBe('running')
    expect(await useMockMcpStore.getState().stopServer('b')).toBeNull()
    expect(stub.bridge.server.stop).toHaveBeenCalledWith('b')
    expect(useMockMcpStore.getState().stateByServer.b.status).toBe('stopped')
  })

  it('a failed start returns the backend message and marks only that server as error', async () => {
    vi.mocked(stub.bridge.server.start).mockResolvedValueOnce({
      success: false,
      error: 'Port 3100 is in use',
    })
    expect(await useMockMcpStore.getState().startServer('a')).toBe('Port 3100 is in use')
    const st = useMockMcpStore.getState().stateByServer
    expect(st.a).toMatchObject({ status: 'error', errorMessage: 'Port 3100 is in use' })
    expect(st.b).toBeUndefined()
  })

  it('updateServer surfaces a validation error and leaves the list untouched', async () => {
    await useMockMcpStore.getState().loadServers('p-1')
    vi.mocked(stub.bridge.server.update).mockResolvedValueOnce({
      success: false,
      error: 'Duplicate tool name "echo"',
    })
    const before = useMockMcpStore.getState().servers
    expect(await useMockMcpStore.getState().updateServer('a', { name: 'x' })).toBe(
      'Duplicate tool name "echo"',
    )
    expect(useMockMcpStore.getState().servers).toBe(before)
  })

  it('deleteServer drops the row together with its state, logs and draft', async () => {
    await useMockMcpStore.getState().loadServers('p-1')
    handleMockMcpLog(logEntry('a', 'l1'))
    handleMockMcpStatus(runningState('a'))
    useMockMcpStore.getState().setDraft('a', serverToDraft(useMockMcpStore.getState().servers[0]))
    expect(await useMockMcpStore.getState().deleteServer('a')).toBeNull()
    const s = useMockMcpStore.getState()
    expect(stub.bridge.server.delete).toHaveBeenCalledWith('a')
    expect(s.servers.map((x) => x.id)).toEqual(['b'])
    expect(s.stateByServer.a).toBeUndefined()
    expect(s.logsByServer.a).toBeUndefined()
    expect(s.drafts.a).toBeUndefined()
  })
})
