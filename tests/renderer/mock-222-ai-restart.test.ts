/**
 * Issue #222 (3) — a mock-opened AI Chat tab stays "no saved key" after a
 * restart: the mark is in the localStorage snapshot, and the store's
 * module-load `syncLiveKey()` (which brings the provider key back for the
 * restored tab) must not ask main for the Anthropic key. Control: the same
 * tab without the mark does load it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'testnizer-ai-chat'
const MOCK_URL = 'http://127.0.0.1:3300/v1/messages'

function installAiApi(stored: Record<string, string>) {
  const aiChat = {
    send: vi.fn(async () => ({ success: true, data: { messageId: 'm' } })),
    cancel: vi.fn(async () => ({ success: true })),
    getKey: vi.fn(async (scope: string) => ({
      success: true,
      data: { key: stored[scope] ?? '', encryptionAvailable: true },
    })),
    setKey: vi.fn(async () => ({
      success: true,
      data: { persisted: true, encryptionAvailable: true },
    })),
    onChunk: () => () => {},
    onDone: () => () => {},
    onError: () => () => {},
    onCancelled: () => () => {},
  }
  ;(window as unknown as { api: { aiChat: typeof aiChat } }).api = { aiChat }
  return aiChat
}

type StoreModule = typeof import('../../src/renderer/stores/ai-chat.store')
let lastStore: StoreModule | null = null

async function loadStore(): Promise<StoreModule> {
  vi.resetModules()
  lastStore = await import('../../src/renderer/stores/ai-chat.store')
  return lastStore
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0))
}

/** First run: an Anthropic tab on the mock URL, with or without the mark. */
async function writeSnapshot(marked: boolean): Promise<void> {
  const { useAiChatStore } = await loadStore()
  const s = useAiChatStore.getState()
  s.switchToTab('t1')
  if (marked) useAiChatStore.getState().setSavedKeyDisabled(true)
  useAiChatStore.getState().setProvider('anthropic')
  useAiChatStore.getState().setCustomUrl(MOCK_URL)
  await settle()
  lastStore?.resetAiKeySessionForTests()
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  lastStore?.resetAiKeySessionForTests()
  lastStore = null
})

describe('issue #222 (3) — the "no saved key" mark survives a restart', () => {
  it('restored mock tab: the mark is back, the Anthropic key is never asked for', async () => {
    const api = installAiApi({ anthropic: 'sk-ant-real' })
    await writeSnapshot(true)
    expect(window.localStorage.getItem(STORAGE_KEY) ?? '').toContain('"savedKeyDisabled":true')

    api.getKey.mockClear()
    const { useAiChatStore } = await loadStore() // the restart
    await settle()
    const s = useAiChatStore.getState()
    expect(s._currentTabId).toBe('t1')
    expect(s.provider).toBe('anthropic')
    expect(s.customUrl).toBe(MOCK_URL)
    expect(s.savedKeyDisabled).toBe(true)
    expect(s.apiKey).toBe('')
    expect(api.getKey).not.toHaveBeenCalledWith('anthropic')
  })

  it('control: the same tab without the mark loads the saved key on restart', async () => {
    const api = installAiApi({ anthropic: 'sk-ant-real' })
    await writeSnapshot(false)
    api.getKey.mockClear()
    const { useAiChatStore } = await loadStore()
    await settle()
    expect(api.getKey).toHaveBeenCalledWith('anthropic')
    expect(useAiChatStore.getState().apiKey).toBe('sk-ant-real')
  })
})
