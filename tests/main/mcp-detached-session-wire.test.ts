/**
 * Issue #180 — AI Chat's ONE detached MCP connection per Send, on the wire:
 * connect + tools/list once, several calls on the same connection, Stop
 * cancelling a running call (the real `slow` tool sees the abort), and the
 * connection always closed. Also the loop end-to-end over a real server.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  mcpConnectionIds,
  mcpDisconnect,
  mcpOpenDetachedSession,
  mcpSessionCallTool,
} from '../../src/main/protocols/mcp.engine'
import { runAiTurn, type AiLoopDeps } from '../../src/main/protocols/ai-chat-loop'
import type { AiRoundEvent, AiStreamOptions } from '../../src/main/protocols/ai-chat.engine'
import { startV2Server, waitOrAbort, type RunningServer } from './mcp-wire-fixtures'

let server: RunningServer
let slowAborted = false

beforeAll(async () => {
  server = await startV2Server((mcp) => {
    mcp.registerTool(
      'echo',
      { description: 'echo', inputSchema: z.object({ text: z.string() }) },
      async ({ text }) => ({ content: [{ type: 'text', text: `echo:${text}` }] }),
    )
    mcp.registerTool(
      'slow',
      { description: 'slow', inputSchema: z.object({}) },
      async (_a, ctx) => {
        await waitOrAbort(5_000, ctx.mcpReq.signal)
        // The client's cancellation reached the server (not just a local give-up).
        if (ctx.mcpReq.signal.aborted) slowAborted = true
        return { content: [{ type: 'text', text: 'late' }] }
      },
    )
  })
})

afterAll(async () => {
  await server?.close()
})

describe('mcpOpenDetachedSession / mcpSessionCallTool', () => {
  it('one connection serves list + several calls, then closes', async () => {
    const s = await mcpOpenDetachedSession({ connect: { transport: 'http', url: server.url } })
    expect(s.tools.map((t) => t.name).sort()).toEqual(['echo', 'slow'])
    const a = await mcpSessionCallTool(s.connectionId, 'echo', { text: 'a' })
    const b = await mcpSessionCallTool(s.connectionId, 'echo', { text: 'b' })
    expect(a.result).toMatchObject({ content: [{ text: 'echo:a' }] })
    expect(b.result).toMatchObject({ content: [{ text: 'echo:b' }] })
    expect(mcpConnectionIds()).toEqual([s.connectionId])
    await mcpDisconnect(s.connectionId)
    expect(mcpConnectionIds()).toEqual([])
  })

  it('an aborted signal cancels the running call on the server', async () => {
    slowAborted = false
    const s = await mcpOpenDetachedSession({ connect: { transport: 'http', url: server.url } })
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 100)
    const started = Date.now()
    const out = await mcpSessionCallTool(s.connectionId, 'slow', {}, { signal: controller.signal })
    expect(out.cancelled).toBe(true)
    expect(Date.now() - started).toBeLessThan(3_000)
    await mcpDisconnect(s.connectionId)
    await new Promise((r) => setTimeout(r, 100))
    expect(slowAborted).toBe(true)
  })

  it('an unreachable server rejects and leaves no connection', async () => {
    await expect(
      mcpOpenDetachedSession({
        connect: { transport: 'http', url: 'http://127.0.0.1:9/mcp' },
        timeoutMs: 3_000,
      }),
    ).rejects.toBeTruthy()
    expect(mcpConnectionIds()).toEqual([])
  })
})

describe('runAiTurn over a real MCP server', () => {
  const deps = (script: AiRoundEvent[][]): AiLoopDeps & { bodies: AiStreamOptions[] } => {
    const bodies: AiStreamOptions[] = []
    let i = 0
    return {
      bodies,
      streamRound: async function* (o) {
        bodies.push({ ...o, messages: [...o.messages] })
        for (const ev of script[Math.min(i++, script.length - 1)]) yield ev
      },
      openSession: (connect, signal, timeoutMs) =>
        mcpOpenDetachedSession({
          connect,
          signal,
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        }),
      callTool: (id, name, args, opts) => mcpSessionCallTool(id, name, args, opts),
      closeSession: (id) => mcpDisconnect(id),
      isTrusted: async () => false,
    }
  }
  const endEv = (calls: Array<{ id: string; name: string; argsJson: string }>): AiRoundEvent => ({
    type: 'end',
    toolCalls: calls,
    usage: null,
    stopReason: null,
    firstContentAt: null,
    status: 200,
  })
  const tools = {
    servers: [
      {
        id: 's',
        name: 'Wire',
        connect: { transport: 'http' as const, url: '', protocol: 'auto' },
        disabledTools: [],
      },
    ],
    autoApprove: true,
    allowedTools: [],
  }

  it('calls the real tool and feeds its text back to the model', async () => {
    tools.servers[0].connect.url = server.url
    const d = deps([
      [endEv([{ id: 'c1', name: 'Wire__echo', argsJson: '{"text":"hi"}' }])],
      [{ type: 'text', delta: 'final' }, endEv([])],
    ])
    const res = await runAiTurn(
      {
        stream: { provider: 'openai', model: 'm' },
        messages: [{ role: 'user', content: 'go' }],
        tools,
      },
      d,
      {
        signal: new AbortController().signal,
        onText: () => {},
        onTruncated: () => {},
        onPart: () => {},
        onCall: () => {},
        askApproval: async () => 'once',
        askStdioTrust: async () => 'skip',
      },
    )
    expect(res.outcome).toBe('done')
    expect(d.bodies[1].messages.at(-1)).toEqual({
      role: 'tool',
      results: [{ id: 'c1', content: 'echo:hi', isError: false }],
    })
    expect(mcpConnectionIds()).toEqual([])
  })

  it('Stop during the real slow call cancels it and closes the connection', async () => {
    slowAborted = false
    tools.servers[0].connect.url = server.url
    const controller = new AbortController()
    const d = deps([[endEv([{ id: 'c1', name: 'Wire__slow', argsJson: '{}' }])]])
    setTimeout(() => controller.abort(), 300)
    const res = await runAiTurn(
      {
        stream: { provider: 'openai', model: 'm' },
        messages: [{ role: 'user', content: 'go' }],
        tools,
      },
      d,
      {
        signal: controller.signal,
        onText: () => {},
        onTruncated: () => {},
        onPart: () => {},
        onCall: () => {},
        askApproval: async () => 'once',
        askStdioTrust: async () => 'skip',
      },
    )
    expect(res.outcome).toBe('cancelled')
    expect(mcpConnectionIds()).toEqual([])
    await new Promise((r) => setTimeout(r, 100))
    expect(slowAborted).toBe(true)
  })
})
