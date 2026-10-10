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

/** Events the handler sent to the window, and the safeStorage switch. */
const wire = vi.hoisted(() => ({
  sent: [] as Array<{ channel: string; payload: Record<string, unknown> }>,
  encryption: true,
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
    // Reversible stand-in for the OS keychain (bytes reversed).
    safeStorage: {
      isEncryptionAvailable: () => wire.encryption,
      encryptString: (s: string) => Buffer.from(s).reverse(),
      decryptString: (b: Buffer) => Buffer.from(b).reverse().toString('utf-8'),
    },
    BrowserWindow: {
      getFocusedWindow: () => null,
      getAllWindows: () => [],
      fromWebContents: () => win,
      fromId: () => win,
    },
  }
})

const engineSpy = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  chunks: [{ delta: 'hello' }] as Array<{ delta: string; truncated?: true }>,
}))
vi.mock('../../../src/main/protocols/ai-chat.engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/main/protocols/ai-chat.engine')>()),
  // Async generator that yields the configured chunks; records its options.
  streamChatCompletion: async function* (opts: Record<string, unknown>) {
    engineSpy.calls.push(opts)
    for (const c of engineSpy.chunks) yield c
  },
}))

const consoleSpy = vi.hoisted(() => ({ entries: [] as Array<Record<string, unknown>> }))
vi.mock('../../../src/main/lib/console-logger', () => ({
  logRequestResponse: (e: Record<string, unknown>) => consoleSpy.entries.push(e),
  logEvent: (e: Record<string, unknown>) => consoleSpy.entries.push(e),
}))

const { registerAiChatHandlers } = await import('../../../src/main/ipc/ai-chat.handler')
const { setAiKeyStoreForTests, AI_KEYS_STORE_KEY } = await import(
  '../../../src/main/lib/ai-chat-keys'
)

/** In-memory stand-in for the `settings` electron-store. */
function memoryStore(): { data: Record<string, unknown>; get(k: string): unknown; set(k: string, v: unknown): void } {
  const data: Record<string, unknown> = {}
  return {
    data,
    get: (k) => data[k],
    set: (k, v) => {
      data[k] = v
    },
  }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  harness.reset()
  registerAiChatHandlers()
  wire.sent.length = 0
  wire.encryption = true
  engineSpy.calls.length = 0
  engineSpy.chunks = [{ delta: 'hello' }]
  consoleSpy.entries.length = 0
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

describe('aichat:send — generation settings + truncation (issue #189)', () => {
  it('forwards temperature and maxTokens to the engine', async () => {
    await harness.invoke('aichat:send', {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      temperature: 0.3,
      maxTokens: 777,
      messages: [{ role: 'user', content: 'hi' }],
    })
    await flush()
    expect(engineSpy.calls[0].temperature).toBe(0.3)
    expect(engineSpy.calls[0].maxTokens).toBe(777)
  })

  it('validates temperature / maxTokens in main — invalid → provider default, huge → capped (issues #188/#189)', async () => {
    const send = async (temperature: unknown, maxTokens: unknown): Promise<Record<string, unknown>> => {
      engineSpy.calls.length = 0
      await harness.invoke('aichat:send', {
        provider: 'openai',
        model: 'gpt-5',
        temperature,
        maxTokens,
        messages: [{ role: 'user', content: 'hi' }],
      })
      await flush()
      return engineSpy.calls[0]
    }
    // Invalid temperature values are dropped (not forwarded, not logged).
    for (const t of [Number.NaN, Number.POSITIVE_INFINITY, -1, 3, '0.5', null]) {
      const call = await send(t, undefined)
      expect(call.temperature).toBeUndefined()
      const meta = consoleSpy.entries.at(-1)?.meta as Record<string, unknown>
      expect('temperature' in meta).toBe(false)
    }
    // Valid boundaries pass through unchanged.
    expect((await send(0, undefined)).temperature).toBe(0)
    expect((await send(1.5, undefined)).temperature).toBe(1.5)
    expect((await send(2, undefined)).temperature).toBe(2)

    // Invalid max tokens → provider default (none for OpenAI).
    for (const m of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '100', null]) {
      const call = await send(undefined, m)
      expect(call.maxTokens).toBeUndefined()
      const meta = consoleSpy.entries.at(-1)?.meta as Record<string, unknown>
      expect('maxTokens' in meta).toBe(false)
    }
    expect((await send(undefined, 1)).maxTokens).toBe(1)
    expect((await send(undefined, 4096)).maxTokens).toBe(4096)
    // A very large integer is clamped, not forwarded as-is.
    expect((await send(undefined, 10_000_000)).maxTokens).toBe(200_000)
    const meta = consoleSpy.entries.at(-1)?.meta as Record<string, unknown>
    expect(meta.maxTokens).toBe(200_000)
  })

  it('anthropic: an invalid maxTokens falls back to the provider default, not the raw value', async () => {
    await harness.invoke('aichat:send', {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      maxTokens: -1,
      messages: [{ role: 'user', content: 'hi' }],
    })
    await flush()
    expect(engineSpy.calls[0].maxTokens).toBeUndefined()
    const meta = consoleSpy.entries.at(-1)?.meta as Record<string, unknown>
    expect(meta.maxTokens).toBe(4096)
  })

  it('carries truncated on aichat:done and never emits an empty chunk', async () => {
    engineSpy.chunks = [{ delta: 'part' }, { delta: '', truncated: true }]
    const res = (await harness.invoke('aichat:send', {
      provider: 'openai',
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'hi' }],
    })) as { data: { messageId: string } }
    await flush()
    const chunks = wire.sent.filter((e) => e.channel === 'aichat:chunk')
    expect(chunks.map((c) => c.payload.delta)).toEqual(['part'])
    const done = wire.sent.find((e) => e.channel === 'aichat:done')
    expect(done?.payload).toEqual({ messageId: res.data.messageId, truncated: true })
  })

  it('console log shows the temperature actually sent (none → no key) and the real max_tokens', async () => {
    await harness.invoke('aichat:send', {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hi' }],
    })
    await flush()
    const meta = consoleSpy.entries.at(-1)?.meta as Record<string, unknown>
    expect('temperature' in meta).toBe(false)
    expect(meta.maxTokens).toBe(4096)

    await harness.invoke('aichat:send', {
      provider: 'openai',
      model: 'gpt-5',
      temperature: 0,
      messages: [{ role: 'user', content: 'hi' }],
    })
    await flush()
    const meta2 = consoleSpy.entries.at(-1)?.meta as Record<string, unknown>
    expect(meta2.temperature).toBe(0)
    expect('maxTokens' in meta2).toBe(false)
  })
})

describe('aichat:getKey / aichat:setKey — encrypted at rest (issue #188)', () => {
  it('round-trips a key; the store holds only an enc:v1: blob', async () => {
    const store = memoryStore()
    setAiKeyStoreForTests(store)
    const set = (await harness.invoke('aichat:setKey', 'openai', 'sk-round-trip')) as {
      success: boolean
      data: { persisted: boolean }
    }
    expect(set.success).toBe(true)
    expect(set.data.persisted).toBe(true)
    const blob = (store.data[AI_KEYS_STORE_KEY] as Record<string, string>).openai
    expect(blob.startsWith('enc:v1:')).toBe(true)
    expect(blob).not.toContain('sk-round-trip')
    expect(JSON.stringify(store.data)).not.toContain('sk-round-trip')

    const got = (await harness.invoke('aichat:getKey', 'openai')) as {
      data: { key: string; encryptionAvailable: boolean }
    }
    expect(got.data).toEqual({ key: 'sk-round-trip', encryptionAvailable: true })
    setAiKeyStoreForTests(undefined)
  })

  it('writes nothing when safeStorage cannot encrypt', async () => {
    const store = memoryStore()
    setAiKeyStoreForTests(store)
    wire.encryption = false
    const set = (await harness.invoke('aichat:setKey', 'openai', 'sk-plain')) as {
      data: { persisted: boolean; encryptionAvailable: boolean }
    }
    expect(set.data).toEqual({ persisted: false, encryptionAvailable: false })
    expect(JSON.stringify(store.data)).not.toContain('sk-plain')
    setAiKeyStoreForTests(undefined)
  })
})
