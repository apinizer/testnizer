/**
 * Multi-project isolation — the mock-server port conflict named the wrong
 * project.
 *
 * `mockServerManager` is a process-global singleton holding the running
 * servers of EVERY project, and nothing stops another project's servers when
 * the user switches (`stopAll` exists but is never called — mocks are meant to
 * keep serving). The pre-bind check therefore fires across projects, but its
 * message said the port was taken "in this project", sending the user to look
 * through the current project for a server that is not there.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mockServerManager, type MockServerDef } from '../../src/main/mock/server'

function def(over: Partial<MockServerDef>): MockServerDef {
  return {
    id: 'srv-1',
    name: 'Mock',
    host: '127.0.0.1',
    port: 0,
    basePath: '',
    cors: { enabled: false } as MockServerDef['cors'],
    auth: { type: 'none' } as MockServerDef['auth'],
    failure: {} as MockServerDef['failure'],
    rateLimit: {} as MockServerDef['rateLimit'],
    echoEnabled: false,
    proxyEnabled: false,
    proxyTarget: '',
    proxyRecord: false,
    endpoints: [],
    ...over,
  } as MockServerDef
}

/** A free port, so the suite never depends on one being available. */
async function freePort(): Promise<number> {
  const net = await import('node:net')
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

afterEach(async () => {
  await mockServerManager.stopAll()
})

describe('port already taken by another project', () => {
  it('says so, instead of blaming the project the user is looking at', async () => {
    const port = await freePort()
    const first = await mockServerManager.start(
      def({ id: 'srv-a', name: 'Orders mock', port, projectId: 'proj-a' }),
    )
    expect(first.ok).toBe(true)

    const second = await mockServerManager.start(
      def({ id: 'srv-b', name: 'Billing mock', port, projectId: 'proj-b' }),
    )

    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.error).toContain('another project')
    expect(second.error).toContain('Orders mock')
    expect(second.error).not.toContain('in this project')
  })

  it('still says "in this project" when it really is this project', async () => {
    const port = await freePort()
    await mockServerManager.start(def({ id: 'srv-a', name: 'Orders mock', port, projectId: 'p' }))
    const second = await mockServerManager.start(
      def({ id: 'srv-b', name: 'Billing mock', port, projectId: 'p' }),
    )

    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.error).toContain('in this project')
  })
})
