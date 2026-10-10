/**
 * Issue #188 — AI Chat wrote the provider API key and custom headers (which
 * may carry `Authorization`) in plain text to localStorage
 * (`testnizer-ai-chat`). Now: the snapshot is sanitized (no key, no
 * credential headers), the key goes to main's encrypted store per provider,
 * an old plaintext snapshot is migrated on first load, and the key field is
 * `{{var}}`-resolved at send.
 *
 * Issue #189 — temperature / max tokens travel from the store to the IPC
 * payload, and a truncated answer is flagged on its message.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import React from 'react'

const STORAGE_KEY = 'testnizer-ai-chat'
type Res<T> = { success: boolean; data?: T; error?: string }

function installAiApi(opts: { encryption?: boolean; stored?: Record<string, string> } = {}) {
  const encryption = opts.encryption ?? true
  const stored = { ...(opts.stored ?? {}) }
  const aiChat = {
    send: vi.fn(async (_p: Record<string, unknown>): Promise<Res<{ messageId: string }>> => ({
      success: true,
      data: { messageId: 'msg-1' },
    })),
    cancel: vi.fn(async () => ({ success: true })),
    getKey: vi.fn(async (scope: string) => ({
      success: true,
      data: { key: encryption ? (stored[scope] ?? '') : '', encryptionAvailable: encryption },
    })),
    setKey: vi.fn(async (scope: string, key: string) => {
      if (encryption) {
        if (key) stored[scope] = key
        else delete stored[scope]
      }
      return { success: true, data: { persisted: encryption || !key, encryptionAvailable: encryption } }
    }),
    onChunk: () => () => {},
    onDone: () => () => {},
    onError: () => () => {},
    onCancelled: () => () => {},
  }
  ;(window as unknown as { api: { aiChat: typeof aiChat } }).api = { aiChat }
  return { aiChat, stored }
}

type StoreModule = typeof import('../../src/renderer/stores/ai-chat.store')

let lastStore: StoreModule | null = null

/** Fresh store module — it reads (and migrates) localStorage at load. */
async function loadStore(): Promise<StoreModule> {
  vi.resetModules()
  lastStore = await import('../../src/renderer/stores/ai-chat.store')
  return lastStore
}

const snapshot = (): string => window.localStorage.getItem(STORAGE_KEY) ?? ''

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  // A debounced key write left by a test would fire later against the NEXT
  // test's `window.api` (it reads the bridge at flush time) — drop it.
  lastStore?.resetAiKeySessionForTests()
  lastStore = null
  vi.useRealTimers()
})

describe('issue #188 — the localStorage snapshot never holds the key or credential headers', () => {
  it('strips apiKey and credential headers from the live and cached tab states', async () => {
    installAiApi()
    const { useAiChatStore } = await loadStore()
    const s = useAiChatStore.getState()
    s.switchToTab('t1')
    s.setApiKey('sk-plain-SECRET-1')
    useAiChatStore.getState().setHeaders([
      { id: 'a', key: 'Authorization', value: 'Bearer raw-SECRET-2', enabled: true },
      { id: 'b', key: 'X-Gateway-Key', value: 'gw-SECRET-3', enabled: true },
      { id: 'c', key: 'Authorization', value: 'Bearer {{token}}', enabled: true },
      { id: 'd', key: 'X-Tenant', value: 'acme', enabled: true },
    ])
    // Cache t1, then edit t2 so both paths (current + _tabStates) are written.
    useAiChatStore.getState().switchToTab('t2')
    useAiChatStore.getState().setApiKey('sk-plain-SECRET-4')

    const raw = snapshot()
    expect(raw).not.toBe('')
    for (const secret of ['SECRET-1', 'SECRET-2', 'SECRET-3', 'SECRET-4']) {
      expect(raw).not.toContain(secret)
    }
    // Template-only and ordinary headers survive.
    expect(raw).toContain('Bearer {{token}}')
    expect(raw).toContain('X-Tenant')

    // In memory the session keeps everything (tab switch does not lose it).
    useAiChatStore.getState().switchToTab('t1')
    expect(useAiChatStore.getState().customHeaders.map((h) => h.value)).toContain(
      'Bearer raw-SECRET-2',
    )
  })

  it('writes the key to main per provider (debounced), never to localStorage', async () => {
    vi.useFakeTimers()
    const api = installAiApi()
    const { useAiChatStore, flushAiKeyWrites } = await loadStore()
    useAiChatStore.getState().setProvider('anthropic')
    useAiChatStore.getState().setApiKey('sk-a')
    useAiChatStore.getState().setApiKey('sk-ant-final')
    expect(api.aiChat.setKey).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(600)
    await flushAiKeyWrites()
    expect(api.aiChat.setKey).toHaveBeenCalledTimes(1)
    expect(api.aiChat.setKey).toHaveBeenCalledWith('anthropic', 'sk-ant-final')
    expect(snapshot()).not.toContain('sk-ant-final')
  })

  it('custom provider: one key per base URL', async () => {
    const api = installAiApi({ stored: { 'custom:https://gw-b.example': 'key-b' } })
    const { useAiChatStore, flushAiKeyWrites } = await loadStore()
    const s = useAiChatStore.getState()
    s.setProvider('custom')
    useAiChatStore.getState().setCustomUrl('https://gw-a.example/v1/chat/completions')
    useAiChatStore.getState().setApiKey('key-a')
    await flushAiKeyWrites()
    expect(api.aiChat.setKey).toHaveBeenCalledWith('custom:https://gw-a.example', 'key-a')

    // Another gateway with its own stored key → that key, not key-a.
    useAiChatStore.getState().setCustomUrl('https://gw-b.example/v1/chat/completions')
    await vi.waitFor(() => expect(useAiChatStore.getState().apiKey).toBe('key-b'))
    // Back to the first gateway → key-a again (from the session).
    useAiChatStore.getState().setCustomUrl('https://gw-a.example/other/path')
    expect(useAiChatStore.getState().apiKey).toBe('key-a')
  })

  it('switching provider never carries the old key over', async () => {
    installAiApi()
    const { useAiChatStore } = await loadStore()
    useAiChatStore.getState().setApiKey('sk-openai-only')
    useAiChatStore.getState().setProvider('groq')
    expect(useAiChatStore.getState().apiKey).toBe('')
    useAiChatStore.getState().setProvider('openai')
    expect(useAiChatStore.getState().apiKey).toBe('sk-openai-only')
  })
})

/** Let pending getKey answers land. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('issue #188 — a Custom URL edit never moves a key to another gateway', () => {
  it('gateway A → gateway B: the field clears at once, a Send carries nothing, B never stores A\'s key', async () => {
    const api = installAiApi()
    const { useAiChatStore, flushAiKeyWrites } = await loadStore()
    useAiChatStore.getState().setProvider('custom')
    useAiChatStore.getState().setCustomUrl('https://gw-a.example/v1/chat/completions')
    useAiChatStore.getState().setApiKey('key-A-SECRET')
    await flushAiKeyWrites()
    await settle()
    api.aiChat.setKey.mockClear()

    useAiChatStore.getState().setCustomUrl('https://gw-b.example/v1/chat/completions')
    // Synchronously — before main has answered for B.
    expect(useAiChatStore.getState().apiKey).toBe('')
    await useAiChatStore.getState().sendPrompt('hi')
    expect(api.aiChat.send.mock.calls[0][0].apiKey).toBe('')

    await vi.waitFor(() =>
      expect(api.aiChat.getKey).toHaveBeenCalledWith('custom:https://gw-b.example'),
    )
    await settle()
    expect(useAiChatStore.getState().apiKey).toBe('')
    await flushAiKeyWrites()
    expect(api.aiChat.setKey).not.toHaveBeenCalled()
    expect(api.stored['custom:https://gw-b.example']).toBeUndefined()

    // A keeps its own key.
    useAiChatStore.getState().setCustomUrl('https://gw-a.example/v1/chat/completions')
    expect(useAiChatStore.getState().apiKey).toBe('key-A-SECRET')
  })

  it('gateway A → unparseable text → gateway B: A\'s key does not ride the intermediate step', async () => {
    const api = installAiApi()
    const { useAiChatStore, flushAiKeyWrites } = await loadStore()
    useAiChatStore.getState().setProvider('custom')
    useAiChatStore.getState().setCustomUrl('https://gw-a.example/v1')
    useAiChatStore.getState().setApiKey('key-A-SECRET')
    await flushAiKeyWrites()
    await settle()
    api.aiChat.setKey.mockClear()

    for (const step of ['https:/', 'https://', 'https://gw-b.example', 'https://gw-b.example/v1']) {
      useAiChatStore.getState().setCustomUrl(step)
      await settle()
      expect(useAiChatStore.getState().apiKey).toBe('')
    }
    await flushAiKeyWrites()
    expect(api.aiChat.setKey).not.toHaveBeenCalled()
    expect(Object.keys(api.stored)).toEqual(['custom:https://gw-a.example'])
  })

  it('typing a URL char by char after the key: the key follows in memory, nothing is stored under intermediate origins', async () => {
    vi.useFakeTimers()
    const api = installAiApi()
    const { useAiChatStore, flushAiKeyWrites } = await loadStore()
    useAiChatStore.getState().setProvider('custom')
    useAiChatStore.getState().setCustomUrl('')
    useAiChatStore.getState().setApiKey('sk-typed-first')
    await vi.advanceTimersByTimeAsync(600)
    await flushAiKeyWrites()
    expect(api.aiChat.setKey).toHaveBeenCalledWith('custom:', 'sk-typed-first')
    api.aiChat.setKey.mockClear()

    const target = 'https://api.example.com/v1/chat'
    for (let i = 1; i <= target.length; i++) {
      useAiChatStore.getState().setCustomUrl(target.slice(0, i))
      await vi.advanceTimersByTimeAsync(0)
    }
    await vi.advanceTimersByTimeAsync(600)
    await flushAiKeyWrites()
    // Never persisted — not under https://a, https://ap, … nor the final origin.
    expect(api.aiChat.setKey).not.toHaveBeenCalled()
    // Still usable for this session.
    expect(useAiChatStore.getState().apiKey).toBe('sk-typed-first')
  })

  it('templated base URL: a path edit keeps the key in memory only; a real origin never gets it', async () => {
    const api = installAiApi()
    const { useAiChatStore, flushAiKeyWrites } = await loadStore()
    useAiChatStore.getState().setProvider('custom')
    useAiChatStore.getState().setCustomUrl('{{baseUrl}}/v1')
    useAiChatStore.getState().setApiKey('sk-tpl')
    await flushAiKeyWrites()
    await settle()
    api.aiChat.setKey.mockClear()

    useAiChatStore.getState().setCustomUrl('{{baseUrl}}/v1/chat/completions')
    await vi.waitFor(() => expect(useAiChatStore.getState().apiKey).toBe('sk-tpl'))
    await flushAiKeyWrites()
    expect(api.aiChat.setKey).not.toHaveBeenCalled()

    // Templated → a real third-party origin: the template may have meant
    // another gateway, so the key does not follow (cleared at once).
    useAiChatStore.getState().setCustomUrl('https://third-party.example/v1/chat/completions')
    expect(useAiChatStore.getState().apiKey).toBe('')
    await useAiChatStore.getState().sendPrompt('hi')
    expect(api.aiChat.send.mock.calls[0][0].apiKey).toBe('')
    await settle()
    expect(useAiChatStore.getState().apiKey).toBe('')
    await flushAiKeyWrites()
    expect(api.aiChat.setKey).not.toHaveBeenCalled()
    expect(api.stored['custom:https://third-party.example']).toBeUndefined()

    // Back on the templated path the carried key is there (memory), and an
    // explicit edit is what persists it for that scope.
    useAiChatStore.getState().setCustomUrl('{{baseUrl}}/v1/chat/completions')
    expect(useAiChatStore.getState().apiKey).toBe('sk-tpl')
    useAiChatStore.getState().setApiKey('sk-tpl-2')
    await flushAiKeyWrites()
    expect(api.aiChat.setKey).toHaveBeenCalledWith('custom:{{baseUrl}}/v1/chat/completions', 'sk-tpl-2')
  })
})

describe('issue #188 — upgrade migration from a plaintext snapshot', () => {
  it('moves old plaintext keys into the encrypted store and removes them from localStorage', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        current: {
          provider: 'openai',
          customUrl: 'https://api.openai.com/v1/chat/completions',
          apiKey: 'sk-OLD-openai',
          model: 'gpt-5',
          customHeaders: [{ id: 'h', key: 'Authorization', value: 'Bearer OLD-hdr', enabled: true }],
          messages: [],
        },
        _currentTabId: 'tab-1',
        _tabStates: [
          [
            'tab-2',
            {
              provider: 'custom',
              customUrl: 'https://gw.example/v1/chat/completions',
              apiKey: 'sk-OLD-custom',
              model: 'm',
              customHeaders: [],
              messages: [],
            },
          ],
        ],
      }),
    )
    const api = installAiApi()
    const { useAiChatStore } = await loadStore()

    // Plaintext gone from disk immediately…
    expect(snapshot()).not.toContain('sk-OLD-openai')
    expect(snapshot()).not.toContain('sk-OLD-custom')
    expect(snapshot()).not.toContain('OLD-hdr')
    // …moved to main's encrypted store…
    await vi.waitFor(() => expect(api.aiChat.setKey).toHaveBeenCalledTimes(2))
    expect(api.aiChat.setKey).toHaveBeenCalledWith('openai', 'sk-OLD-openai')
    expect(api.aiChat.setKey).toHaveBeenCalledWith('custom:https://gw.example', 'sk-OLD-custom')
    expect(api.stored).toEqual({
      openai: 'sk-OLD-openai',
      'custom:https://gw.example': 'sk-OLD-custom',
    })
    // …and still usable in this session.
    expect(useAiChatStore.getState().apiKey).toBe('sk-OLD-openai')
    expect(useAiChatStore.getState().keyStorage).toBe('encrypted')
  })

  it('a reload with an encrypted key gets it back from main', async () => {
    installAiApi({ stored: { openai: 'sk-from-main' } })
    const { useAiChatStore } = await loadStore()
    await vi.waitFor(() => expect(useAiChatStore.getState().apiKey).toBe('sk-from-main'))
  })

  it('no safeStorage: nothing is persisted, the key stays in memory and the note shows', async () => {
    installAiApi({ encryption: false })
    const mod = await loadStore()
    const { default: AiChatApiKeyField } = await import(
      '../../src/renderer/components/protocols/ai-chat/AiChatApiKeyField'
    )
    mod.useAiChatStore.getState().setApiKey('sk-mem')
    await mod.flushAiKeyWrites()
    expect(mod.useAiChatStore.getState().keyStorage).toBe('memory')
    expect(mod.useAiChatStore.getState().apiKey).toBe('sk-mem')
    expect(snapshot()).not.toContain('sk-mem')
    render(<AiChatApiKeyField />)
    expect(screen.getByTestId('ai-key-memory-note')).toBeTruthy()
  })
})

describe('issues #188 / #189 — what sendPrompt sends', () => {
  it('resolves {{var}} in the key and forwards temperature / max tokens', async () => {
    const api = installAiApi()
    const { useAiChatStore } = await loadStore()
    const { useEnvironmentStore } = await import('../../src/renderer/stores/environment.store')
    useEnvironmentStore.setState({
      ...useEnvironmentStore.getState(),
      getActiveVariables: () => ({ aiKey: 'sk-resolved' }),
    } as never)
    useAiChatStore.getState().setApiKey('{{aiKey}}')
    useAiChatStore.getState().setTemperature(0.2)
    useAiChatStore.getState().setMaxTokens(321)
    await useAiChatStore.getState().sendPrompt('hello')
    const payload = api.aiChat.send.mock.calls[0][0]
    expect(payload.apiKey).toBe('sk-resolved')
    expect(payload.temperature).toBe(0.2)
    expect(payload.maxTokens).toBe(321)
  })

  it('leaves temperature / max tokens out when unset (provider default)', async () => {
    const api = installAiApi()
    const { useAiChatStore } = await loadStore()
    await useAiChatStore.getState().sendPrompt('hello')
    const payload = api.aiChat.send.mock.calls[0][0]
    expect('temperature' in payload).toBe(false)
    expect('maxTokens' in payload).toBe(false)
  })

  it('flags a truncated answer on its message (issue #189)', async () => {
    installAiApi()
    const { useAiChatStore } = await loadStore()
    const { default: AiChatEditor } = await import(
      '../../src/renderer/components/protocols/AiChatEditor'
    )
    await useAiChatStore.getState().sendPrompt('long answer please')
    useAiChatStore.getState()._onChunk('msg-1', 'partial answer')
    useAiChatStore.getState()._onDone('msg-1', true)
    const assistant = useAiChatStore.getState().messages.find((m) => m.role === 'assistant')
    expect(assistant?.truncated).toBe(true)
    render(<AiChatEditor />)
    expect(screen.getByTestId('ai-truncated-note').textContent).toMatch(
      /Answer truncated: max tokens reached/,
    )
  })
})
