/**
 * Issue #187 — AI Chat: Ctrl+S saved an empty row and reopening showed a
 * blank chat. `snapshotProtocol` / `applyProtocolMetadata` /
 * `switchProtocolToTab` had no 'ai' branch, and the store never marked the
 * tab dirty.
 *
 * Each case configures an AI tab, saves through the real
 * `saveActiveRequestInPlace`, "closes" the tab, and reopens through the real
 * open path against an in-memory row store behind `window.api`. The saved row
 * must carry the configuration — and never the API key, a credential header
 * or the conversation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saveActiveRequestInPlace, snapshotProtocol } from '../../src/renderer/lib/save-active-request'
import { openEndpointTab, openSuiteItemTab } from '../../src/renderer/lib/open-endpoint-tab'
import { switchActiveTab } from '../../src/renderer/lib/activate-tab'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import {
  resetAiKeySessionForTests,
  useAiChatStore,
} from '../../src/renderer/stores/ai-chat.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import type { Tab } from '../../src/renderer/types'

type Row = Record<string, unknown>

const SECRET_KEY = 'sk-live-SECRET-123'
const SECRET_HEADER = 'Bearer raw-gateway-SECRET'

function installRowApi() {
  const endpoints = new Map<string, Row>()
  const saved = new Map<string, Row>()
  const items = new Map<string, Row>()
  const ok = (data: unknown) => ({ success: true, data })
  const api = {
    endpoint: {
      update: vi.fn(async (id: string, patch: Row) => {
        endpoints.set(id, { ...endpoints.get(id), ...patch })
        return ok(true)
      }),
      get: vi.fn(async (id: string) => ok(endpoints.get(id) ?? null)),
    },
    savedRequest: {
      update: vi.fn(async (id: string, patch: Row) => {
        const next: Row = { ...(saved.get(id) ?? {}) }
        for (const [k, v] of Object.entries(patch)) if (v !== undefined) next[k] = v
        saved.set(id, next)
        return ok(true)
      }),
      get: vi.fn(async (id: string) => ok(saved.get(id) ?? null)),
    },
    testSuiteItem: {
      update: vi.fn(async (id: string, patch: Row) => {
        items.set(id, { ...items.get(id), ...patch })
        return ok(true)
      }),
      get: vi.fn(async (id: string) => ok(items.get(id) ?? null)),
    },
    aiChat: {
      // The key store in main: the provider's key comes back on reopen.
      getKey: vi.fn(async (scope: string) =>
        ok({ key: scope === 'anthropic' ? SECRET_KEY : '', encryptionAvailable: true }),
      ),
      setKey: vi.fn(async () => ok({ persisted: true, encryptionAvailable: true })),
    },
  }
  ;(window as unknown as { api: typeof api }).api = api
  return { api, endpoints, saved, items }
}

let rows: ReturnType<typeof installRowApi>

function openEditorTab(tab: Partial<Tab> & { id: string }): void {
  useTabsStore.setState({
    tabs: [
      { name: 'Chat', method: 'POST', url: '', isDirty: false, protocol: 'ai', ...tab } as Tab,
    ],
    activeTabId: tab.id,
  })
  useRequestStore.getState().switchToTab(tab.id)
  useAiChatStore.getState().switchToTab(tab.id)
}

function closeAll(): void {
  const closed = useTabsStore.getState().tabs.map((t) => t.id)
  useTabsStore.setState({ tabs: [], activeTabId: null })
  // Leave the closed tab first (switchToTab caches the live slice under the
  // tab being left), then drop its cache — nothing of it may leak into reopen.
  useRequestStore.getState().switchToTab('scratch')
  useAiChatStore.getState().switchToTab('scratch')
  for (const id of closed) {
    useRequestStore.getState().removeTabState(id)
    useAiChatStore.getState().removeTabState(id)
  }
  resetAiKeySessionForTests()
}

/** Configure the live AI tab through the user-facing setters. */
function configure(): void {
  const ai = useAiChatStore.getState()
  ai.setProvider('anthropic')
  ai.setModel('claude-sonnet-4-6')
  ai.setCustomUrl('https://proxy.internal/v1/messages')
  ai.setSystemPrompt('You are terse. Tenant {{tenant}}.')
  ai.setHeaders([
    { id: 'h1', key: 'X-Tenant-Id', value: 'acme', enabled: true },
    { id: 'h2', key: 'Authorization', value: SECRET_HEADER, enabled: true },
    { id: 'h3', key: 'X-Api-Key', value: '{{gwKey}}', enabled: true },
  ])
  ai.setTemperature(0.4)
  ai.setMaxTokens(2048)
  ai.setApiKey(SECRET_KEY)
  useAiChatStore.setState({
    messages: [{ id: 'm1', role: 'user', content: 'conversation SECRET text', timestamp: 1 }],
  })
}

function expectRestored(): void {
  const s = useAiChatStore.getState()
  expect(s.provider).toBe('anthropic')
  expect(s.model).toBe('claude-sonnet-4-6')
  expect(s.customUrl).toBe('https://proxy.internal/v1/messages')
  expect(s.systemPrompt).toBe('You are terse. Tenant {{tenant}}.')
  expect(s.temperature).toBe(0.4)
  expect(s.maxTokens).toBe(2048)
  // Credential header with a literal secret is gone; the template-only one stays.
  expect(s.customHeaders.map((h) => [h.key, h.value])).toEqual([
    ['X-Tenant-Id', 'acme'],
    ['X-Api-Key', '{{gwKey}}'],
  ])
  expect(s.messages).toEqual([])
}

const activeDirty = (): boolean => {
  const s = useTabsStore.getState()
  return s.tabs.find((t) => t.id === s.activeTabId)?.isDirty ?? false
}

beforeEach(() => {
  rows = installRowApi()
  resetAiKeySessionForTests()
  useWorkspaceStore.setState({ refreshTree: vi.fn().mockResolvedValue(undefined) })
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useRequestStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useAiChatStore.setState({ _tabStates: new Map(), _currentTabId: null })
})

describe('issue #187 — snapshotProtocol has an AI branch', () => {
  it('captures the configuration, never the key, credential headers or conversation', () => {
    openEditorTab({ id: 'tab-ai' })
    configure()
    const snap = snapshotProtocol(useTabsStore.getState().tabs[0])
    expect(snap.effectiveUrl).toBe('https://proxy.internal/v1/messages')
    expect(snap.effectiveMethod).toBe('POST')
    const meta = snap.protocolMeta.ai as Record<string, unknown>
    expect(meta).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      customUrl: 'https://proxy.internal/v1/messages',
      systemPrompt: 'You are terse. Tenant {{tenant}}.',
      temperature: 0.4,
      maxTokens: 2048,
    })
    const json = JSON.stringify(snap)
    expect(json).not.toContain(SECRET_KEY)
    expect(json).not.toContain(SECRET_HEADER)
    expect(json).not.toContain('conversation SECRET')
    expect(json).not.toContain('apiKey')
  })
})

describe('issue #187 — Ctrl+S → close → reopen restores the AI configuration', () => {
  it('endpoint row', async () => {
    rows.endpoints.set('ep-ai', { id: 'ep-ai', name: 'Chat', method: 'POST', path: '', protocol: 'ai' })
    openEditorTab({ id: 'tab-ep-ai', endpointId: 'ep-ai' })
    configure()
    expect(activeDirty()).toBe(true)

    const res = await saveActiveRequestInPlace()
    expect(res.success).toBe(true)
    expect(activeDirty()).toBe(false)
    const row = rows.endpoints.get('ep-ai') as Row
    expect(String(row.request_schema)).not.toContain(SECRET_KEY)
    expect(String(row.request_schema)).not.toContain(SECRET_HEADER)
    expect(String(row.request_schema)).not.toContain('conversation SECRET')

    closeAll()
    await openEndpointTab('ep-ai')
    expectRestored()
    // The key is not in the row — it comes back from main's encrypted store.
    await vi.waitFor(() => expect(useAiChatStore.getState().apiKey).toBe(SECRET_KEY))
    expect(rows.api.aiChat.getKey).toHaveBeenCalledWith('anthropic')
    // A restore is not an edit.
    expect(activeDirty()).toBe(false)
  })

  it('saved_request row', async () => {
    rows.saved.set('sr-ai', {
      id: 'sr-ai',
      name: 'Chat',
      method: 'POST',
      url: '',
      protocol: 'ai',
    })
    openEditorTab({ id: 'tab-sr-ai', savedRequestId: 'sr-ai' })
    configure()

    const res = await saveActiveRequestInPlace()
    expect(res.success).toBe(true)
    const row = rows.saved.get('sr-ai') as Row
    expect(typeof row.metadata).toBe('string')
    expect(String(row.metadata)).not.toContain(SECRET_KEY)
    expect(String(row.metadata)).not.toContain(SECRET_HEADER)

    closeAll()
    await openEndpointTab('sr-ai')
    expectRestored()
    expect(activeDirty()).toBe(false)
  })

  it('test suite item row', async () => {
    rows.items.set('it-ai', {
      id: 'it-ai',
      suite_id: 's1',
      folder_id: null,
      protocol: 'ai',
      name: 'Chat',
      method: 'POST',
      url: '',
      request_schema: '{}',
      assertions: '[]',
    })
    openEditorTab({ id: 'tab-it-ai', testSuiteItemId: 'it-ai' })
    configure()

    const res = await saveActiveRequestInPlace()
    expect(res.success).toBe(true)
    expect(String((rows.items.get('it-ai') as Row).request_schema)).not.toContain(SECRET_KEY)

    closeAll()
    await openSuiteItemTab('it-ai')
    expectRestored()
  })
})

describe('issue #187 — AI edits mark the tab dirty', () => {
  it.each([
    ['provider', () => useAiChatStore.getState().setProvider('mistral')],
    ['model', () => useAiChatStore.getState().setModel('gpt-5-mini')],
    ['endpoint URL', () => useAiChatStore.getState().setCustomUrl('https://x.test/v1')],
    ['system prompt', () => useAiChatStore.getState().setSystemPrompt('hi')],
    ['temperature', () => useAiChatStore.getState().setTemperature(1)],
    ['max tokens', () => useAiChatStore.getState().setMaxTokens(100)],
    ['add header', () => useAiChatStore.getState().addHeader()],
    ['set headers', () => useAiChatStore.getState().setHeaders([])],
  ])('%s', (_label, edit) => {
    openEditorTab({ id: 'tab-dirty' })
    expect(activeDirty()).toBe(false)
    edit()
    expect(activeDirty()).toBe(true)
  })

  it('typing the API key does not (it is not saved with the request)', () => {
    openEditorTab({ id: 'tab-key' })
    useAiChatStore.getState().setApiKey('sk-x')
    expect(activeDirty()).toBe(false)
  })
})

describe('issue #187 — tab switching keeps each AI tab', () => {
  it('switchActiveTab swaps the AI configuration per tab', () => {
    useTabsStore.setState({
      tabs: [
        { id: 'a', name: 'A', method: 'POST', url: '', isDirty: false, protocol: 'ai' } as Tab,
        { id: 'b', name: 'B', method: 'POST', url: '', isDirty: false, protocol: 'ai' } as Tab,
      ],
      activeTabId: 'a',
    })
    switchActiveTab('a')
    useAiChatStore.getState().setModel('model-a')
    switchActiveTab('b')
    useAiChatStore.getState().setModel('model-b')
    switchActiveTab('a')
    expect(useAiChatStore.getState().model).toBe('model-a')
    switchActiveTab('b')
    expect(useAiChatStore.getState().model).toBe('model-b')
  })
})
