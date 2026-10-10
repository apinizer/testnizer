/**
 * Issue #163 — cancel a running MCP call, ON THE WIRE.
 *
 * `mcpCallTool` / `mcpReadResource` / `mcpGetPrompt` take a renderer-chosen
 * `callId`; `mcpCancelCall(connectionId, callId)` aborts it. The SDK then
 * cancels per transport: on a 2025-era connection (and stdio / legacy SSE) it
 * sends `notifications/cancelled`, on a 2026-07-28 Streamable HTTP connection
 * it closes that request's own response stream. Either way the server's
 * handler must see the abort, the call must reject as "cancelled by user",
 * and the connection must stay usable (a second call succeeds).
 */
import http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  mcpCallTool,
  mcpCancelCall,
  mcpConnect,
  mcpDisconnect,
  mcpGetPrompt,
  mcpReadResource,
  setMcpEventSink,
  type McpEngineEvent,
} from '../../src/main/protocols/mcp.engine'
import { startV1Server, startV2Server, waitFor, waitOrAbort } from './mcp-wire-fixtures'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!().catch(() => {})
})

interface Seen {
  log: string[]
}

function textOf(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0].text
}

async function v1(seen: Seen): Promise<string> {
  const srv = await startV1Server((server) => {
    server.registerTool('slow', { description: 'waits', inputSchema: {} }, async (_a, extra) => {
      seen.log.push('slow:start')
      await waitOrAbort(15_000, extra.signal)
      seen.log.push(extra.signal.aborted ? 'slow:aborted' : 'slow:finished')
      return { content: [{ type: 'text', text: 'slow done' }] }
    })
    server.registerTool('echo', { description: 'echo', inputSchema: {} }, async () => ({
      content: [{ type: 'text', text: 'echoed' }],
    }))
    server.registerResource('slow-res', 'test://slow', {}, async (uri, extra) => {
      seen.log.push('res:start')
      await waitOrAbort(15_000, extra.signal)
      seen.log.push(extra.signal.aborted ? 'res:aborted' : 'res:finished')
      return { contents: [{ uri: uri.href, text: 'late' }] }
    })
    server.registerPrompt('slow-prompt', { description: 'waits' }, async (extra) => {
      seen.log.push('prompt:start')
      await waitOrAbort(15_000, extra.signal)
      seen.log.push(extra.signal.aborted ? 'prompt:aborted' : 'prompt:finished')
      return { messages: [{ role: 'user', content: { type: 'text', text: 'late' } }] }
    })
  })
  cleanups.push(srv.close)
  return srv.url
}

async function v2(seen: Seen): Promise<string> {
  const srv = await startV2Server((server) => {
    server.registerTool(
      'slow',
      { description: 'waits', inputSchema: z.object({}) },
      async (_a, ctx) => {
        seen.log.push('slow:start')
        await waitOrAbort(15_000, ctx.mcpReq.signal)
        seen.log.push(ctx.mcpReq.signal.aborted ? 'slow:aborted' : 'slow:finished')
        return { content: [{ type: 'text', text: 'slow done' }] }
      },
    )
    server.registerTool('echo', { description: 'echo', inputSchema: z.object({}) }, async () => ({
      content: [{ type: 'text', text: 'echoed' }],
    }))
  })
  cleanups.push(srv.close)
  return srv.url
}

async function expectCancelled(p: Promise<unknown>): Promise<void> {
  await expect(p).rejects.toMatchObject({
    message: 'MCP call cancelled by user',
    cancelled: true,
  })
}

describe('mcpCancelCall (issue #163)', () => {
  it('2025-era http (v1 server, protocol auto→legacy): the tool sees the cancel, the next call works', async () => {
    const seen: Seen = { log: [] }
    const info = await mcpConnect({ transport: 'http', url: await v1(seen), protocol: 'auto' })
    cleanups.push(() => mcpDisconnect(info.connectionId))
    expect(info.era).toBe('legacy')

    const call = mcpCallTool(info.connectionId, 'slow', {}, { callId: 'c-1' })
    await waitFor(() => seen.log.includes('slow:start'))
    expect(mcpCancelCall(info.connectionId, 'c-1')).toBe(true)
    await expectCancelled(call)
    await waitFor(() => seen.log.includes('slow:aborted'))

    expect(textOf(await mcpCallTool(info.connectionId, 'echo', {}, { callId: 'c-2' }))).toBe(
      'echoed',
    )
    // Entries are dropped on completion: neither id can be cancelled any more.
    expect(mcpCancelCall(info.connectionId, 'c-1')).toBe(false)
    expect(mcpCancelCall(info.connectionId, 'c-2')).toBe(false)
  })

  it('2026-07-28 http (v2 server): closing the request stream aborts the tool, the next call works', async () => {
    const seen: Seen = { log: [] }
    const info = await mcpConnect({ transport: 'http', url: await v2(seen), protocol: 'auto' })
    cleanups.push(() => mcpDisconnect(info.connectionId))
    expect(info.era).toBe('modern')

    const call = mcpCallTool(info.connectionId, 'slow', {}, { callId: 'm-1' })
    await waitFor(() => seen.log.includes('slow:start'))
    expect(mcpCancelCall(info.connectionId, 'm-1')).toBe(true)
    await expectCancelled(call)
    await waitFor(() => seen.log.includes('slow:aborted'))

    expect(textOf(await mcpCallTool(info.connectionId, 'echo', {}))).toBe('echoed')
  })

  it('resources/read and prompts/get are cancellable too', async () => {
    const seen: Seen = { log: [] }
    const info = await mcpConnect({ transport: 'http', url: await v1(seen), protocol: 'legacy' })
    cleanups.push(() => mcpDisconnect(info.connectionId))

    const read = mcpReadResource(info.connectionId, 'test://slow', { callId: 'r-1' })
    await waitFor(() => seen.log.includes('res:start'))
    expect(mcpCancelCall(info.connectionId, 'r-1')).toBe(true)
    await expectCancelled(read)
    await waitFor(() => seen.log.includes('res:aborted'))

    const prompt = mcpGetPrompt(info.connectionId, 'slow-prompt', {}, { callId: 'p-1' })
    await waitFor(() => seen.log.includes('prompt:start'))
    expect(mcpCancelCall(info.connectionId, 'p-1')).toBe(true)
    await expectCancelled(prompt)
    await waitFor(() => seen.log.includes('prompt:aborted'))

    expect(textOf(await mcpCallTool(info.connectionId, 'echo', {}))).toBe('echoed')
  })

  it('stdio: the server receives notifications/cancelled for the request id', async () => {
    // Answers initialize; never answers `slow`; records notifications/cancelled
    // and reports what it saw through `seen`.
    const STUB = `
      const rl = require('readline').createInterface({ input: process.stdin })
      const cancelled = []
      const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n')
      rl.on('line', (line) => {
        const m = JSON.parse(line)
        if (m.method === 'initialize') return send({ jsonrpc: '2.0', id: m.id, result: {
          protocolVersion: m.params.protocolVersion, capabilities: { tools: {} },
          serverInfo: { name: 'stdio-163', version: '0.0.1' } } })
        if (m.method === 'notifications/cancelled') return cancelled.push(m.params)
        if (m.method === 'tools/call' && m.params.name === 'seen') return send({ jsonrpc: '2.0',
          id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(cancelled) }] } })
      })
    `
    const info = await mcpConnect({
      transport: 'stdio',
      url: '',
      command: process.execPath,
      args: ['-e', STUB],
      protocol: 'legacy',
    })
    cleanups.push(() => mcpDisconnect(info.connectionId))

    const call = mcpCallTool(info.connectionId, 'slow', {}, { callId: 's-1' })
    await new Promise((r) => setTimeout(r, 100))
    expect(mcpCancelCall(info.connectionId, 's-1')).toBe(true)
    await expectCancelled(call)

    const seenCancels = JSON.parse(
      textOf(await mcpCallTool(info.connectionId, 'seen', {})),
    ) as Array<{
      requestId: number
      reason?: string
    }>
    expect(seenCancels).toHaveLength(1)
    expect(typeof seenCancels[0].requestId).toBe('number')
  })

  it('unknown connection / call ids are a no-op; disconnect clears the call map', async () => {
    expect(mcpCancelCall('nope', 'nope')).toBe(false)
    const seen: Seen = { log: [] }
    const info = await mcpConnect({ transport: 'http', url: await v1(seen), protocol: 'legacy' })
    const call = mcpCallTool(info.connectionId, 'slow', {}, { callId: 'd-1' })
    await waitFor(() => seen.log.includes('slow:start'))
    await mcpDisconnect(info.connectionId)
    // A disconnect is not a user cancel: the call fails, but not as "cancelled".
    const err = (await call.catch((e: unknown) => e)) as { cancelled?: boolean }
    expect(err).toBeInstanceOf(Error)
    expect(err.cancelled).toBeUndefined()
    expect(mcpCancelCall(info.connectionId, 'd-1')).toBe(false)
  })
})

/**
 * Follow-up to issue #163: on a 2025-era Streamable HTTP connection the SDK
 * only sends `notifications/cancelled`; a v1 server never answers a cancelled
 * request, so that call's POST response stream used to stay open until the
 * session closed (one idle HTTP connection per cancelled call). The engine
 * now aborts that POST itself once the cancellation is sent.
 */
describe('cancelled 2025-era call: its POST response stream is closed (issue #163)', () => {
  /** Proxy in front of `target` that tracks every open client response by request kind. */
  async function trackingProxy(
    target: string,
  ): Promise<{ url: string; open: Map<number, string> }> {
    const upstream = new URL(target)
    const open = new Map<number, string>()
    let n = 0
    const proxy = http.createServer((req, res) => {
      const id = n++
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        const body = Buffer.concat(chunks)
        let label = req.method ?? ''
        try {
          const msg = JSON.parse(body.toString('utf8')) as {
            method?: string
            params?: { name?: string }
          }
          label = `${label} ${msg.method ?? ''} ${msg.params?.name ?? ''}`.trim()
        } catch {
          /* GET / DELETE */
        }
        open.set(id, label)
        res.on('close', () => open.delete(id))
        const up = http.request(
          {
            host: upstream.hostname,
            port: upstream.port,
            path: req.url,
            method: req.method,
            headers: req.headers,
          },
          (ur) => {
            res.writeHead(ur.statusCode ?? 502, ur.headers)
            ur.pipe(res)
          },
        )
        up.on('error', () => res.destroy())
        res.on('close', () => up.destroy())
        up.end(body)
      })
    })
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', () => r()))
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          proxy.closeAllConnections()
          proxy.close(() => resolve())
        }),
    )
    return { url: `http://127.0.0.1:${(proxy.address() as { port: number }).port}/mcp`, open }
  }

  it('after the cancel the server sees the tools/call stream closed; the session stays usable', async () => {
    const events: McpEngineEvent[] = []
    setMcpEventSink((e) => events.push(e))
    cleanups.push(async () => setMcpEventSink(null))
    const seen: Seen = { log: [] }
    const { url, open } = await trackingProxy(await v1(seen))
    const info = await mcpConnect({ transport: 'http', url, protocol: 'legacy' })
    cleanups.push(() => mcpDisconnect(info.connectionId))

    const call = mcpCallTool(info.connectionId, 'slow', {}, { callId: 'l-1' })
    await waitFor(() => seen.log.includes('slow:start'))
    const slowOpen = (): boolean => [...open.values()].some((l) => l.includes('tools/call slow'))
    expect(slowOpen()).toBe(true)

    expect(mcpCancelCall(info.connectionId, 'l-1')).toBe(true)
    await expectCancelled(call)
    await waitFor(() => seen.log.includes('slow:aborted'))
    await waitFor(() => !slowOpen(), 3000)

    // Same session (stateful v1 server): a second call works.
    expect(textOf(await mcpCallTool(info.connectionId, 'echo', {}))).toBe('echoed')
    // The deliberate abort is not reported as a transport error.
    expect(
      events.filter((e) => e.type === 'transportError').map((e) => JSON.stringify(e.payload)),
    ).toEqual([])
  })
})
