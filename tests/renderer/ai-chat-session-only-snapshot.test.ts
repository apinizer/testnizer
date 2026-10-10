/**
 * Issue #180 — "Run tools without asking" is per tab, THIS session only: it
 * was written to the localStorage snapshot (`testnizer-ai-chat`) and came back
 * on after a restart, so the approval bypass outlived the session. The
 * Load-tools catalog was written too — a `loading: true` entry came back as a
 * spinner that never stops. Both are now kept out of the snapshot, and a
 * snapshot an older release wrote is cleaned when it is read back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'testnizer-ai-chat'

function installAiApi(): void {
  const aiChat = {
    send: vi.fn(async () => ({ success: true, data: { messageId: 'm' } })),
    cancel: vi.fn(async () => ({ success: true })),
    getKey: vi.fn(async () => ({ success: true, data: { key: '', encryptionAvailable: true } })),
    setKey: vi.fn(async () => ({ success: true, data: { persisted: true } })),
    onChunk: () => () => {},
    onDone: () => () => {},
    onError: () => () => {},
    onCancelled: () => () => {},
  }
  ;(window as unknown as { api: { aiChat: typeof aiChat } }).api = { aiChat }
}

type StoreModule = typeof import('../../src/renderer/stores/ai-chat.store')
let lastStore: StoreModule | null = null

async function loadStore(): Promise<StoreModule> {
  vi.resetModules()
  lastStore = await import('../../src/renderer/stores/ai-chat.store')
  return lastStore
}

const snapshot = (): Record<string, unknown> =>
  JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>

beforeEach(() => {
  window.localStorage.clear()
  installAiApi()
})

afterEach(() => {
  lastStore?.resetAiKeySessionForTests()
  lastStore = null
})

describe('issue #180 — session-only Tools state never reaches the snapshot', () => {
  it('autoApproveTools and the tool catalog are not written (live and cached tab)', async () => {
    const { useAiChatStore } = await loadStore()
    const { setAutoApproveTools } = await import('../../src/renderer/stores/ai-chat-tools')
    useAiChatStore.getState().switchToTab('t1')
    setAutoApproveTools(true)
    useAiChatStore.setState({
      toolCatalog: { srv: { loading: true } },
    })
    // Cache t1, then turn it on in t2 too (both paths: current + _tabStates).
    useAiChatStore.getState().switchToTab('t2')
    setAutoApproveTools(true)
    useAiChatStore.setState({ toolCatalog: { srv2: { tools: [{ name: 'get' }] } } })

    const snap = snapshot() as {
      current: Record<string, unknown>
      _tabStates: Array<[string, Record<string, unknown>]>
    }
    expect(snap.current.autoApproveTools).toBe(false)
    expect(snap.current.toolCatalog).toEqual({})
    const t1 = snap._tabStates.find(([id]) => id === 't1')?.[1]
    expect(t1?.autoApproveTools).toBe(false)
    expect(t1?.toolCatalog).toEqual({})

    // In memory the session keeps it (tab switch does not lose it).
    useAiChatStore.getState().switchToTab('t1')
    expect(useAiChatStore.getState().autoApproveTools).toBe(true)
  })

  it('an older snapshot that holds them is cleaned on load (no bypass, no stuck spinner)', async () => {
    const stale = {
      autoApproveTools: true,
      toolCatalog: { srv: { loading: true } },
      allowedTools: ['srv::delete'],
      streaming: true,
      pendingMessageId: 'old',
      messages: [{ id: 'u', role: 'user', content: 'old question', timestamp: 1 }],
    }
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ current: stale, _currentTabId: 't1', _tabStates: [['t2', stale]] }),
    )
    const { useAiChatStore } = await loadStore()
    const s = useAiChatStore.getState()
    expect(s.autoApproveTools).toBe(false)
    expect(s.toolCatalog).toEqual({})
    expect(s.allowedTools).toEqual([])
    expect(s.streaming).toBe(false)
    expect(s.pendingMessageId).toBeNull()
    // Turns are kept for the upgrade path (stored as a conversation on first open).
    expect(s.messages).toHaveLength(1)
    const cached = s._tabStates.get('t2')
    expect(cached?.autoApproveTools).toBe(false)
    expect(cached?.toolCatalog).toEqual({})
  })
})

describe('issue #199 — startup prune of crash-leftover tab: conversations', () => {
  it('keeps open tabs, tabs stashed for OTHER projects and tabs with AI state; asks main once', async () => {
    window.localStorage.setItem(
      'testnizer-tabs',
      JSON.stringify({
        tabs: [{ id: 'open-1', name: 'AI', protocol: 'ai' }],
        activeTabId: 'open-1',
      }),
    )
    window.localStorage.setItem(
      'testnizer-tabs-by-project',
      JSON.stringify({ p2: { tabs: [{ id: 'other-project-tab', name: 'AI', protocol: 'ai' }] } }),
    )
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ current: {}, _currentTabId: 'open-1', _tabStates: [['cached-ai', {}]] }),
    )
    // Let earlier tests' module instances run their own deferred prune first.
    await new Promise((r) => setTimeout(r, 5))
    const pruneTabs = vi.fn(async () => ({ success: true, data: 0 }))
    const w = window as unknown as { api: { aiChat: Record<string, unknown> } }
    w.api.aiChat.conversations = { pruneTabs }
    await loadStore()
    await new Promise((r) => setTimeout(r, 5))
    expect(pruneTabs).toHaveBeenCalledTimes(1)
    const ids = (pruneTabs.mock.calls[0] as unknown as [string[]])[0]
    expect(ids).toEqual(expect.arrayContaining(['open-1', 'other-project-tab', 'cached-ai']))
  })
})
