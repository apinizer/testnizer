// src/renderer/stores/ai-chat.store.ts
// Postman-style AI chat — provider/model selection, multi-turn conversation,
// streaming response with cancellation. State is in-memory only (no DB).

import { create } from 'zustand'
import { resolveVariables } from '../lib/variable-resolver'
import { useEnvironmentStore } from './environment.store'
import { loadTabbedState, attachTabbedPersist } from '../lib/persist-helpers'

export type AiProvider =
  | 'openai'
  | 'anthropic'
  | 'openrouter'
  | 'google'
  | 'deepseek'
  | 'xai'
  | 'mistral'
  | 'groq'
  | 'perplexity'
  | 'cerebras'
  | 'cohere'
  | 'fireworks'
  | 'deepinfra'
  | 'together'
  | 'custom'

export interface AiProviderInfo {
  id: AiProvider
  label: string
  /** Avatar background color (brand-ish). */
  color: string
  /** Single-letter avatar fallback. */
  letter: string
}

/**
 * Provider catalog — order shown in the dropdown matches Postman's grouping
 * (large frontier labs first, then aggregators, then specialized providers).
 */
export const AI_PROVIDERS: AiProviderInfo[] = [
  { id: 'openai', label: 'OpenAI', color: '#10A37F', letter: 'O' },
  { id: 'anthropic', label: 'Anthropic', color: '#D97757', letter: 'A' },
  { id: 'google', label: 'Google', color: '#4285F4', letter: 'G' },
  { id: 'xai', label: 'xAI', color: '#000000', letter: 'X' },
  { id: 'deepseek', label: 'DeepSeek', color: '#4D6BFE', letter: 'D' },
  { id: 'mistral', label: 'Mistral', color: '#FF7000', letter: 'M' },
  { id: 'groq', label: 'Groq', color: '#F55036', letter: 'G' },
  { id: 'perplexity', label: 'Perplexity', color: '#1F6FEB', letter: 'P' },
  { id: 'cerebras', label: 'Cerebras', color: '#F26522', letter: 'C' },
  { id: 'cohere', label: 'Cohere', color: '#39594D', letter: 'C' },
  { id: 'fireworks', label: 'Fireworks', color: '#5B5BD6', letter: 'F' },
  { id: 'deepinfra', label: 'DeepInfra', color: '#5C46E1', letter: 'D' },
  { id: 'together', label: 'Together', color: '#0F6FFF', letter: 'T' },
  { id: 'openrouter', label: 'OpenRouter', color: '#6E56CF', letter: 'R' },
  { id: 'custom', label: 'Custom', color: '#8A8FA3', letter: '⚙' },
]

export interface AiChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

export interface AiModelOption {
  value: string
  label: string
}

/**
 * Curated current model lists (Jan 2026). Manual model names are also
 * accepted in the editor — this is just an autocomplete list.
 */
export const PROVIDER_MODELS: Record<AiProvider, AiModelOption[]> = {
  openai: [
    { value: 'gpt-4.5-preview', label: 'gpt-4.5-preview' },
    { value: 'gpt-4o', label: 'gpt-4o' },
    { value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
    { value: 'o1', label: 'o1' },
    { value: 'o1-mini', label: 'o1-mini' },
    { value: 'o1-pro', label: 'o1-pro' },
    { value: 'o3', label: 'o3' },
    { value: 'o3-mini', label: 'o3-mini' },
    { value: 'o4-mini', label: 'o4-mini' },
    { value: 'gpt-4-turbo', label: 'gpt-4-turbo' },
  ],
  anthropic: [
    { value: 'claude-opus-4-5', label: 'claude-opus-4-5' },
    { value: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5' },
    { value: 'claude-haiku-4-5', label: 'claude-haiku-4-5' },
    { value: 'claude-opus-4', label: 'claude-opus-4' },
    { value: 'claude-sonnet-4', label: 'claude-sonnet-4' },
    { value: 'claude-3-7-sonnet-latest', label: 'claude-3-7-sonnet-latest' },
    { value: 'claude-3-5-sonnet-latest', label: 'claude-3-5-sonnet-latest' },
    { value: 'claude-3-5-haiku-latest', label: 'claude-3-5-haiku-latest' },
  ],
  openrouter: [
    { value: 'anthropic/claude-opus-4-5', label: 'anthropic/claude-opus-4-5' },
    { value: 'anthropic/claude-sonnet-4-5', label: 'anthropic/claude-sonnet-4-5' },
    { value: 'openai/gpt-4o', label: 'openai/gpt-4o' },
    { value: 'openai/o3-mini', label: 'openai/o3-mini' },
    { value: 'google/gemini-2.5-pro', label: 'google/gemini-2.5-pro' },
    { value: 'google/gemini-2.5-flash', label: 'google/gemini-2.5-flash' },
    { value: 'x-ai/grok-3', label: 'x-ai/grok-3' },
    { value: 'deepseek/deepseek-chat', label: 'deepseek/deepseek-chat' },
    { value: 'deepseek/deepseek-r1', label: 'deepseek/deepseek-r1' },
    { value: 'meta-llama/llama-3.3-70b-instruct', label: 'meta-llama/llama-3.3-70b-instruct' },
    { value: 'mistralai/mistral-large-2411', label: 'mistralai/mistral-large' },
  ],
  google: [
    { value: 'gemini-2.5-pro', label: 'gemini-2.5-pro' },
    { value: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
    { value: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite' },
    { value: 'gemini-2.0-flash', label: 'gemini-2.0-flash' },
    { value: 'gemini-2.0-flash-thinking-exp', label: 'gemini-2.0-flash-thinking-exp' },
    { value: 'gemini-2.0-pro-exp', label: 'gemini-2.0-pro-exp' },
    { value: 'gemini-1.5-pro', label: 'gemini-1.5-pro' },
    { value: 'gemini-1.5-flash', label: 'gemini-1.5-flash' },
  ],
  deepseek: [
    { value: 'deepseek-chat', label: 'deepseek-chat (V3)' },
    { value: 'deepseek-reasoner', label: 'deepseek-reasoner (R1)' },
  ],
  xai: [
    { value: 'grok-3', label: 'grok-3' },
    { value: 'grok-3-mini', label: 'grok-3-mini' },
    { value: 'grok-3-fast', label: 'grok-3-fast' },
    { value: 'grok-2-latest', label: 'grok-2-latest' },
    { value: 'grok-2-vision-latest', label: 'grok-2-vision-latest' },
  ],
  mistral: [
    { value: 'mistral-large-latest', label: 'mistral-large-latest' },
    { value: 'mistral-medium-latest', label: 'mistral-medium-latest' },
    { value: 'mistral-small-latest', label: 'mistral-small-latest' },
    { value: 'mistral-saba-latest', label: 'mistral-saba-latest' },
    { value: 'codestral-latest', label: 'codestral-latest' },
    { value: 'pixtral-large-latest', label: 'pixtral-large-latest' },
    { value: 'ministral-8b-latest', label: 'ministral-8b-latest' },
    { value: 'ministral-3b-latest', label: 'ministral-3b-latest' },
  ],
  groq: [
    { value: 'llama-3.3-70b-versatile', label: 'llama-3.3-70b-versatile' },
    { value: 'llama-3.1-8b-instant', label: 'llama-3.1-8b-instant' },
    { value: 'llama-3.2-90b-vision-preview', label: 'llama-3.2-90b-vision-preview' },
    { value: 'deepseek-r1-distill-llama-70b', label: 'deepseek-r1-distill-llama-70b' },
    { value: 'qwen-2.5-32b', label: 'qwen-2.5-32b' },
    { value: 'qwen-2.5-coder-32b', label: 'qwen-2.5-coder-32b' },
    { value: 'gemma2-9b-it', label: 'gemma2-9b-it' },
  ],
  perplexity: [
    { value: 'sonar', label: 'sonar' },
    { value: 'sonar-pro', label: 'sonar-pro' },
    { value: 'sonar-reasoning', label: 'sonar-reasoning' },
    { value: 'sonar-reasoning-pro', label: 'sonar-reasoning-pro' },
    { value: 'sonar-deep-research', label: 'sonar-deep-research' },
  ],
  cerebras: [
    { value: 'llama-3.3-70b', label: 'llama-3.3-70b' },
    { value: 'llama3.1-70b', label: 'llama3.1-70b' },
    { value: 'llama3.1-8b', label: 'llama3.1-8b' },
    { value: 'deepseek-r1-distill-llama-70b', label: 'deepseek-r1-distill-llama-70b' },
  ],
  cohere: [
    { value: 'command-a-03-2025', label: 'command-a-03-2025' },
    { value: 'command-r-plus-08-2024', label: 'command-r-plus-08-2024' },
    { value: 'command-r-08-2024', label: 'command-r-08-2024' },
    { value: 'command-r7b-12-2024', label: 'command-r7b-12-2024' },
  ],
  fireworks: [
    { value: 'accounts/fireworks/models/deepseek-v3', label: 'deepseek-v3' },
    { value: 'accounts/fireworks/models/deepseek-r1', label: 'deepseek-r1' },
    {
      value: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
      label: 'llama-v3p3-70b-instruct',
    },
    { value: 'accounts/fireworks/models/qwen2p5-72b-instruct', label: 'qwen2p5-72b-instruct' },
    { value: 'accounts/fireworks/models/qwen2p5-coder-32b-instruct', label: 'qwen2p5-coder-32b' },
    { value: 'accounts/fireworks/models/mixtral-8x22b-instruct', label: 'mixtral-8x22b-instruct' },
  ],
  deepinfra: [
    { value: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek-V3' },
    { value: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek-R1' },
    { value: 'meta-llama/Llama-3.3-70B-Instruct', label: 'Llama-3.3-70B-Instruct' },
    { value: 'Qwen/Qwen2.5-72B-Instruct', label: 'Qwen2.5-72B-Instruct' },
    { value: 'Qwen/Qwen2.5-Coder-32B-Instruct', label: 'Qwen2.5-Coder-32B' },
    { value: 'mistralai/Mistral-Small-24B-Instruct-2501', label: 'Mistral-Small-24B-Instruct' },
  ],
  together: [
    { value: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek-V3' },
    { value: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek-R1' },
    { value: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', label: 'Llama-3.3-70B-Instruct-Turbo' },
    { value: 'Qwen/Qwen2.5-72B-Instruct-Turbo', label: 'Qwen2.5-72B-Instruct-Turbo' },
    { value: 'Qwen/QwQ-32B', label: 'QwQ-32B' },
    { value: 'mistralai/Mixtral-8x22B-Instruct-v0.1', label: 'Mixtral-8x22B-Instruct' },
  ],
  custom: [
    { value: 'gpt-4o', label: 'gpt-4o' },
    { value: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5' },
  ],
}

function defaultModelFor(provider: AiProvider): string {
  return PROVIDER_MODELS[provider][0]?.value ?? ''
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** Snapshot of AI Chat state for per-tab caching. */
interface TabAiChatState {
  provider: AiProvider
  customUrl: string
  apiKey: string
  model: string
  systemPrompt: string
  messages: AiChatMessage[]
  streaming: boolean
  pendingResponseId: string | null
  pendingMessageId: string | null
  errorMessage: string | null
}

interface AiChatStore extends TabAiChatState {
  /** Per-tab state cache */
  _tabStates: Map<string, TabAiChatState>
  _currentTabId: string | null

  setProvider: (provider: AiProvider) => void
  setCustomUrl: (url: string) => void
  setApiKey: (key: string) => void
  setModel: (model: string) => void
  setSystemPrompt: (prompt: string) => void

  sendPrompt: (content: string) => Promise<void>
  cancel: () => Promise<void>
  clearConversation: () => void

  /** Internal — used by the IPC subscription. */
  _onChunk: (messageId: string, delta: string) => void
  _onDone: (messageId: string) => void
  _onError: (messageId: string, error: string) => void
  _onCancelled: (messageId: string) => void

  /** Switch active tab — saves current state and loads target tab state. */
  switchToTab: (tabId: string) => void
  /** Remove cached state for a closed tab. */
  removeTabState: (tabId: string) => void
}

function emptyTabState(): TabAiChatState {
  return {
    provider: 'openai',
    customUrl: '',
    apiKey: '',
    model: defaultModelFor('openai'),
    systemPrompt: '',
    messages: [],
    streaming: false,
    pendingResponseId: null,
    pendingMessageId: null,
    errorMessage: null,
  }
}

function extractState(s: AiChatStore): TabAiChatState {
  return {
    provider: s.provider,
    customUrl: s.customUrl,
    apiKey: s.apiKey,
    model: s.model,
    systemPrompt: s.systemPrompt,
    messages: s.messages,
    streaming: s.streaming,
    pendingResponseId: s.pendingResponseId,
    pendingMessageId: s.pendingMessageId,
    errorMessage: s.errorMessage,
  }
}

/**
 * Walk every tab (live + cached) looking for the one whose `pendingMessageId`
 * matches the streaming chunk we just received from main. The streaming pump
 * is global, so we may need to route a delta into a tab that isn't the
 * currently active one.
 */
function findTabByPendingId(
  state: AiChatStore,
  messageId: string,
): { isLive: boolean; tabKey?: string; snapshot: TabAiChatState } | null {
  if (state.pendingMessageId === messageId) {
    return { isLive: true, snapshot: extractState(state) }
  }
  for (const [key, snap] of state._tabStates.entries()) {
    if (snap.pendingMessageId === messageId) {
      return { isLive: false, tabKey: key, snapshot: snap }
    }
  }
  return null
}

const STORAGE_KEY = 'testnizer-ai-chat'
const persisted = loadTabbedState<TabAiChatState>(STORAGE_KEY, emptyTabState)

export const useAiChatStore = create<AiChatStore>((set, get) => ({
  ...persisted.current,
  _tabStates: persisted._tabStates,
  _currentTabId: persisted._currentTabId,

  setProvider: (provider) => {
    // Switching provider auto-selects a sensible default model unless the
    // current model is already in the new provider's list.
    const models = PROVIDER_MODELS[provider]
    const current = get().model
    const stillValid = models.some((m) => m.value === current)
    set({ provider, model: stillValid ? current : defaultModelFor(provider) })
  },
  setCustomUrl: (customUrl) => set({ customUrl }),
  setApiKey: (apiKey) => set({ apiKey }),
  setModel: (model) => set({ model }),
  setSystemPrompt: (systemPrompt) => set({ systemPrompt }),

  sendPrompt: async (content) => {
    const trimmed = content.trim()
    if (!trimmed) return
    const state = get()
    if (state.streaming) return

    if (!state.apiKey.trim()) {
      set({ errorMessage: 'API key is required' })
      return
    }

    // Resolve {{var}} substitutions against active env + globals.
    const envVars = useEnvironmentStore.getState().getActiveVariables()
    const resolvedContent = resolveVariables(trimmed, envVars)
    const resolvedSystem = state.systemPrompt ? resolveVariables(state.systemPrompt, envVars) : ''
    const resolvedUrl = state.customUrl
      ? resolveVariables(state.customUrl, envVars)
      : state.customUrl

    const userMsg: AiChatMessage = {
      id: makeId(),
      role: 'user',
      content: resolvedContent,
      timestamp: Date.now(),
    }
    const assistantMsg: AiChatMessage = {
      id: makeId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    }

    set({
      messages: [...state.messages, userMsg, assistantMsg],
      streaming: true,
      errorMessage: null,
      pendingResponseId: assistantMsg.id,
    })

    // Build the chat history for the provider — include the resolved system
    // prompt at the top so multi-turn context is honoured.
    const history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = []
    if (resolvedSystem) history.push({ role: 'system', content: resolvedSystem })
    for (const m of get().messages) {
      if (m.id === assistantMsg.id) continue // current empty placeholder
      history.push({ role: m.role, content: m.content })
    }

    try {
      const result = (await window.api.aiChat.send({
        provider: state.provider,
        url: resolvedUrl || undefined,
        apiKey: state.apiKey,
        model: state.model,
        messages: history,
      })) as { success: boolean; data?: { messageId: string }; error?: string }

      if (!result?.success || !result.data?.messageId) {
        set({
          streaming: false,
          pendingResponseId: null,
          pendingMessageId: null,
          errorMessage: result?.error ?? 'Failed to start chat',
        })
        return
      }
      set({ pendingMessageId: result.data.messageId })
    } catch (e) {
      set({
        streaming: false,
        pendingResponseId: null,
        pendingMessageId: null,
        errorMessage: (e as Error).message,
      })
    }
  },

  cancel: async () => {
    const id = get().pendingMessageId
    if (!id) return
    try {
      await window.api.aiChat.cancel(id)
    } catch {
      /* ignore — done event will still fire */
    }
  },

  clearConversation: () => {
    if (get().streaming) return
    set({ messages: [], errorMessage: null })
  },

  _onChunk: (messageId, delta) => {
    const state = get()
    const found = findTabByPendingId(state, messageId)
    if (!found) return
    const updatedMessages = found.snapshot.messages.map((m) =>
      m.id === found.snapshot.pendingResponseId ? { ...m, content: m.content + delta } : m,
    )
    if (found.isLive) {
      set({ messages: updatedMessages })
    } else if (found.tabKey !== undefined) {
      const map = new Map(state._tabStates)
      map.set(found.tabKey, { ...found.snapshot, messages: updatedMessages })
      set({ _tabStates: map })
    }
  },

  _onDone: (messageId) => {
    const state = get()
    const found = findTabByPendingId(state, messageId)
    if (!found) return
    if (found.isLive) {
      set({ streaming: false, pendingResponseId: null, pendingMessageId: null })
    } else if (found.tabKey !== undefined) {
      const map = new Map(state._tabStates)
      map.set(found.tabKey, {
        ...found.snapshot,
        streaming: false,
        pendingResponseId: null,
        pendingMessageId: null,
      })
      set({ _tabStates: map })
    }
  },

  _onError: (messageId, error) => {
    const state = get()
    const found = findTabByPendingId(state, messageId)
    if (!found) return
    if (found.isLive) {
      set({
        streaming: false,
        pendingResponseId: null,
        pendingMessageId: null,
        errorMessage: error,
      })
    } else if (found.tabKey !== undefined) {
      const map = new Map(state._tabStates)
      map.set(found.tabKey, {
        ...found.snapshot,
        streaming: false,
        pendingResponseId: null,
        pendingMessageId: null,
        errorMessage: error,
      })
      set({ _tabStates: map })
    }
  },

  _onCancelled: (messageId) => {
    const state = get()
    const found = findTabByPendingId(state, messageId)
    if (!found) return
    // Keep whatever was streamed so far; just stop streaming state.
    if (found.isLive) {
      set({ streaming: false, pendingResponseId: null, pendingMessageId: null })
    } else if (found.tabKey !== undefined) {
      const map = new Map(state._tabStates)
      map.set(found.tabKey, {
        ...found.snapshot,
        streaming: false,
        pendingResponseId: null,
        pendingMessageId: null,
      })
      set({ _tabStates: map })
    }
  },

  switchToTab: (tabId) => {
    const state = get()
    const tabStates = new Map(state._tabStates)

    const currentKey = state._currentTabId === null ? '__null__' : state._currentTabId
    tabStates.set(currentKey, extractState(state))

    const target = tabStates.get(tabId) || emptyTabState()

    set({
      ...target,
      _tabStates: tabStates,
      _currentTabId: tabId,
    })
  },

  removeTabState: (tabId) => {
    const tabStates = new Map(get()._tabStates)
    tabStates.delete(tabId)
    set({ _tabStates: tabStates })
  },
}))

attachTabbedPersist(useAiChatStore, STORAGE_KEY, extractState, (s) => ({
  _tabStates: s._tabStates,
  _currentTabId: s._currentTabId,
}))

// ─── IPC subscriptions ──────────────────────────────────────
// Subscribe once at module load; the preload bridge multiplexes events to
// every listener, so re-mounting the editor is cheap.

if (typeof window !== 'undefined' && window.api?.aiChat) {
  window.api.aiChat.onChunk((event) => {
    const e = event as { messageId: string; delta: string }
    if (!e?.messageId) return
    useAiChatStore.getState()._onChunk(e.messageId, e.delta)
  })
  window.api.aiChat.onDone((event) => {
    const e = event as { messageId: string }
    if (!e?.messageId) return
    useAiChatStore.getState()._onDone(e.messageId)
  })
  window.api.aiChat.onError((event) => {
    const e = event as { messageId: string; error: string }
    if (!e?.messageId) return
    useAiChatStore.getState()._onError(e.messageId, e.error)
  })
  window.api.aiChat.onCancelled((event) => {
    const e = event as { messageId: string }
    if (!e?.messageId) return
    useAiChatStore.getState()._onCancelled(e.messageId)
  })
}
