/**
 * Issue #154 D — a Mock MCP server bound to a non-loopback address with auth
 * "none" is callable by anyone on the network. `isExposedWithoutAuth` is the
 * pure check (the renderer's editor warning uses the same rule); the running
 * server writes a warning line into its own log when it starts that way.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { isExposedWithoutAuth, isLoopbackHost } from '../../src/shared/mock-mcp-exposure'
import { mockMcpServerManager } from '../../src/main/mock-mcp/server'
import type { MockMcpServerDef } from '../../src/main/mock-mcp/types'

describe('isLoopbackHost / isExposedWithoutAuth', () => {
  const none = (host: string): boolean => isExposedWithoutAuth({ host, authMode: 'none' })

  it.each([
    ['0.0.0.0', true],
    ['::', true],
    ['[::]', true],
    ['192.168.1.20', true],
    ['10.0.0.5', true],
    ['my-laptop.local', true],
    ['', true],
    ['localhost', false],
    ['LOCALHOST', false],
    ['127.0.0.1', false],
    ['127.0.0.2', false],
    ['127.255.255.254', false],
    ['::1', false],
    ['[::1]', false],
    ['0:0:0:0:0:0:0:1', false],
    ['::ffff:127.0.0.1', false],
    [' 127.0.0.1 ', false],
  ])('auth none on %j → exposed=%s', (host, exposed) => {
    expect(none(host)).toBe(exposed)
    expect(isLoopbackHost(host)).toBe(!exposed)
  })

  it('a look-alike that is not 127/8 is not loopback', () => {
    expect(isLoopbackHost('127.0.0.256')).toBe(false)
    expect(isLoopbackHost('1127.0.0.1')).toBe(false)
    expect(isLoopbackHost('127.0.0.1.evil.com')).toBe(false)
  })

  it('main re-exports the shared helper from config.ts (one implementation)', async () => {
    const config = await import('../../src/main/mock-mcp/config')
    expect(config.isExposedWithoutAuth).toBe(isExposedWithoutAuth)
    expect(config.isLoopbackHost).toBe(isLoopbackHost)
  })

  it('bearer auth is never "exposed without auth", whatever the host', () => {
    expect(isExposedWithoutAuth({ host: '0.0.0.0', authMode: 'bearer' })).toBe(false)
    expect(isExposedWithoutAuth({ host: '192.168.1.20', authMode: 'bearer' })).toBe(false)
  })
})

function def(over: Partial<MockMcpServerDef>): MockMcpServerDef {
  return {
    id: `srv-${Math.random().toString(36).slice(2)}`,
    name: 'Exposure',
    description: '',
    host: '127.0.0.1',
    port: 0,
    path: '/mcp',
    legacySse: false,
    authMode: 'none',
    bearerToken: '',
    latencyMs: 0,
    errorMode: { kind: 'none' },
    protocolPin: null,
    legacyMode: 'stateless',
    cacheTtlMs: 0,
    tools: [],
    resources: [],
    prompts: [],
    ...over,
  }
}

afterEach(async () => {
  await mockMcpServerManager.stopAll()
})

describe('start-time exposure warning in the server log', () => {
  it('0.0.0.0 + auth none → a warning line in the log (and the log event)', async () => {
    const d = def({ host: '0.0.0.0' })
    const emitted: { serverId: string; method: string }[] = []
    const onLog = (e: { serverId: string; method: string }): void => {
      emitted.push(e)
    }
    mockMcpServerManager.on('log', onLog)
    try {
      const r = await mockMcpServerManager.start(d)
      expect(r.ok).toBe(true)
    } finally {
      mockMcpServerManager.off('log', onLog)
    }
    const logs = mockMcpServerManager.getLogs(d.id)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ serverId: d.id, method: 'warning', ok: false })
    expect(logs[0].response).toMatch(/0\.0\.0\.0:\d+ with authentication "none"/)
    expect(emitted.map((e) => e.method)).toEqual(['warning'])
  })

  it('loopback, or bearer on 0.0.0.0 → no warning', async () => {
    const loop = def({ host: '127.0.0.1' })
    const bearer = def({ host: '0.0.0.0', authMode: 'bearer', bearerToken: 't0k' })
    expect((await mockMcpServerManager.start(loop)).ok).toBe(true)
    expect((await mockMcpServerManager.start(bearer)).ok).toBe(true)
    expect(mockMcpServerManager.getLogs(loop.id)).toEqual([])
    expect(mockMcpServerManager.getLogs(bearer.id)).toEqual([])
  })
})
