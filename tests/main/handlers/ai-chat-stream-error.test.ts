/**
 * Issue #222 (5) — a mid-stream provider error through the real `aichat:send`
 * IPC path (no deps override: the real `streamChatRound`) against the AI
 * mock on a loopback port:
 *
 *  - the partial text reaches the renderer (`aichat:chunk`) BEFORE the error;
 *  - `aichat:error` carries the provider's type and message, with the call
 *    metrics (HTTP 200 — the stream had started — plus the error);
 *  - the Console entry is an ERROR entry (`logRequestResponse` gets the error;
 *    `levelFromStatus(200, true)` is `error`, not a green 200).
 *
 * Fail-before: `streamChatRound` skipped the error payload; the handler sent
 * `aichat:done` and logged a successful 200.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock } from './helpers'
import { mockServerManager } from '../../../src/main/mock/server'
import { freePort, llmResponse, serverDef } from '../mock-sse-fixtures'

const harness = setupHandlerHarness()

const wire = vi.hoisted(() => ({
  sent: [] as Array<{ channel: string; payload: Record<string, unknown> }>,
  logged: [] as Array<Record<string, unknown>>,
}))

vi.mock('electron', () => {
  const win = {
    id: 1,
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, payload: Record<string, unknown>) => {
        wire.sent.push({ channel, payload })
      },
    },
  }
  return {
    ...makeElectronMock(),
    BrowserWindow: {
      getFocusedWindow: () => null,
      getAllWindows: () => [],
      fromWebContents: () => win,
      fromId: () => win,
    },
  }
})

vi.mock('../../../src/main/lib/console-logger', async (orig) => ({
  ...(await orig<typeof import('../../../src/main/lib/console-logger')>()),
  logRequestResponse: (args: Record<string, unknown>) => {
    wire.logged.push(args)
  },
  logEvent: () => {},
}))

const { registerAiChatHandlers } = await import('../../../src/main/ipc/ai-chat.handler')
const { __testing } = await import('../../../src/main/lib/console-logger')
const { levelFromStatus } = __testing

const ID = 'aichat-stream-error'

beforeEach(() => {
  harness.reset()
  registerAiChatHandlers()
  wire.sent.length = 0
  wire.logged.length = 0
})
afterEach(async () => {
  await mockServerManager.stopAll()
})

const until = async (pred: () => boolean, ms = 3000): Promise<void> => {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}

async function serve(provider: 'openai' | 'anthropic'): Promise<string> {
  const port = await freePort()
  const r = await mockServerManager.start(
    serverDef(ID, port, [
      {
        path: '/v1/x',
        method: 'POST',
        response: llmResponse('one two three four', { provider, streamError: { afterChunks: 2 } }),
      },
    ]),
  )
  expect(r.ok).toBe(true)
  return `http://127.0.0.1:${port}/v1/x`
}

describe('aichat:send with a mid-stream error', () => {
  it.each([
    { provider: 'custom' as const, wire: 'openai' as const, type: 'server_error' },
    { provider: 'anthropic' as const, wire: 'anthropic' as const, type: 'overloaded_error' },
  ])(
    '$provider: partial chunks, then aichat:error with the provider error; Console logs an error',
    async ({ provider, wire: mockWire, type }) => {
      const url = await serve(mockWire)
      const res = (await harness.invoke('aichat:send', {
        provider,
        url,
        model: 'm',
        prompt: 'hi',
        history: [],
      })) as { success: boolean; data: { messageId: string } }
      expect(res.success).toBe(true)
      await until(() => wire.sent.some((e) => e.channel === 'aichat:error'))

      const channels = wire.sent.map((e) => e.channel).filter((c) => c !== 'aichat:event')
      expect(channels).not.toContain('aichat:done')
      const chunks = wire.sent.filter((e) => e.channel === 'aichat:chunk')
      expect(chunks.map((e) => e.payload.delta).join('')).toBe('one two ')
      expect(channels.lastIndexOf('aichat:chunk')).toBeLessThan(channels.indexOf('aichat:error'))

      const err = wire.sent.find((e) => e.channel === 'aichat:error')!.payload
      expect(err.messageId).toBe(res.data.messageId)
      expect(String(err.error)).toContain(`Mid-stream error (${type})`)
      expect(err.metrics).toMatchObject({ status: 200 })

      expect(wire.logged).toHaveLength(1)
      const log = wire.logged[0]
      expect(log.status).toBe(200)
      expect((log.error as { message: string }).message).toContain(type)
      expect(levelFromStatus(log.status as number, !!log.error)).toBe('error')
    },
  )
})
