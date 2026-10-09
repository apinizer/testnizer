/**
 * Issue #168 — form elicitation for 2025-era servers, ON THE WIRE.
 *
 * A 2025 server asks for input with a server→client `elicitation/create`
 * request, and only if the client declared `capabilities.elicitation` at
 * `initialize` (the v1 SDK's `elicitInput` refuses otherwise). The engine
 * declares form elicitation on the Client, turns each request into an
 * `elicitation` event for the owning connection, and answers it with what
 * `mcpRespondElicitation` delivers — or `cancel` on disconnect / timeout.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { McpServer as McpServerV1 } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CLIENT_CAPABILITIES_META_KEY } from '@modelcontextprotocol/client'
import {
  mcpCallTool,
  mcpConnect,
  mcpListTools,
  mcpDisconnect,
  mcpRespondElicitation,
  setMcpElicitationTimeoutMs,
  setMcpEventSink,
  type McpEngineEvent,
  type McpElicitationEvent,
} from '../../src/main/protocols/mcp.engine'
import { startV1Server, startV2Server, waitFor } from './mcp-wire-fixtures'
import { z } from 'zod'

let events: McpEngineEvent[] = []
const cleanups: Array<() => Promise<void>> = []

beforeEach(() => {
  events = []
  setMcpEventSink((e) => events.push(e))
})

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!().catch(() => {})
  setMcpEventSink(null)
  setMcpElicitationTimeoutMs(null)
})

const SCHEMA = {
  type: 'object' as const,
  properties: { name: { type: 'string' as const, title: 'Name' } },
  required: ['name'],
}

function registerAskName(server: McpServerV1): void {
  server.registerTool('ask_name', { description: 'asks', inputSchema: {} }, async (_a, extra) => {
    try {
      const r = await server.server.elicitInput(
        { message: 'What is your name?', requestedSchema: SCHEMA },
        { relatedRequestId: extra.requestId },
      )
      const text = r.action === 'accept' ? `hello ${String(r.content?.name)}` : `action:${r.action}`
      return { content: [{ type: 'text', text }] }
    } catch (err) {
      return { content: [{ type: 'text', text: `error:${(err as Error).message}` }], isError: true }
    }
  })
}

async function connectV1(protocol: 'auto' | 'legacy' = 'legacy'): Promise<string> {
  const srv = await startV1Server(registerAskName)
  cleanups.push(srv.close)
  const info = await mcpConnect({ transport: 'http', url: srv.url, protocol })
  cleanups.push(() => mcpDisconnect(info.connectionId))
  return info.connectionId
}

function elicitations(connectionId: string): McpElicitationEvent[] {
  return events.flatMap((e) =>
    e.type === 'elicitation' && e.payload.connectionId === connectionId ? [e.payload] : [],
  )
}

function textOf(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0].text
}

describe('elicitation/create on 2025-era connections (issue #168)', () => {
  it.each(['legacy', 'auto'] as const)(
    'protocol %s: the request reaches the owning connection; accept → the tool uses the answer',
    async (protocol) => {
      const id = await connectV1(protocol)
      const call = mcpCallTool(id, 'ask_name', {})
      await waitFor(() => elicitations(id).length === 1)
      const ev = elicitations(id)[0]
      expect(ev).toMatchObject({
        connectionId: id,
        serverName: 'wire-v1',
        message: 'What is your name?',
        requestedSchema: SCHEMA,
        mode: 'form',
      })
      expect(typeof ev.elicitationId).toBe('string')

      mcpRespondElicitation(id, ev.elicitationId, { action: 'accept', content: { name: 'Ada' } })
      expect(textOf(await call)).toBe('hello Ada')
    },
  )

  it.each(['decline', 'cancel'] as const)('%s → the tool result reflects it', async (action) => {
    const id = await connectV1()
    const call = mcpCallTool(id, 'ask_name', {})
    await waitFor(() => elicitations(id).length === 1)
    mcpRespondElicitation(id, elicitations(id)[0].elicitationId, { action })
    expect(textOf(await call)).toBe(`action:${action}`)
  })

  it('an unknown / already answered elicitation id is an error', async () => {
    const id = await connectV1()
    const call = mcpCallTool(id, 'ask_name', {})
    await waitFor(() => elicitations(id).length === 1)
    const { elicitationId } = elicitations(id)[0]
    mcpRespondElicitation(id, elicitationId, { action: 'decline' })
    await call
    expect(() => mcpRespondElicitation(id, elicitationId, { action: 'decline' })).toThrow(
      /No pending elicitation/,
    )
    expect(() => mcpRespondElicitation('other', elicitationId, { action: 'decline' })).toThrow(
      /No pending elicitation/,
    )
  })

  it('a pending elicitation is answered cancel after the timeout', async () => {
    setMcpElicitationTimeoutMs(150)
    const id = await connectV1()
    const call = mcpCallTool(id, 'ask_name', {})
    await waitFor(() => elicitations(id).length === 1)
    expect(textOf(await call)).toBe('action:cancel')
  })

  it('a pending elicitation is answered cancel on disconnect', async () => {
    const answers: string[] = []
    const srv = await startV1Server((server) => {
      server.registerTool('ask', { description: 'asks', inputSchema: {} }, async (_a, extra) => {
        const r = await server.server.elicitInput(
          { message: 'Name?', requestedSchema: SCHEMA },
          { relatedRequestId: extra.requestId },
        )
        answers.push(r.action)
        return { content: [{ type: 'text', text: r.action }] }
      })
    })
    cleanups.push(srv.close)
    const info = await mcpConnect({ transport: 'http', url: srv.url, protocol: 'legacy' })
    const call = mcpCallTool(info.connectionId, 'ask', {}).catch(() => undefined)
    await waitFor(() => elicitations(info.connectionId).length === 1)
    const { elicitationId } = elicitations(info.connectionId)[0]
    await mcpDisconnect(info.connectionId)
    await call
    await waitFor(() => answers.length === 1)
    expect(answers).toEqual(['cancel'])
    expect(() =>
      mcpRespondElicitation(info.connectionId, elicitationId, { action: 'accept', content: {} }),
    ).toThrow(/No pending elicitation/)
  })

  it('2026-07-28: the per-request envelope advertises elicitation on tools/call ONLY', async () => {
    const srv = await startV2Server((server) => {
      server.registerTool('plain', { description: 'p', inputSchema: z.object({}) }, async () => ({
        content: [{ type: 'text', text: 'ok' }],
      }))
    })
    cleanups.push(srv.close)
    const info = await mcpConnect({ transport: 'http', url: srv.url, protocol: 'auto' })
    cleanups.push(() => mcpDisconnect(info.connectionId))
    expect(info.era).toBe('modern')
    await mcpListTools(info.connectionId)
    expect(textOf(await mcpCallTool(info.connectionId, 'plain', {}))).toBe('ok')
    await new Promise((r) => setTimeout(r, 20))

    const capsOf = (method: string): Record<string, unknown> | undefined => {
      const frame = events.find(
        (e) =>
          e.type === 'frame' &&
          e.payload.direction === 'out' &&
          (e.payload.message as { method?: string }).method === method,
      )
      if (frame?.type !== 'frame') throw new Error(`no ${method} frame`)
      const meta = (frame.payload.message as { params?: { _meta?: Record<string, unknown> } })
        .params?._meta
      return meta?.[CLIENT_CAPABILITIES_META_KEY] as Record<string, unknown> | undefined
    }
    expect(capsOf('tools/call')).toEqual({ elicitation: { form: {} } })
    expect(capsOf('tools/list')).toBeDefined()
    expect(capsOf('tools/list')).not.toHaveProperty('elicitation')
  })
})
