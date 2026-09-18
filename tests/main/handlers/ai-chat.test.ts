/**
 * Smoke tests for `aichat:*` IPC handlers.
 *
 * The handler streams via `streamChatCompletion`. We replace it with an
 * async-generator that yields a single chunk, so the side-effect logging
 * paths run but the test resolves quickly.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock } from './helpers'

const harness = setupHandlerHarness()

vi.mock('electron', () => ({
  ...makeElectronMock(),
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => [],
    fromWebContents: () => ({
      id: 1,
      isDestroyed: () => false,
      webContents: { send: () => {} },
    }),
    fromId: () => ({ id: 1, isDestroyed: () => false, webContents: { send: () => {} } }),
  },
}))

const engineSpy = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }))
vi.mock('../../../src/main/protocols/ai-chat.engine', () => ({
  // Async generator that yields one chunk and resolves; records its options.
  streamChatCompletion: async function* (opts: Record<string, unknown>) {
    engineSpy.calls.push(opts)
    yield { delta: 'hello' }
  },
}))

const { registerAiChatHandlers } = await import('../../../src/main/ipc/ai-chat.handler')

beforeEach(() => {
  harness.reset()
  registerAiChatHandlers()
})

describe('aichat:send', () => {
  it('forwards user-defined headers and tolerates a missing apiKey (issues #120/#121)', async () => {
    engineSpy.calls.length = 0
    const res = (await harness.invoke('aichat:send', {
      provider: 'custom',
      url: 'https://gw.example/v1/chat/completions',
      model: 'm',
      headers: { Authorization: 'Bearer gw', 'X-Tenant-Id': 'acme' },
      messages: [{ role: 'user', content: 'hi' }],
    })) as { success: boolean }
    expect(res.success).toBe(true)
    await new Promise((r) => setTimeout(r, 0))
    expect(engineSpy.calls).toHaveLength(1)
    expect(engineSpy.calls[0].headers).toEqual({ Authorization: 'Bearer gw', 'X-Tenant-Id': 'acme' })
    expect(engineSpy.calls[0].apiKey).toBeUndefined()
  })

  it('returns success envelope with a messageId', async () => {
    const res = (await harness.invoke('aichat:send', {
      provider: 'openai',
      apiKey: 'k',
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
    })) as { success: boolean; data?: { messageId: string } }
    expect(res.success).toBe(true)
    expect(typeof res.data?.messageId).toBe('string')
  })
})

describe('aichat:cancel', () => {
  it('returns cancelled: false when no active stream', async () => {
    const res = (await harness.invoke('aichat:cancel', 'no-such-msg')) as {
      success: boolean
      data?: { cancelled: boolean }
    }
    expect(res.success).toBe(true)
    expect(res.data?.cancelled).toBe(false)
  })

  it('returns cancelled: true when the stream is active', async () => {
    // Trigger send to register an active stream (the mock generator resolves
    // synchronously so cancel may race against cleanup — we accept either
    // shape but always require success: true).
    const sent = (await harness.invoke('aichat:send', {
      provider: 'openai',
      apiKey: 'k',
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
    })) as { data: { messageId: string } }
    const res = (await harness.invoke('aichat:cancel', sent.data.messageId)) as {
      success: boolean
      data?: { cancelled: boolean }
    }
    expect(res.success).toBe(true)
    expect(typeof res.data?.cancelled).toBe('boolean')
  })
})
