/**
 * `mcpCallOnce` (issue #161) ON THE WIRE — the one-shot connect → call →
 * disconnect the Runner / Test Suites / Scheduler use. Covers the parts the
 * runner tests only reach indirectly: the bound (no step may hang), abort,
 * detached connections emitting nothing, and that the connection is ALWAYS
 * closed — also when the bound fires and the caller has already moved on.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  mcpCallOnce,
  mcpConnectionIds,
  setMcpEventSink,
  type McpEngineEvent,
} from '../../src/main/protocols/mcp.engine'
import { startV2Server, waitFor, waitOrAbort, type RunningServer } from './mcp-wire-fixtures'

let server: RunningServer
let events: McpEngineEvent[] = []

beforeAll(async () => {
  server = await startV2Server((mcp) => {
    mcp.registerTool('echo', { description: 'echo', inputSchema: z.object({}) }, async () => ({
      content: [{ type: 'text', text: 'hi' }],
    }))
    // Works for ~900 ms but reports progress every 150 ms (review item 9).
    mcp.registerTool(
      'ticking',
      { description: 'ticking', inputSchema: z.object({}) },
      async (_a, ctx) => {
        const token = ctx.mcpReq._meta?.progressToken
        for (let i = 1; i <= 6; i++) {
          await waitOrAbort(150, ctx.mcpReq.signal)
          if (token !== undefined) {
            await ctx.mcpReq.notify({
              method: 'notifications/progress',
              params: { progressToken: token, progress: i, total: 6 },
            })
          }
        }
        return { content: [{ type: 'text', text: 'done' }] }
      },
    )
    mcp.registerTool(
      'slow',
      { description: 'slow', inputSchema: z.object({}) },
      async (_a, ctx) => {
        await waitOrAbort(5_000, ctx.mcpReq.signal)
        return { content: [{ type: 'text', text: 'late' }] }
      },
    )
  })
})

afterAll(async () => {
  await server?.close()
})

beforeEach(() => {
  events = []
  setMcpEventSink((e) => events.push(e))
})

afterEach(() => {
  setMcpEventSink(null)
})

describe('mcpCallOnce', () => {
  it('returns the result with call timing, closes the connection, emits no events', async () => {
    const out = await mcpCallOnce({
      connect: { transport: 'http', url: server.url },
      call: { capability: 'tool', name: 'echo', args: {} },
    })
    expect(out.error).toBeUndefined()
    expect(out.result).toMatchObject({ content: [{ type: 'text', text: 'hi' }] })
    expect(out.timing?.durationMs).toBeGreaterThanOrEqual(0)
    expect(out.timing?.sizeBytes).toBeGreaterThan(0)
    expect(mcpConnectionIds()).toEqual([])
    // Detached: no tab owns this connection, so nothing reaches the sink.
    await new Promise((r) => setTimeout(r, 20))
    expect(events).toEqual([])
  })

  it('the bound fires: timed-out error, and the connection still closes afterwards', async () => {
    const started = Date.now()
    const out = await mcpCallOnce({
      connect: { transport: 'http', url: server.url },
      call: { capability: 'tool', name: 'slow', args: {} },
      timeoutMs: 300,
    })
    expect(Date.now() - started).toBeLessThan(3_000)
    expect(out.error).toMatch(/timed out after 300 ms/)
    expect(out.result).toBeUndefined()
    await waitFor(() => mcpConnectionIds().length === 0, 5_000)
  })

  it('an abort signal mid-call comes back cancelled', async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 200)
    const out = await mcpCallOnce({
      connect: { transport: 'http', url: server.url },
      call: { capability: 'tool', name: 'slow', args: {} },
      signal: controller.signal,
    })
    expect(out.cancelled).toBe(true)
    expect(mcpConnectionIds()).toEqual([])
  })

  it('an already-aborted signal never connects', async () => {
    const controller = new AbortController()
    controller.abort()
    const out = await mcpCallOnce({
      connect: { transport: 'http', url: server.url },
      call: { capability: 'tool', name: 'echo', args: {} },
      signal: controller.signal,
    })
    expect(out.cancelled).toBe(true)
    expect(mcpConnectionIds()).toEqual([])
  })

  it('a failed handshake is an error outcome, never a throw', async () => {
    const out = await mcpCallOnce({
      connect: { transport: 'http', url: 'http://127.0.0.1:1/mcp' },
      call: { capability: 'resource', uri: 'test://x' },
    })
    expect(out).toMatchObject({ capability: 'resource', name: 'test://x' })
    expect(out.error).toBeTruthy()
  })

  it('review item 9: a 0 timeout means no bound (the HTTP rule), not an instant timeout', async () => {
    const out = await mcpCallOnce({
      connect: { transport: 'http', url: server.url },
      call: { capability: 'tool', name: 'echo', args: {} },
      timeoutMs: 0,
    })
    expect(out.error).toBeUndefined()
    expect(out.result).toMatchObject({ content: [{ type: 'text', text: 'hi' }] })
  })

  it('review item 9: progress notifications reset the bound (like Send)', async () => {
    const out = await mcpCallOnce({
      connect: { transport: 'http', url: server.url },
      call: { capability: 'tool', name: 'ticking', args: {} },
      timeoutMs: 600,
    })
    expect(out.error).toBeUndefined()
    expect(out.result).toMatchObject({ content: [{ type: 'text', text: 'done' }] })
  })

  it('review item 7: Stop during tools/list returns promptly and still closes the connection', async () => {
    // A stdio server that answers initialize but never tools/list.
    const stub = `
const rl = require('readline').createInterface({ input: process.stdin })
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
rl.on('line', (line) => {
  let m
  try { m = JSON.parse(line) } catch { return }
  if (m.method === 'initialize') {
    send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05',
      capabilities: { tools: {} }, serverInfo: { name: 'hang-list', version: '0' } } })
  }
})
`
    const controller = new AbortController()
    const started = Date.now()
    const pending = mcpCallOnce({
      connect: {
        transport: 'stdio',
        url: '',
        command: process.execPath,
        args: ['-e', stub],
        protocol: 'legacy',
      },
      call: { capability: 'tool', name: 'x', args: {} },
      signal: controller.signal,
    })
    await waitFor(() => mcpConnectionIds().length === 1, 5_000)
    controller.abort()
    const out = await pending
    expect(Date.now() - started).toBeLessThan(4_000)
    expect(out.cancelled).toBe(true)
    await waitFor(() => mcpConnectionIds().length === 0, 5_000)
  }, 15_000)
})
